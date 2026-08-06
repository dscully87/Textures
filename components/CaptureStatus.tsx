'use client';

/** Small live-region readout for capture state, plus a reset. */

import { useEngine } from './ThemeEngine';

export function CaptureStatus() {
  const { status, error, capture, reset } = useEngine();

  const label =
    error ??
    {
      idle: 'Awaiting a capture',
      processing: 'Analyzing pixels…',
      ready: capture ? `Synthesized in ${capture.elapsedMs.toFixed(0)}ms` : 'Ready',
      error: 'Something went wrong',
    }[status];

  return (
    <div className="flex items-center gap-3">
      <p
        role="status"
        aria-live="polite"
        className={`metric rounded-full px-3 py-1.5 ${
          status === 'error'
            ? 'bg-primary/15 text-primary'
            : 'bg-ink/[0.06] text-ink-muted'
        }`}
      >
        {label}
      </p>
      {status !== 'idle' && (
        <button type="button" className="btn btn-ghost" onClick={reset}>
          Reset
        </button>
      )}
    </div>
  );
}
