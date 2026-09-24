'use client';

/**
 * The refinement pass, orchestrated client-side.
 *
 * Downscale the frozen frame → send it with the measurements → validate the
 * reading → patch. Every step is allowed to fail, and failure at any step means
 * the deterministic theme stands. Callers get `null` and carry on; nothing here
 * throws into a capture.
 *
 * With refinement on, a 512px JPEG of the capture leaves the device for Google's
 * Gemini API. That is the point — a model that can see the photograph can tell
 * a lake from a graffiti wall in ways pixel statistics cannot — and it is why
 * the toggle is off by default and says so in words.
 */

import { ImageAnalysis, Pixels } from '../analyze';
import { PatchResult, applyReading } from '../patch';
import { DesignTokens } from '../tokens';
import { PerceptualCache, perceptualHash } from '../vision/phash';
import { toMeasurements } from './prompt';
import { SceneReading, parseReading } from './reading';

export interface RefinementStage {
  stage: 'reading' | 'settled' | 'skipped';
  /** Machine-readable cause when `skipped`, e.g. `no-api-key`, `provider-404`. */
  reason?: string;
  /** The provider's own message on a configuration error, when there is one. */
  detail?: string;
}

export interface Refinement extends PatchResult {
  reading: SceneReading;
  cached: boolean;
  elapsedMs: number;
}

/** Long edge of the image sent to the model. Enough to read a subject; small enough to be cheap. */
export const UPLOAD_EDGE = 512;

/**
 * Keyed on what the capture looks like, so repeat captures of one subject are
 * free *and* deterministic — the same object reliably yields the same site,
 * which is the property the heuristic engine gets for nothing.
 */
const cache = new PerceptualCache<SceneReading>();

interface ReadingResponse {
  reading: SceneReading | null;
  reason?: string;
  detail?: string;
}

/** A base64 JPEG (no data-URL prefix) of the frame at upload size. */
export function encodeForUpload(frame: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, UPLOAD_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82).replace(/^data:image\/jpeg;base64,/, '');
}

async function requestReading(
  image: string,
  analysis: ImageAnalysis,
  heuristic: DesignTokens,
  signal: AbortSignal,
): Promise<ReadingResponse> {
  const response = await fetch('/api/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({ image, measurements: toMeasurements(analysis, heuristic) }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.reading) {
    return {
      reading: null,
      reason: payload?.reason ?? `http-${response.status}`,
      detail: payload?.detail,
    };
  }

  // Re-validated on this side too. The route already ran the same check, but the
  // client is where the tokens are applied, and the boundary that applies them
  // should not assume the boundary that fetched them did its job.
  const reading = parseReading(payload.reading, analysis.swatches.length);
  return reading ? { reading } : { reading: null, reason: 'invalid-shape' };
}

/**
 * Refine a deterministic theme.
 *
 * `pixels` is the analysis buffer, used only for the cache key. `frame` is the
 * frozen capture the upload is encoded from.
 *
 * Returns `null` whenever refinement is unavailable, which is a normal outcome
 * rather than an error: no key configured, model unreachable, response
 * unusable, or the caller aborted.
 */
export async function refineTheme(
  base: DesignTokens,
  analysis: ImageAnalysis,
  pixels: Pixels,
  frame: { source: CanvasImageSource; width: number; height: number },
  options: { signal?: AbortSignal; onStage?: (stage: RefinementStage) => void } = {},
): Promise<Refinement | null> {
  const { signal, onStage } = options;
  const started = performance.now();

  if (analysis.swatches.length === 0) {
    onStage?.({ stage: 'skipped', reason: 'no-swatches' });
    return null;
  }

  const hash = perceptualHash(pixels);
  const hit = cache.get(hash);

  try {
    let reading: SceneReading;

    if (hit) {
      reading = hit;
    } else {
      onStage?.({ stage: 'reading' });
      const image = encodeForUpload(frame.source, frame.width, frame.height);
      const response = await requestReading(image, analysis, base, signal ?? new AbortController().signal);
      if (signal?.aborted) return null;
      if (!response.reading) {
        onStage?.({ stage: 'skipped', reason: response.reason, detail: response.detail });
        return null;
      }
      reading = response.reading;
      cache.set(hash, reading);
    }

    const result = applyReading(base, reading, analysis);
    onStage?.({ stage: 'settled' });

    return {
      ...result,
      reading,
      cached: Boolean(hit),
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    // An abort is the user moving on, not a fault worth logging loudly.
    if (signal?.aborted) return null;
    console.warn('[textures] refinement unavailable:', err);
    onStage?.({ stage: 'skipped', reason: 'error' });
    return null;
  }
}
