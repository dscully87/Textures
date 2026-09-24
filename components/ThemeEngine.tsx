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
  useSyncExternalStore,
} from 'react';
import { ANALYSIS_SIZE, ImageAnalysis, analyzeImage, extractPixels } from '@/lib/analyze';
import { DesignTokens, applyTokens } from '@/lib/tokens';
import { defaultTokens, synthesize } from '@/lib/synthesize';
import { loadPairing } from '@/lib/fontLoader';
import { Imagery, applyImagery, renderImagery, revokeImagery } from '@/lib/imagery';
import { Refinement, RefinementStage, refineTheme } from '@/lib/ai/refine';

export interface Capture {
  /** Object URL or data URL of the source frame. */
  src: string;
  width: number;
  height: number;
  takenAt: number;
  /** Milliseconds spent in analysis + synthesis. */
  elapsedMs: number;
}

/** Persisted so the choice survives a reload; opt-in, so absent means off. */
const REFINE_KEY = 'textures:refine';

/**
 * The opt-in preference, as an external store.
 *
 * localStorage is not React state, and reading it in an effect to mirror it into
 * state costs a second render on every mount. `useSyncExternalStore` reads it
 * directly and takes an explicit server snapshot, which also makes the
 * hydration answer unambiguous: the server cannot know the preference, so it
 * renders `false` — the safe default for something that is opt-in.
 */
const refinePreference = {
  listeners: new Set<() => void>(),
  read(): boolean {
    try {
      return window.localStorage.getItem(REFINE_KEY) === '1';
    } catch {
      // Private mode or blocked storage. Off is the correct answer when the
      // user's actual choice is unknowable.
      return false;
    }
  },
  write(enabled: boolean): void {
    try {
      window.localStorage.setItem(REFINE_KEY, enabled ? '1' : '0');
    } catch {
      /* preference is session-only if storage is unavailable */
    }
    refinePreference.listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void): () => void {
    refinePreference.listeners.add(listener);
    return () => refinePreference.listeners.delete(listener);
  },
};

interface EngineState {
  tokens: DesignTokens;
  analysis: ImageAnalysis | null;
  capture: Capture | null;
  /** The capture rendered as page material: full photo, duotone and texture tile. */
  imagery: Imagery | null;
  status: 'idle' | 'processing' | 'ready' | 'error';
  error: string | null;
  /** Feed an image element or video frame through the pipeline. */
  ingest: (source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement) => Promise<void>;
  ingestFile: (file: File) => Promise<void>;
  reset: () => void;

  // --- Refinement (opt-in) -------------------------------------------------
  /** Off by default. Nothing reaches the network until this is true. */
  refineEnabled: boolean;
  setRefineEnabled: (enabled: boolean) => void;
  refinement: Refinement | null;
  refineStage: RefinementStage | null;
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

/** Copy the current frame onto a canvas, so later async steps all see the same pixels. */
function freeze(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  if (source instanceof HTMLCanvasElement) return source;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(source, 0, 0, width, height);
  return canvas;
}

export function ThemeEngine({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<DesignTokens>(() => defaultTokens());
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [imagery, setImagery] = useState<Imagery | null>(null);
  const imageryRef = useRef<Imagery | null>(null);
  /** Incremented per capture, so async work from a superseded capture can tell. */
  const captureSeq = useRef(0);
  const [status, setStatus] = useState<EngineState['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);

  const [refinement, setRefinement] = useState<Refinement | null>(null);
  const [refineStage, setRefineStage] = useState<RefinementStage | null>(null);
  /** Cancels an in-flight refinement when a newer capture supersedes it. */
  const refineRun = useRef<AbortController | null>(null);

  const refineEnabled = useSyncExternalStore(
    refinePreference.subscribe,
    refinePreference.read,
    () => false,
  );

  const setRefineEnabled = useCallback((enabled: boolean) => {
    refinePreference.write(enabled);
    if (!enabled) {
      // Switching off mid-flight has to actually stop the request, not just
      // stop the next one.
      refineRun.current?.abort();
      setRefineStage(null);
    }
  }, []);

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
      revokeImagery(imageryRef.current);
    },
    [],
  );

  /**
   * Render the capture into page material and swap it in, releasing the last
   * set of object URLs. The duotone is printed in the palette's colours, so a
   * refinement that changes the palette re-runs this.
   */
  const paintImagery = useCallback(
    async (
      source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
      width: number,
      height: number,
      palette: DesignTokens['palette'],
      isCurrent: () => boolean,
    ) => {
      try {
        const next = await renderImagery(source, width, height, palette);
        // A newer capture finished first; its imagery is on screen.
        if (!isCurrent()) {
          revokeImagery(next);
          return;
        }
        revokeImagery(imageryRef.current);
        imageryRef.current = next;
        applyImagery(next);
        setImagery(next);
      } catch (err) {
        // Imagery is decoration; the theme is complete without it.
        console.warn('[textures] could not render imagery:', err);
      }
    },
    [],
  );

  const ingest = useCallback(
    async (source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement) => {
      setStatus('processing');
      setError(null);
      const seq = ++captureSeq.current;
      const isCurrent = () => seq === captureSeq.current;

      // Yield a frame so the "processing" state can actually paint before the
      // synchronous pixel work blocks the main thread.
      await new Promise((resolve) => requestAnimationFrame(resolve));

      try {
        const started = performance.now();
        const { width, height } = sourceDimensions(source);
        if (!width || !height) throw new Error('The frame has no pixels yet — try again.');

        // A live video moves on while the async steps below run. Freeze the
        // frame once, so analysis, preview and imagery all see the same pixels.
        const frame = freeze(source, width, height);
        const pixels = extractPixels(frame, width, height, ANALYSIS_SIZE);
        const nextAnalysis = analyzeImage(pixels);
        const nextTokens = synthesize(nextAnalysis);
        const elapsedMs = performance.now() - started;
        const preview = toPreview(frame, width, height);

        // Fetch the chosen faces before switching to them (capped, so a slow
        // network never holds the capture), then inject before updating state:
        // the page is already restyled by the time React schedules its render.
        await loadPairing(nextTokens.typography);
        if (!isCurrent()) return;
        applyTokens(nextTokens);
        await paintImagery(frame, width, height, nextTokens.palette, isCurrent);
        if (!isCurrent()) return;

        setTokens(nextTokens);
        setAnalysis(nextAnalysis);
        setRefinement(null);
        setCapture({
          src: preview,
          width,
          height,
          takenAt: Date.now(),
          elapsedMs,
        });
        setStatus('ready');

        // The deterministic theme is now on screen and this capture is complete.
        // Refinement runs after, without awaiting: it either lands as a morph a
        // few seconds later or it doesn't, and the page is finished either way.
        if (!refineEnabled) return;

        refineRun.current?.abort();
        const run = new AbortController();
        refineRun.current = run;

        void refineTheme(nextTokens, nextAnalysis, pixels, preview, {
          signal: run.signal,
          onStage: (stage) => {
            if (!run.signal.aborted) setRefineStage(stage);
          },
        }).then(async (result) => {
          // A newer capture started while this was in flight; its tokens are on
          // screen and this stale result must not overwrite them.
          if (run.signal.aborted || refineRun.current !== run) return;
          if (!result) return;

          await loadPairing(result.tokens.typography);
          if (run.signal.aborted || refineRun.current !== run) return;
          applyTokens(result.tokens);
          setTokens(result.tokens);
          setRefinement(result);
          if (result.tokens.palette.primary !== nextTokens.palette.primary) {
            void paintImagery(frame, width, height, result.tokens.palette, isCurrent);
          }
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that image.');
        setStatus('error');
      }
    },
    [refineEnabled, paintImagery],
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
    captureSeq.current++;
    refineRun.current?.abort();
    const base = defaultTokens();
    applyTokens(base);
    setTokens(base);
    setAnalysis(null);
    setCapture(null);
    revokeImagery(imageryRef.current);
    imageryRef.current = null;
    applyImagery(null);
    setImagery(null);
    setStatus('idle');
    setError(null);
    setRefinement(null);
    setRefineStage(null);
  }, []);

  // A refinement outliving its page would apply tokens to a torn-down DOM.
  useEffect(() => () => refineRun.current?.abort(), []);

  const value = useMemo<EngineState>(
    () => ({
      tokens,
      analysis,
      capture,
      imagery,
      status,
      error,
      ingest,
      ingestFile,
      reset,
      refineEnabled,
      setRefineEnabled,
      refinement,
      refineStage,
    }),
    [
      tokens,
      analysis,
      capture,
      imagery,
      status,
      error,
      ingest,
      ingestFile,
      reset,
      refineEnabled,
      setRefineEnabled,
      refinement,
      refineStage,
    ],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}
