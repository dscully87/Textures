/**
 * The model's output contract, and the validator that enforces it.
 *
 * Gemini is asked for JSON against a schema, which guarantees the response
 * *parses* and mostly has the right shape — not that every number is in range
 * or that the route wasn't handed something else entirely. So nothing here
 * trusts the payload: every field is checked, every number clamped, every
 * string length-capped, and anything unrecognised falls back to "keep the
 * engine's own answer" rather than throwing. A malformed reading degrades to
 * the deterministic theme; it never reaches the DOM and never crashes a capture.
 *
 * Pure and dependency-free: this runs in the route handler, in the browser, and
 * under Node in tests.
 */

import { SiteCopy } from '../copy';
import { PAIRING_BY_ID } from '../fonts';
import {
  ARCHETYPE_BY_ID,
  CTA_VARIANTS,
  FEATURES_VARIANTS,
  HERO_VARIANTS,
  INTERLUDE_VARIANTS,
  LAYOUT_ARCHETYPES,
} from '../layouts';
import { MOOD_AXES, Mood } from '../mood';
import {
  ColourStrategy,
  Finish,
  LayoutArchetype,
  MotionCharacter,
  MotionTier,
  MotionTrigger,
  PatternKind,
  SectionPlan,
} from '../tokens';

export type MotifScale = 'fine' | 'medium' | 'coarse';
export type MotifPresence = 'absent' | 'whisper' | 'present';
export type TexturePresence = 'none' | 'whisper' | 'present' | 'bold';

export interface ReadingPalette {
  strategy: ColourStrategy;
  /** Index into the measured swatches. The model assigns roles; it never invents colour. */
  primaryIndex: number;
  accentIndex: number | null;
  secondaryIndex: number | null;
  /** Ground / support / accent proportions, normalised to sum to 1. */
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

export interface SceneReading {
  /** What the model thinks the photograph shows, in a few words. */
  subject: string;
  /** The model's own reading of the five axes, blended with the measured mood. Null if absent. */
  mood: Mood | null;
  palette: ReadingPalette;
  /** A pairing id from `lib/fonts.ts`, or null to keep the engine's choice. */
  pairing: string | null;
  layout: { archetype: LayoutArchetype | null; sections: SectionPlan | null };
  motion: ReadingMotion;
  motif: { kind: PatternKind; scale: MotifScale; presence: MotifPresence };
  texture: TexturePresence;
  finishOverride: Finish | null;
  /** Copy for the page. Missing fields fall back to the archetype's copy. */
  copy: Partial<SiteCopy> | null;
  confidence: number;
  /** Where it overrode the engine, and why. Shown in the inspector. */
  disagreements: string[];
}

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const MOTION_CHARACTERS: MotionCharacter[] = ['still', 'shimmer', 'glitch', 'drift', 'settle', 'bloom', 'weave'];
export const MOTION_TIERS: MotionTier[] = ['ambient', 'accent', 'signature'];
export const MOTION_TRIGGERS: MotionTrigger[] = ['none', 'scroll', 'view'];
export const STRATEGIES: ColourStrategy[] = ['tonal', 'accent', 'pop', 'moody'];
export const FINISHES: Finish[] = ['glossy', 'metallic', 'matte', 'rough', 'soft'];
export const PATTERNS: PatternKind[] = ['none', 'stripes', 'grid', 'dots', 'chevron', 'weave', 'scatter'];
export const MOTIF_SCALES: MotifScale[] = ['fine', 'medium', 'coarse'];
export const MOTIF_PRESENCES: MotifPresence[] = ['absent', 'whisper', 'present'];
export const TEXTURE_PRESENCES: TexturePresence[] = ['none', 'whisper', 'present', 'bold'];

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accept a value only if it is a member of the allowed set; otherwise fall back. */
function oneOf<T extends string, F>(value: unknown, allowed: readonly T[], fallback: F): T | F {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * A display string: trimmed, control characters stripped, length-capped. React
 * renders these as text nodes, so markup in them is inert — the caps are about
 * layout, not escaping.
 */
export function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= maxLength) return clean;
  // Cut at a word boundary so a capped headline doesn't end mid-word.
  const cut = clean.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(' ');
  return (space > maxLength * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

/**
 * An index is only usable if it actually addresses a measured swatch.
 *
 * Deliberately strict about type: a stringly-typed index means the payload is
 * malformed, and falling back to the heuristic choice is a better response than
 * coercing it. This is the boundary that stops a colour reaching the page
 * without having been measured, so it does not do favours. The schema uses -1
 * for "no preference", which lands here as null.
 */
function swatchIndex(value: unknown, swatchCount: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value >= swatchCount) return null;
  return value;
}

/**
 * One weight of the ground/support/accent split. Not clamped to 0..1 before
 * normalising — a model that answers in percentages (60/30/10) is expressing a
 * perfectly good ratio, and clamping first would flatten it to an even split.
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
 * Per-tier bounds on period. The `ambient` floor is the rule that keeps looping
 * motion unobtrusive: a loop is only permitted in that tier, and only at 20s or
 * slower. Everything else is a one-shot on entry.
 */
export const PERIOD_BOUNDS: Record<MotionTier, { min: number; max: number }> = {
  ambient: { min: 20000, max: 60000 },
  accent: { min: 180, max: 2200 },
  signature: { min: 300, max: 3200 },
};

/** Amplitude ceilings. Ambient stays whisper-quiet by construction. */
export const AMPLITUDE_MAX: Record<MotionTier, number> = {
  ambient: 0.15,
  accent: 0.7,
  signature: 1,
};

function parseMotion(raw: unknown): ReadingMotion {
  const r = isRecord(raw) ? raw : {};
  const character = oneOf(r.character, MOTION_CHARACTERS, 'still' as const);

  // `still` is not a tier decision — if nothing moves, nothing about the tier,
  // period or trigger can matter.
  if (character === 'still') {
    return { character, tier: 'ambient', amplitude: 0, period: 0, trigger: 'none', signatureRationale: null };
  }

  let tier = oneOf(r.tier, MOTION_TIERS, 'accent' as const);
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
    trigger: oneOf(r.trigger, MOTION_TRIGGERS, tier === 'ambient' ? ('scroll' as const) : ('view' as const)),
    signatureRationale: tier === 'signature' ? rationale : null,
  };
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** Length caps sized to the layouts: a headline longer than this breaks a poster. */
export const COPY_LIMITS = {
  brand: 28,
  eyebrow: 48,
  headline: 48,
  headlineAccent: 48,
  lede: 220,
  action: 24,
  featureTitle: 28,
  featureBody: 160,
  quote: 150,
  attribution: 48,
  tag: 18,
  closingHeadline: 60,
  closingBody: 140,
  footer: 64,
  navItem: 16,
  metricValue: 10,
  metricLabel: 32,
} as const;

function parseCopy(raw: unknown): Partial<SiteCopy> | null {
  if (!isRecord(raw)) return null;
  const L = COPY_LIMITS;
  const out: Partial<SiteCopy> = {};

  const set = <K extends keyof SiteCopy>(key: K, value: SiteCopy[K] | null) => {
    if (value !== null) out[key] = value;
  };

  set('brand', text(raw.brand, L.brand));
  set('eyebrow', text(raw.eyebrow, L.eyebrow));
  set('headline', text(raw.headline, L.headline));
  set('headlineAccent', text(raw.headlineAccent, L.headlineAccent));
  set('lede', text(raw.lede, L.lede));
  set('primaryAction', text(raw.primaryAction, L.action));
  set('secondaryAction', text(raw.secondaryAction, L.action));
  set('footer', text(raw.footer, L.footer));

  if (Array.isArray(raw.features)) {
    const features = raw.features
      .filter(isRecord)
      .map((f) => ({ title: text(f.title, L.featureTitle), body: text(f.body, L.featureBody) }))
      .filter((f): f is { title: string; body: string } => Boolean(f.title && f.body))
      .slice(0, 4);
    if (features.length >= 2) out.features = features;
  }

  if (Array.isArray(raw.nav)) {
    const nav = raw.nav
      .map((n) => text(n, L.navItem))
      .filter((n): n is string => Boolean(n))
      .slice(0, 4);
    if (nav.length >= 2) out.nav = nav;
  }

  if (Array.isArray(raw.metrics)) {
    const metrics = raw.metrics
      .filter(isRecord)
      .map((m) => ({ value: text(m.value, L.metricValue), label: text(m.label, L.metricLabel) }))
      .filter((m): m is { value: string; label: string } => Boolean(m.value && m.label))
      .slice(0, 3);
    // The metric layouts are three-up; a partial set would leave a hole.
    if (metrics.length === 3) out.metrics = metrics;
  }

  if (isRecord(raw.quote)) {
    const quoteText = text(raw.quote.text, L.quote);
    const attribution = text(raw.quote.attribution, L.attribution);
    if (quoteText && attribution) {
      out.quote = { text: quoteText.replace(/^["“]+|["”]+$/g, ''), attribution };
    }
  }

  if (Array.isArray(raw.tags)) {
    const tags = raw.tags
      .map((t) => text(t, L.tag))
      .filter((t): t is string => Boolean(t))
      .slice(0, 6);
    if (tags.length >= 3) out.tags = tags;
  }

  if (isRecord(raw.closing)) {
    const headline = text(raw.closing.headline, L.closingHeadline);
    const body = text(raw.closing.body, L.closingBody);
    const action = text(raw.closing.action, L.action);
    if (headline && body && action) out.closing = { headline, body, action };
  }

  // A page with no headline is not the model's page; keep the engine's copy whole.
  return out.headline ? out : null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function parseMood(raw: unknown): Mood | null {
  if (!isRecord(raw)) return null;
  const values = MOOD_AXES.map((axis) => num(raw[axis], NaN, 0, 1));
  if (values.some((v) => Number.isNaN(v))) return null;
  return Object.fromEntries(MOOD_AXES.map((axis, i) => [axis, values[i]])) as unknown as Mood;
}

function parseSections(raw: unknown, archetype: LayoutArchetype | null): SectionPlan | null {
  const base = archetype ? ARCHETYPE_BY_ID.get(archetype)?.sections : undefined;
  if (!isRecord(raw)) return base ? { ...base } : null;
  const fallback: SectionPlan = base ?? { hero: 'split', features: 'cards', interlude: 'quote', cta: 'banner' };
  return {
    hero: oneOf(raw.hero, HERO_VARIANTS, fallback.hero),
    features: oneOf(raw.features, FEATURES_VARIANTS, fallback.features),
    interlude: oneOf(raw.interlude, INTERLUDE_VARIANTS, fallback.interlude),
    cta: oneOf(raw.cta, CTA_VARIANTS, fallback.cta),
  };
}

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

  const ground = weight(weightsRaw.ground, 0.6);
  const support = weight(weightsRaw.support, 0.3);
  const accent = weight(weightsRaw.accent, 0.1);
  const total = ground + support + accent || 1;

  const archetype = oneOf(layoutRaw.archetype, LAYOUT_ARCHETYPES, null);
  const pairing = typeof raw.pairing === 'string' && PAIRING_BY_ID.has(raw.pairing) ? raw.pairing : null;

  return {
    subject: text(raw.subject, 90) ?? 'unidentified subject',
    mood: parseMood(raw.mood),
    palette: {
      strategy: oneOf(paletteRaw.strategy, STRATEGIES, 'accent' as const),
      primaryIndex: swatchIndex(paletteRaw.primaryIndex, swatchCount) ?? 0,
      accentIndex: swatchIndex(paletteRaw.accentIndex, swatchCount),
      secondaryIndex: swatchIndex(paletteRaw.secondaryIndex, swatchCount),
      weights: {
        ground: Number((ground / total).toFixed(3)),
        support: Number((support / total).toFixed(3)),
        accent: Number((accent / total).toFixed(3)),
      },
      rationale: text(paletteRaw.rationale, 200) ?? '',
    },
    pairing,
    layout: { archetype, sections: parseSections(layoutRaw.sections, archetype) },
    motion: parseMotion(raw.motion),
    motif: {
      kind: oneOf(motifRaw.kind, PATTERNS, 'none' as const),
      scale: oneOf(motifRaw.scale, MOTIF_SCALES, 'medium' as const),
      presence: oneOf(motifRaw.presence, MOTIF_PRESENCES, 'whisper' as const),
    },
    texture: oneOf(raw.texture, TEXTURE_PRESENCES, 'whisper' as const),
    finishOverride: oneOf(raw.finish, FINISHES, null),
    copy: parseCopy(raw.copy),
    confidence: num(raw.confidence, 0.5, 0, 1),
    disagreements: Array.isArray(raw.disagreements)
      ? raw.disagreements
          .map((d) => text(d, 200))
          .filter((d): d is string => Boolean(d))
          .slice(0, 6)
      : [],
  };
}
