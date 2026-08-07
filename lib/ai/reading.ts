/**
 * The reasoning layer's output contract, and the validator that enforces it.
 *
 * The model is asked for JSON, but JSON-mode guarantees only that the response
 * *parses* — not that it has the right shape, the right enum members, or numbers
 * in range. So nothing here trusts the payload: every field is checked, every
 * number is clamped, and anything unrecognised falls back rather than throwing.
 * A malformed reading degrades to the deterministic theme; it never reaches the
 * DOM and never crashes a capture.
 *
 * Pure and dependency-free: this runs in the route handler, in the browser, and
 * under Node in tests, with no network and no model.
 */

import { ContextLabel, MaterialLabel } from '../vision/labels';
import { Finish, MotionCharacter, MotionTier, MotionTrigger, PatternKind, TypeVoice } from '../tokens';

export type LayoutArchetype = 'editorial' | 'technical' | 'gallery' | 'brutalist' | 'soft';
export type Density = 'tight' | 'normal' | 'airy';
export type Measure = 'narrow' | 'normal' | 'wide';
export type MotifPresence = 'absent' | 'whisper' | 'present';
export type MotifScale = 'fine' | 'medium' | 'coarse';

export interface ReadingPalette {
  /** Index into `analysis.swatches`. The model assigns roles; it never invents colour. */
  primaryIndex: number;
  accentIndex: number | null;
  neutralIndex: number | null;
  /** 60/30/10, normalised to sum 1. Proportion is what statistics cannot supply. */
  weights: { ground: number; support: number; accent: number };
  rationale: string;
}

export interface ReadingMotion {
  character: MotionCharacter;
  tier: MotionTier;
  amplitude: number;
  period: number;
  trigger: MotionTrigger;
  /** Required for `signature`. Forcing an argument in writing is the first gate. */
  signatureRationale: string | null;
}

export interface ReadingLayout {
  archetype: LayoutArchetype;
  heroAlign: 'left' | 'center';
  density: Density;
  measure: Measure;
  featureColumns: 2 | 3 | 4;
  imageRatio: '1/1' | '4/3' | '3/2' | '16/9';
}

export interface SceneReading {
  subject: string;
  material: MaterialLabel;
  context: ContextLabel;
  palette: ReadingPalette;
  motion: ReadingMotion;
  layout: ReadingLayout;
  motif: { kind: PatternKind; scale: MotifScale; presence: MotifPresence };
  voice: TypeVoice;
  finishOverride: Finish | null;
  confidence: number;
  /** Where it overrode the heuristics, and why. Shown in the inspector. */
  disagreements: string[];
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const MOTION_CHARACTERS: MotionCharacter[] = [
  'still',
  'shimmer',
  'glitch',
  'drift',
  'settle',
  'bloom',
  'weave',
];
const MOTION_TIERS: MotionTier[] = ['ambient', 'accent', 'signature'];
const MOTION_TRIGGERS: MotionTrigger[] = ['none', 'scroll', 'view', 'hover'];
const LAYOUTS: LayoutArchetype[] = ['editorial', 'technical', 'gallery', 'brutalist', 'soft'];
const VOICES: TypeVoice[] = ['technical', 'neutral', 'editorial', 'friendly'];
const FINISHES: Finish[] = ['glossy', 'metallic', 'matte', 'rough', 'soft'];
const PATTERNS: PatternKind[] = [
  'none',
  'stripes',
  'grid',
  'dots',
  'chevron',
  'weave',
  'scatter',
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accept a value only if it is a member of the allowed set; otherwise fall back. */
function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(value: unknown, fallback: string, maxLength = 240): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

/**
 * An index is only usable if it actually addresses a measured swatch.
 *
 * Deliberately strict about type: a stringly-typed index means the payload is
 * malformed, and falling back to the heuristic choice is a better response than
 * coercing it. This is the boundary that stops a colour reaching the page
 * without having been measured, so it does not do favours.
 */
function swatchIndex(value: unknown, swatchCount: number, fallback: number | null): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  if (value < 0 || value >= swatchCount) return fallback;
  return value;
}

/**
 * One weight of the ground/support/accent split.
 *
 * Not clamped to 0..1 before normalising — a model that answers in percentages
 * (60/30/10) or any other scale is expressing a perfectly good ratio, and
 * clamping first would flatten all three to 1 and hand back an even split,
 * silently discarding the proportion this field exists to carry.
 */
function weight(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

// ---------------------------------------------------------------------------
// Motion clamps
// ---------------------------------------------------------------------------

/**
 * Per-tier bounds on period.
 *
 * The `ambient` floor is the rule that keeps looping motion unobtrusive: a loop
 * is only permitted in that tier, and only at 20s or slower. Everything else is
 * a one-shot on entry, which is why its ceiling is measured in hundreds of ms.
 */
const PERIOD_BOUNDS: Record<MotionTier, { min: number; max: number }> = {
  ambient: { min: 20000, max: 60000 },
  accent: { min: 180, max: 2200 },
  signature: { min: 300, max: 3200 },
};

/** Amplitude ceilings. Ambient stays whisper-quiet by construction. */
const AMPLITUDE_MAX: Record<MotionTier, number> = {
  ambient: 0.15,
  accent: 0.7,
  signature: 1,
};

function parseMotion(raw: unknown): ReadingMotion {
  const r = isRecord(raw) ? raw : {};
  const character = oneOf(r.character, MOTION_CHARACTERS, 'still');

  // `still` is not a tier decision — if nothing moves, nothing about the tier,
  // period or trigger can matter, and letting them through invites a
  // "still but signature" reading that means nothing.
  if (character === 'still') {
    return {
      character,
      tier: 'ambient',
      amplitude: 0,
      period: 0,
      trigger: 'none',
      signatureRationale: null,
    };
  }

  let tier = oneOf(r.tier, MOTION_TIERS, 'accent');
  const rationale =
    typeof r.signatureRationale === 'string' && r.signatureRationale.trim().length >= 12
      ? r.signatureRationale.trim().slice(0, 300)
      : null;

  // Gate one: signature has to be argued for. An unargued signature is an
  // accent — the model does not get the loud option by leaving a field blank.
  if (tier === 'signature' && !rationale) tier = 'accent';

  const bounds = PERIOD_BOUNDS[tier];
  return {
    character,
    tier,
    amplitude: num(r.amplitude, 0.4, 0, AMPLITUDE_MAX[tier]),
    period: Math.round(num(r.period, tier === 'ambient' ? 24000 : 800, bounds.min, bounds.max)),
    trigger: oneOf(r.trigger, MOTION_TRIGGERS, tier === 'ambient' ? 'scroll' : 'view'),
    signatureRationale: tier === 'signature' ? rationale : null,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Validate and normalise a raw model response.
 *
 * `swatchCount` bounds the palette indices — an index outside the measured
 * swatches is the one way the model could smuggle in a colour that isn't in the
 * photograph, so it is rejected rather than clamped to an arbitrary neighbour.
 *
 * Returns `null` only when the payload is unusable as an object at all.
 */
export function parseReading(raw: unknown, swatchCount: number): SceneReading | null {
  if (!isRecord(raw)) return null;
  if (swatchCount <= 0) return null;

  const paletteRaw = isRecord(raw.palette) ? raw.palette : {};
  const weightsRaw = isRecord(paletteRaw.weights) ? paletteRaw.weights : {};
  const layoutRaw = isRecord(raw.layout) ? raw.layout : {};
  const motifRaw = isRecord(raw.motif) ? raw.motif : {};

  // Normalise the 60/30/10 split rather than trusting it to sum to 1.
  const ground = weight(weightsRaw.ground, 0.6);
  const support = weight(weightsRaw.support, 0.3);
  const accent = weight(weightsRaw.accent, 0.1);
  const total = ground + support + accent || 1;

  const columns = num(layoutRaw.featureColumns, 3, 2, 4);

  return {
    subject: str(raw.subject, 'unidentified subject', 120),
    material: oneOf(raw.material, [
      'metal',
      'stone',
      'wood',
      'textile',
      'glass',
      'plastic',
      'organic',
      'paper',
      'liquid',
      'composite',
    ] as MaterialLabel[], 'composite'),
    context: oneOf(raw.context, [
      'industrial',
      'natural',
      'domestic',
      'clinical',
      'editorial',
      'luxury',
      'utilitarian',
      'archival',
    ] as ContextLabel[], 'utilitarian'),

    palette: {
      primaryIndex: swatchIndex(paletteRaw.primaryIndex, swatchCount, 0) ?? 0,
      accentIndex: swatchIndex(paletteRaw.accentIndex, swatchCount, null),
      neutralIndex: swatchIndex(paletteRaw.neutralIndex, swatchCount, null),
      weights: {
        ground: Number((ground / total).toFixed(3)),
        support: Number((support / total).toFixed(3)),
        accent: Number((accent / total).toFixed(3)),
      },
      rationale: str(paletteRaw.rationale, ''),
    },

    motion: parseMotion(raw.motion),

    layout: {
      archetype: oneOf(layoutRaw.archetype, LAYOUTS, 'technical'),
      heroAlign: oneOf(layoutRaw.heroAlign, ['left', 'center'] as const, 'left'),
      density: oneOf(layoutRaw.density, ['tight', 'normal', 'airy'] as Density[], 'normal'),
      measure: oneOf(layoutRaw.measure, ['narrow', 'normal', 'wide'] as Measure[], 'normal'),
      featureColumns: (columns === 2 || columns === 4 ? columns : 3) as 2 | 3 | 4,
      imageRatio: oneOf(layoutRaw.imageRatio, ['1/1', '4/3', '3/2', '16/9'] as const, '4/3'),
    },

    motif: {
      kind: oneOf(motifRaw.kind, PATTERNS, 'none'),
      scale: oneOf(motifRaw.scale, ['fine', 'medium', 'coarse'] as MotifScale[], 'medium'),
      presence: oneOf(
        motifRaw.presence,
        ['absent', 'whisper', 'present'] as MotifPresence[],
        'whisper',
      ),
    },

    voice: oneOf(raw.voice, VOICES, 'neutral'),
    finishOverride: typeof raw.finishOverride === 'string'
      ? oneOf(raw.finishOverride, FINISHES, 'matte')
      : null,
    confidence: num(raw.confidence, 0.5, 0, 1),
    disagreements: Array.isArray(raw.disagreements)
      ? raw.disagreements
          .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
          .slice(0, 6)
          .map((d) => d.trim().slice(0, 200))
      : [],
  };
}
