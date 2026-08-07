'use client';

/** Small live-region readout for capture state, the refinement opt-in, and a reset. */

import { useEngine } from './ThemeEngine';

const STAGE_LABEL: Record<string, string> = {
  classifying: 'Recognising the subject…',
  reading: 'Interpreting…',
  settled: 'Settled',
  skipped: '',
};

export function CaptureStatus() {
  const { status, error, capture, reset, refineEnabled, setRefineEnabled, refineStage, refinement } =
    useEngine();

  // The refinement stage supersedes the base label while it is running, so the
  // progression reads as one continuous settling rather than a finished capture
  // followed by an unexplained second change.
  const stageLabel = refineStage ? STAGE_LABEL[refineStage.stage] : '';

  const label =
    error ??
    (stageLabel && status === 'ready'
      ? stageLabel
      : {
          idle: 'Awaiting a capture',
          processing: 'Analyzing pixels…',
          ready: capture ? `Synthesized in ${capture.elapsedMs.toFixed(0)}ms` : 'Ready',
          error: 'Something went wrong',
        }[status]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p
        role="status"
        aria-live="polite"
        className={`metric rounded-full px-3 py-1.5 ${
          status === 'error' ? 'bg-primary/15 text-primary' : 'bg-ink/[0.06] text-ink-muted'
        }`}
      >
        {label}
        {refinement?.cached ? ' · cached' : ''}
      </p>

      {/*
        Opt-in, off by default. The label says what actually leaves the device,
        which is not the photograph: CLIP runs in this browser, and only the
        resulting labels and the pixel measurements are sent on.
      */}
      <label className="metric flex cursor-pointer items-center gap-2 rounded-full bg-ink/[0.06] px-3 py-1.5 text-ink-muted">
        <input
          type="checkbox"
          checked={refineEnabled}
          onChange={(e) => setRefineEnabled(e.target.checked)}
          className="size-3.5 accent-[var(--color-primary)]"
        />
        AI refinement
        <span className="opacity-60">— sends measurements, not the photo</span>
      </label>

      {status !== 'idle' && (
        <button type="button" className="btn btn-ghost" onClick={reset}>
          Reset
        </button>
      )}
    </div>
  );
}
