'use client';

/**
 * The refinement pass, orchestrated client-side.
 *
 * Classify on device → reason over the labels and measurements → validate →
 * patch. Every step is allowed to fail, and failure at any step means the
 * deterministic theme stands. Callers get `null` and carry on; nothing here
 * throws into a capture.
 */

import { ImageAnalysis, Pixels } from '../analyze';
import { PatchResult, applyReading } from '../patch';
import { DesignTokens } from '../tokens';
import { classifyCapture } from '../vision/classify';
import { Classification } from '../vision/labels';
import { PerceptualCache, perceptualHash } from '../vision/phash';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import { SceneReading, parseReading } from './reading';

export interface RefinementStage {
  stage: 'classifying' | 'reading' | 'settled' | 'skipped';
  reason?: string;
}

export interface Refinement extends PatchResult {
  reading: SceneReading;
  classification: Classification | null;
  cached: boolean;
  elapsedMs: number;
}

interface CachedReading {
  reading: SceneReading;
  classification: Classification | null;
}

/**
 * Keyed on what the capture looks like, so repeat captures of one subject are
 * free *and* deterministic — the same object reliably yields the same site,
 * which is the property the heuristic engine gets for nothing.
 */
const cache = new PerceptualCache<CachedReading>();

async function requestReading(
  analysis: ImageAnalysis,
  classification: Classification | null,
  heuristic: DesignTokens,
  signal: AbortSignal,
): Promise<SceneReading | null> {
  const response = await fetch('/api/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(analysis, classification, heuristic),
      swatchCount: analysis.swatches.length,
    }),
  });

  if (!response.ok) return null;

  const payload = await response.json();
  if (!payload?.reading) return null;

  // Re-validated on this side too. The route already ran the same check, but the
  // client is where the tokens are applied, and the boundary that applies them
  // should not assume the boundary that fetched them did its job.
  return parseReading(payload.reading, analysis.swatches.length);
}

/**
 * Refine a deterministic theme.
 *
 * `pixels` is the analysis buffer, used only for the cache key — it is never
 * uploaded. `preview` is the data URL CLIP reads, and it never leaves the
 * browser either.
 *
 * Returns `null` whenever refinement is unavailable, which is a normal outcome
 * rather than an error: no key configured, model unreachable, response
 * unusable, or the caller aborted.
 */
export async function refineTheme(
  base: DesignTokens,
  analysis: ImageAnalysis,
  pixels: Pixels,
  preview: string,
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
    let reading: SceneReading | null;
    let classification: Classification | null;

    if (hit) {
      ({ reading, classification } = hit);
    } else {
      onStage?.({ stage: 'classifying' });
      classification = await classifyCapture(preview);
      if (signal?.aborted) return null;

      onStage?.({ stage: 'reading' });
      reading = await requestReading(analysis, classification, base, signal ?? new AbortController().signal);
      if (!reading) {
        onStage?.({ stage: 'skipped', reason: 'no-reading' });
        return null;
      }
      cache.set(hash, { reading, classification });
    }

    const result = applyReading(base, reading, analysis);
    onStage?.({ stage: 'settled' });

    return {
      ...result,
      reading,
      classification,
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
