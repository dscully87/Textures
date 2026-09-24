/**
 * Applying a scene reading to the design tokens.
 *
 * This is the whole safety boundary between the model and the DOM. `reading.ts`
 * guarantees the payload has the right *shape*; this module decides what it is
 * allowed to *do*. The reading is translated into the same `Decisions` the
 * heuristic engine makes and handed to the same `assemble` — so colours are
 * resolved from measured swatches and re-run through every contrast repair,
 * the model's mood is blended with the measured one rather than replacing it,
 * motion is re-clamped against the photograph's own energy, and the loud tier
 * has to earn itself twice.
 *
 * Pure and dependency-free. No network, no DOM, no model — so every gate below
 * is testable with a fixture and a plain object.
 */

import { ImageAnalysis } from './analyze';
import { ARCHETYPE_COPY, SiteCopy } from './copy';
import { PAIRING_BY_ID } from './fonts';
import { MOOD_AXES, Mood } from './mood';
import { Swatch } from './quantize';
import { SceneReading, TexturePresence } from './ai/reading';
import { Decisions, MOTION_EASE, assemble, describeMood, rankSwatches } from './synthesize';
import { DesignTokens, MotionTier, MotionTokens, PatternKind } from './tokens';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number, places = 3) => Number(v.toFixed(places));

/**
 * Confidence below which the `signature` tier is refused. A model that isn't
 * sure what it is looking at has not earned the page's one memorable movement.
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

/**
 * How far the model's mood moves the measured one. Half: the model sees what
 * the subject *is*, the pixels see what it actually looks like, and neither
 * alone gets to decide how dense or loud the page is.
 */
export const MOOD_BLEND = 0.5;

const TEXTURE_OPACITY: Record<TexturePresence, number> = {
  none: 0,
  whisper: 0.06,
  present: 0.16,
  bold: 0.28,
};

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
 * Resolve a swatch index against the measured palette. An out-of-range index
 * has already been rejected by `parseReading`; this exists so a caller with a
 * stale or empty analysis still degrades rather than reading `undefined.hex`.
 */
function swatchAt(swatches: Swatch[], index: number | null): Swatch | undefined {
  return index === null ? undefined : swatches[index];
}

function blendMood(measured: Mood, read: Mood | null): Mood {
  if (!read) return measured;
  const out = { ...measured };
  for (const axis of MOOD_AXES) out[axis] = round(measured[axis] * (1 - MOOD_BLEND) + read[axis] * MOOD_BLEND);
  return out;
}

/** Motion, re-clamped against the photograph rather than against the model. */
function patchMotion(reading: SceneReading, analysis: ImageAnalysis, report: PatchReport): MotionTokens {
  const m = reading.motion;

  if (m.character === 'still') {
    return { character: 'still', tier: 'ambient', amplitude: 0, period: 0, easing: 'linear', trigger: 'none' };
  }

  let tier = m.tier;

  // Gates two and three. `reading.ts` already refused an unargued signature;
  // these refuse an unjustified one, and nothing the model says overrides them.
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

  // An ambient character is scroll-linked; a one-shot needs something to fire it.
  const trigger = tier === 'ambient' ? 'scroll' : m.trigger === 'none' ? 'view' : m.trigger;

  return { character: m.character, tier, amplitude, period, easing: MOTION_EASE[m.character], trigger };
}

/**
 * Apply a validated reading to a set of deterministic tokens.
 *
 * `base` is whatever `synthesize()` produced. Anything the model doesn't speak
 * to keeps the engine's answer, which is what makes this a refinement rather
 * than a replacement: a failed or partial reading costs the page nothing.
 */
export function applyReading(base: DesignTokens, reading: SceneReading, analysis: ImageAnalysis): PatchResult {
  const report: PatchReport = { applied: [], refused: [] };
  const swatches = analysis.swatches;
  const heuristic = rankSwatches(analysis);

  const mood = blendMood(base.mood, reading.mood);
  const archetype = reading.layout.archetype ?? base.layout.archetype;
  const pairing = PAIRING_BY_ID.get(reading.pairing ?? base.typography.pairing) ?? PAIRING_BY_ID.get(base.typography.pairing)!;

  // --- Motif --------------------------------------------------------------
  const kind: PatternKind = reading.motif.presence === 'absent' ? 'none' : reading.motif.kind;
  const pattern = {
    kind,
    period: Math.round(clamp(base.pattern.period * (MOTIF_SCALE[reading.motif.scale] ?? 1), 8, 96)),
    angle: base.pattern.angle,
    opacity: round(MOTIF_OPACITY[reading.motif.presence] ?? 0.05, 3),
  };

  // --- Copy: the model's words over the archetype's, field by field ---------
  const copy: SiteCopy = { ...ARCHETYPE_COPY[archetype], ...(reading.copy ?? {}) };

  const decisions: Decisions = {
    mood,
    strategy: reading.palette.strategy,
    // The model chose roles among measured colours; `assemble` then applies the
    // identical treatment the heuristic path gets. There is no route by which a
    // colour reaches the page without passing the contrast repairs.
    roles: {
      primary: swatchAt(swatches, reading.palette.primaryIndex) ?? heuristic.primarySrc,
      accent: swatchAt(swatches, reading.palette.accentIndex) ?? heuristic.accentSrc,
      secondary: swatchAt(swatches, reading.palette.secondaryIndex) ?? heuristic.secondarySrc,
    },
    weights: reading.palette.weights,
    archetype,
    sections: reading.layout.sections ?? undefined,
    pairing,
    finish: reading.finishOverride ?? undefined,
    motion: patchMotion(reading, analysis, report),
    pattern,
    textureOpacity: TEXTURE_OPACITY[reading.texture],
    copy,
    // The model's confidence replaces the proxy formula, which only ever
    // measured whether there was *something* in frame.
    confidence: round(reading.confidence, 2),
    description: `${reading.subject} — read as ${describeMood(mood)}.`,
  };

  const tokens = assemble(analysis, decisions);

  // --- Report: what changed against the engine's own answer ----------------
  const note = (label: string, before: string, after: string) => {
    if (before !== after) report.applied.push(`${label}: ${before} → ${after}`);
  };
  note('layout', base.layout.archetype, tokens.layout.archetype);
  note('type', base.typography.label, tokens.typography.label);
  note('colour', base.palette.strategy, tokens.palette.strategy);
  note('primary', base.palette.primary, tokens.palette.primary);
  note('motion', `${base.motion.character} (${base.motion.tier})`, `${tokens.motion.character} (${tokens.motion.tier})`);
  note('finish', base.surface.finish, tokens.surface.finish);
  note('motif', base.pattern.kind, tokens.pattern.kind);
  if (reading.copy) report.applied.push('copy: written for this subject');
  if (reading.palette.rationale) report.applied.push(`palette: ${reading.palette.rationale}`);

  return { tokens, report };
}
