'use client';

/**
 * The engine's React surface.
 *
 * `ThemeEngine` owns exactly one job: run a captured frame through the
 * pipeline and push the resulting tokens into the DOM. It holds the tokens in
 * state so the inspector can read them, but the *styling* never depends on that
 * state — `applyTokens` writes CSS variables directly, so the restyle lands
 * even before React commits.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ANALYSIS_SIZE, ImageAnalysis, analyzeImage, extractPixels } from '@/lib/analyze';
import { DesignTokens, applyTokens } from '@/lib/tokens';
import { defaultTokens, synthesize } from '@/lib/synthesize';

export interface Capture {
  /** Object URL or data URL of the source frame. */
  src: string;
  width: number;
  height: number;
  takenAt: number;
  /** Milliseconds spent in analysis + synthesis. */
  elapsedMs: number;
}

interface EngineState {
  tokens: DesignTokens;
  analysis: ImageAnalysis | null;
  capture: Capture | null;
  status: 'idle' | 'processing' | 'ready' | 'error';
  error: string | null;
  /** Feed an image element or video frame through the pipeline. */
  ingest: (source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement) => Promise<void>;
  ingestFile: (file: File) => Promise<void>;
  reset: () => void;
}

const EngineContext = createContext<EngineState | null>(null);

export function useEngine(): EngineState {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used inside <ThemeEngine>');
  return ctx;
}

function sourceDimensions(source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement) {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/** Snapshot a source into a data URL we can show back to the user. */
function toPreview(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  width: number,
  height: number,
): string {
  const maxEdge = 900;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function ThemeEngine({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<DesignTokens>(() => defaultTokens());
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [status, setStatus] = useState<EngineState['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);

  // Publish the resting theme on mount so the pre-capture UI is already styled
  // by the same mechanism the generated site uses.
  useEffect(() => {
    applyTokens(tokens);
    // Intentionally mount-only: every later write goes through `ingest`, which
    // calls applyTokens itself before React ever re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const ingest = useCallback(
    async (source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement) => {
      setStatus('processing');
      setError(null);

      // Yield a frame so the "processing" state can actually paint before the
      // synchronous pixel work blocks the main thread.
      await new Promise((resolve) => requestAnimationFrame(resolve));

      try {
        const started = performance.now();
        const { width, height } = sourceDimensions(source);
        if (!width || !height) throw new Error('The frame has no pixels yet — try again.');

        const pixels = extractPixels(source, width, height, ANALYSIS_SIZE);
        const nextAnalysis = analyzeImage(pixels);
        const nextTokens = synthesize(nextAnalysis);
        const elapsedMs = performance.now() - started;

        // Inject first, then update state. The page is already restyled by the
        // time React schedules its render.
        applyTokens(nextTokens);

        setTokens(nextTokens);
        setAnalysis(nextAnalysis);
        setCapture({
          src: toPreview(source, width, height),
          width,
          height,
          takenAt: Date.now(),
          elapsedMs,
        });
        setStatus('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that image.');
        setStatus('error');
      }
    },
    [],
  );

  const ingestFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('That file is not an image.');
        setStatus('error');
        return;
      }

      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);

      try {
        const img = new Image();
        img.decoding = 'async';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('That image could not be decoded.'));
          img.src = url;
        });
        await ingest(img);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that image.');
        setStatus('error');
      }
    },
    [ingest],
  );

  const reset = useCallback(() => {
    const base = defaultTokens();
    applyTokens(base);
    setTokens(base);
    setAnalysis(null);
    setCapture(null);
    setStatus('idle');
    setError(null);
  }, []);

  const value = useMemo<EngineState>(
    () => ({ tokens, analysis, capture, status, error, ingest, ingestFile, reset }),
    [tokens, analysis, capture, status, error, ingest, ingestFile, reset],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}
