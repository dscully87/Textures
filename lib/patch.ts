/**
 * Applying a scene reading to the design tokens.
 *
 * This is the whole safety boundary between the model and the DOM. `reading.ts`
 * guarantees the payload has the right *shape*; this module decides what it is
 * allowed to *do* — colours are resolved from measured swatches and re-run
 * through every contrast repair, motion is re-clamped against the photograph's
 * own energy, and the loud tier has to earn itself twice.
 *
 * Pure and dependency-free. No network, no DOM, no model — so every gate below
 * is testable with a fixture and a plain object.
 */

import { ImageAnalysis } from './analyze';
import { buildPattern } from './patterns';
import { Swatch } from './quantize';
import { SceneReading } from './ai/reading';
import {
  MOTION_EASE,
  buildLayout,
  buildSurface,
  buildTypography,
  composePalette,
  rankSwatches,
} from './synthesize';
import {
  DesignTokens,
  LayoutTokens,
  MotionTier,
  MotionTokens,
  PatternKind,
} from './tokens';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number, places = 3) => Number(v.toFixed(places));

/**
 * Confidence below which the `signature` tier is refused.
 *
 * A model that isn't sure what it is looking at has not earned the page's one
 * memorable movement, and an unsure guess played loudly is the worst of both.
 */
const SIGNATURE_CONFIDENCE = 0.7;

/**
 * Dynamic-range floor for `signature`. A flat, quiet photograph cannot produce
 * a hyperactive page no matter what the model asks for — the motion has to be
 * in the source, not in the enthusiasm.
 */
const SIGNATURE_DYNAMIC_RANGE = 0.45;

const AMPLITUDE_MAX: Record<MotionTier, number> = {
  ambient: 0.15,
  accent: 0.7,
  signature: 1,
};

const MEASURE: Record<string, number> = { narrow: 58, normal: 68, wide: 78 };
const MOTIF_OPACITY: Record<string, number> = { absent: 0, whisper: 0.05, present: 0.11 };
const MOTIF_SCALE: Record<string, number> = { fine: 0.6, medium: 1, coarse: 1.7 };

/** A record of what the patch changed, and of anything it refused. */
export interface PatchReport {
  applied: string[];
  /** Gates that fired, in plain language. Surfaced in the inspector. */
  refused: string[];
}

export interface PatchResult {
  tokens: DesignTokens;
  report: PatchReport;
}

/**
 * Resolve a swatch index against the measured palette.
 *
 * An out-of-range index has already been rejected by `parseReading`; this exists
 * so a caller with a stale or empty analysis still degrades to the heuristic
 * choice rather than reading `undefined.hex`.
 */
function swatchAt(swatches: Swatch[], index: number | null, fallback: Swatch | undefined) {
  if (index === null) return fallback;
  return swatches[index] ?? fallback;
}

/** Motion, re-clamped against the photograph rather than against the model. */
function patchMotion(
  reading: SceneReading,
  analysis: ImageAnalysis,
  report: PatchReport,
): MotionTokens {
  const m = reading.motion;

  if (m.character === 'still') {
    report.applied.push('motion: still');
    return {
      character: 'still',
      tier: 'ambient',
      amplitude: 0,
      period: 0,
      easing: 'linear',
      trigger: 'none',
    };
  }

  let tier = m.tier;

  // Gate two and three. `reading.ts` already refused an unargued signature; these
  // two refuse an unjustified one, and they are deliberately not overridable by
  // anything the model can say.
  if (tier === 'signature' && reading.confidence < SIGNATURE_CONFIDENCE) {
    tier = 'accent';
    report.refused.push(
      `signature downgraded to accent — confidence ${reading.confidence.toFixed(2)} is below ${SIGNATURE_CONFIDENCE}`,
    );
  }
  if (tier === 'signature' && analysis.texture.dynamicRange < SIGNATURE_DYNAMIC_RANGE) {
    tier = 'accent';
    report.refused.push(
      `signature downgraded to accent — the photograph's dynamic range (${analysis.texture.dynamicRange.toFixed(2)}) does not carry it`,
    );
  }

  // Motion may not exceed the frame's own energy, whatever tier survived.
  const energy = 0.55 + 0.45 * clamp(analysis.texture.dynamicRange, 0, 1);
  const amplitude = round(clamp(m.amplitude, 0, AMPLITUDE_MAX[tier]) * energy, 3);

  // Looping is an ambient-only privilege, and slow even there. Re-checked here
  // because the tier may have just changed underneath the period.
  const period =
    tier === 'ambient'
      ? Math.round(clamp(m.period, 20000, 60000))
      : Math.round(clamp(m.period, 180, tier === 'signature' ? 3200 : 2200));

  report.applied.push(`motion: ${m.character} (${tier})`);

  return {
    character: m.character,
    tier,
    amplitude,
    period,
    easing: MOTION_EASE[m.character],
    trigger: m.trigger,
  };
}

function patchLayout(reading: SceneReading, base: LayoutTokens): LayoutTokens {
  return {
    archetype: reading.layout.archetype,
    heroAlign: reading.layout.heroAlign,
    measure: MEASURE[reading.layout.measure] ?? base.measure,
    featureColumns: reading.layout.featureColumns,
    imageRatio: reading.layout.imageRatio.replace('/', ' / '),
  };
}

/**
 * Apply a validated reading to a set of deterministic tokens.
 *
 * `base` is whatever `synthesize()` produced. Anything the model doesn't speak
 * to survives untouched, which is what makes this a refinement rather than a
 * replacement: a failed or partial reading costs the page nothing.
 */
export function applyReading(
  base: DesignTokens,
  reading: SceneReading,
  analysis: ImageAnalysis,
): PatchResult {
  const report: PatchReport = { applied: [], refused: [] };
  const swatches = analysis.swatches;

  // --- Palette ------------------------------------------------------------
  // The model chose roles among measured colours; `composePalette` then applies
  // the identical treatment the heuristic path gets. There is no route by which
  // a colour reaches the page without passing the contrast repairs.
  const heuristic = rankSwatches(analysis);
  const primarySrc = swatchAt(swatches, reading.palette.primaryIndex, heuristic.primarySrc);

  let palette = base.palette;
  if (primarySrc) {
    palette = composePalette(
      primarySrc,
      swatchAt(swatches, reading.palette.accentIndex, heuristic.accentSrc),
      swatchAt(swatches, reading.palette.neutralIndex, heuristic.secondarySrc),
      base.meta.sourceIsDark,
      analysis.colorfulness,
      analysis.texture.brightness,
    );
    if (primarySrc.hex !== heuristic.primarySrc?.hex) {
      report.applied.push(
        `palette: primary reassigned to ${primarySrc.hex}${
          reading.palette.rationale ? ` — ${reading.palette.rationale}` : ''
        }`,
      );
    }
  }

  // --- Surface ------------------------------------------------------------
  const finish = reading.finishOverride ?? base.surface.finish;
  const surface =
    finish === base.surface.finish && palette === base.palette
      ? base.surface
      : buildSurface(analysis, palette, finish, base.meta.sourceIsDark);
  if (reading.finishOverride && reading.finishOverride !== base.surface.finish) {
    report.applied.push(`finish: ${base.surface.finish} → ${reading.finishOverride}`);
  }

  // --- Typography ---------------------------------------------------------
  const typography =
    reading.voice === base.typography.voice
      ? base.typography
      : buildTypography(reading.voice, analysis);
  if (reading.voice !== base.typography.voice) {
    report.applied.push(`voice: ${base.typography.voice} → ${reading.voice}`);
  }

  // --- Motif --------------------------------------------------------------
  const kind: PatternKind = reading.motif.presence === 'absent' ? 'none' : reading.motif.kind;
  const period = Math.round(
    clamp(base.pattern.period * (MOTIF_SCALE[reading.motif.scale] ?? 1), 8, 96),
  );
  const pattern =
    kind === base.pattern.kind && period === base.pattern.period
      ? base.pattern
      : {
          kind,
          period,
          angle: base.pattern.angle,
          opacity: round(MOTIF_OPACITY[reading.motif.presence] ?? 0.05, 3),
          image:
            kind === 'none'
              ? 'none'
              : buildPattern({
                  kind,
                  period,
                  angle: analysis.periodicity.angle,
                  color: palette.accent,
                  weight: 0.05 + analysis.edges.strength * 0.09,
                }),
        };
  if (kind !== base.pattern.kind) {
    report.applied.push(`motif: ${base.pattern.kind} → ${kind}`);
  }

  // --- Composition & motion ------------------------------------------------
  const layout = patchLayout(reading, base.layout);
  if (layout.archetype !== base.layout.archetype) {
    report.applied.push(`layout: ${base.layout.archetype} → ${layout.archetype}`);
  }

  const motion = patchMotion(reading, analysis, report);
  if (motion.character !== base.motion.character) {
    report.applied.push(`character: ${base.motion.character} → ${motion.character}`);
  }

  return {
    tokens: {
      ...base,
      palette,
      surface,
      typography,
      pattern,
      layout,
      motion,
      meta: {
        ...base.meta,
        // The model's own confidence replaces the proxy formula, which only ever
        // measured whether there was *something* in frame.
        confidence: round(reading.confidence, 2),
        description: reading.subject
          ? `${reading.subject} — ${reading.material}, read as ${reading.context}.`
          : base.meta.description,
      },
    },
    report,
  };
}

/** Re-export for callers that want the layout default without importing synthesize. */
export { buildLayout };
