'use client';

/** Small live-region readout for capture state, the refinement opt-in, and a reset. */

import { useEngine } from './ThemeEngine';

const STAGE_LABEL: Record<string, string> = {
  classifying: 'Recognising the subject…',
  reading: 'Interpreting…',
  settled: 'Settled',
  skipped: '',
};

/**
 * Why a refinement didn't happen, in words.
 *
 * Refinement is designed to fail invisibly, which is right for a visitor and
 * unhelpful for whoever is wiring the deploy up. These are shown only when the
 * user has explicitly opted in — having asked for it, they are owed an
 * explanation when it doesn't arrive.
 */
const SKIP_LABEL: Record<string, string> = {
  'no-api-key': 'No API key in this environment',
  'no-swatches': 'No usable colour in frame',
  timeout: 'Model timed out — theme unchanged',
  'network-error': 'Could not reach the model',
  'unparseable-json': 'Model returned malformed JSON',
  'invalid-shape': 'Model returned an unusable shape',
  'empty-response': 'Model returned nothing',
  error: 'Refinement failed — theme unchanged',
};

function skipLabel(reason?: string): string {
  if (!reason) return 'Refinement unavailable';
  if (SKIP_LABEL[reason]) return SKIP_LABEL[reason];
  // provider-401, provider-404, provider-402… the status is the diagnosis.
  const provider = reason.match(/^provider-(\d+)$/);
  if (provider) {
    const status = provider[1];
    if (status === '401' || status === '403') return 'Model rejected the API key';
    if (status === '404') return 'Model not found — check DEEPSEEK_MODEL';
    if (status === '402') return 'Model account has no credit';
    if (status === '429') return 'Rate limited by the model provider';
    return `Model provider returned ${status}`;
  }
  return `Refinement unavailable (${reason})`;
}

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

      {/*
        Shown only to someone who asked for refinement and didn't get it. The
        provider's own message is included when there is one, because "model not
        found" and "no credit" are the same bare 4xx from outside and a very
        different fix.
      */}
      {refineEnabled && refineStage?.stage === 'skipped' && (
        <p role="status" className="metric w-full text-ink-muted opacity-70">
          {skipLabel(refineStage.reason)}
          {refineStage.detail ? ` — ${refineStage.detail}` : ''}
        </p>
      )}
    </div>
  );
}
