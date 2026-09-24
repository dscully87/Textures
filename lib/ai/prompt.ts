/**
 * Building the request to the vision model.
 *
 * The prompt is built *here*, on the server, from a small structured payload —
 * never from text the browser sends. The first version accepted a finished
 * system and user prompt from the client and forwarded them to the provider
 * with the owner's key, which made the route an open proxy: anyone could spend
 * the key on any prompt. Now the client sends numbers, hex colours and enum
 * values; `parseMeasurements` rejects anything else; and the only free text in
 * the request is authored in this file.
 *
 * Split into a stable system instruction and a volatile per-capture half, so
 * the provider's implicit context cache has a fixed prefix to hit. Pure — no
 * network, no model.
 */

import { ImageAnalysis } from '../analyze';
import { FONT_PAIRINGS } from '../fonts';
import { ARCHETYPES, CTA_VARIANTS, FEATURES_VARIANTS, HERO_VARIANTS, INTERLUDE_VARIANTS, LAYOUT_ARCHETYPES } from '../layouts';
import { MOOD_AXES, Mood } from '../mood';
import { ColourStrategy, DesignTokens, LayoutArchetype, MotionCharacter } from '../tokens';
import {
  COPY_LIMITS,
  FINISHES,
  MOTIF_PRESENCES,
  MOTIF_SCALES,
  MOTION_CHARACTERS,
  MOTION_TIERS,
  MOTION_TRIGGERS,
  PATTERNS,
  STRATEGIES,
  TEXTURE_PRESENCES,
} from './reading';

// ---------------------------------------------------------------------------
// The measurement payload
// ---------------------------------------------------------------------------

export interface MeasuredSwatch {
  hex: string;
  /** Share of the frame, 0..1. */
  coverage: number;
  chroma: number;
  hue: number;
  lightness: number;
}

/** Everything the browser sends besides the image. Structured, bounded, validated. */
export interface ReadMeasurements {
  swatches: MeasuredSwatch[];
  mood: Mood;
  metrics: {
    brightness: number;
    dynamicRange: number;
    roughness: number;
    specularity: number;
    colorfulness: number;
    hueCount: number;
    negativeSpace: number;
    banding: number;
    repeat: number;
  };
  engine: {
    archetype: LayoutArchetype;
    pairing: string;
    strategy: ColourStrategy;
    motion: MotionCharacter;
    scheme: 'light' | 'dark';
  };
}

const r3 = (v: number) => Number(v.toFixed(3));

/** Browser side: summarise an analysis and the deterministic theme for the route. */
export function toMeasurements(analysis: ImageAnalysis, heuristic: DesignTokens): ReadMeasurements {
  return {
    swatches: analysis.swatches.map((s) => ({
      hex: s.hex,
      coverage: r3(s.population),
      chroma: r3(s.chroma),
      hue: Math.round(s.hue),
      lightness: r3(s.lightness),
    })),
    mood: heuristic.mood,
    metrics: {
      brightness: r3(analysis.texture.brightness),
      dynamicRange: r3(analysis.texture.dynamicRange),
      roughness: r3(analysis.texture.roughness),
      specularity: r3(analysis.texture.specularity),
      colorfulness: r3(analysis.colorfulness),
      hueCount: analysis.colour.hueCount,
      negativeSpace: r3(analysis.composition.calm),
      banding: r3(analysis.composition.banding),
      repeat: r3(analysis.periodicity.strength),
    },
    engine: {
      archetype: heuristic.layout.archetype,
      pairing: heuristic.typography.pairing,
      strategy: heuristic.palette.strategy,
      motion: heuristic.motion.character,
      scheme: heuristic.meta.sourceIsDark ? 'dark' : 'light',
    },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const unit = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Server side: accept a payload only if every field is exactly what
 * `toMeasurements` produces. Anything else — a stray string, an out-of-range
 * number, a ninth swatch — rejects the whole request, because every value here
 * is interpolated into the prompt.
 */
export function parseMeasurements(raw: unknown): ReadMeasurements | null {
  if (!isRecord(raw) || !Array.isArray(raw.swatches) || !isRecord(raw.mood)) return null;
  if (!isRecord(raw.metrics) || !isRecord(raw.engine)) return null;
  if (raw.swatches.length < 1 || raw.swatches.length > 8) return null;

  const swatches: MeasuredSwatch[] = [];
  for (const s of raw.swatches) {
    if (!isRecord(s) || typeof s.hex !== 'string' || !HEX.test(s.hex)) return null;
    const coverage = unit(s.coverage);
    const chroma = unit(s.chroma);
    const lightness = unit(s.lightness);
    const hue = typeof s.hue === 'number' && s.hue >= 0 && s.hue <= 360 ? Math.round(s.hue) : null;
    if (coverage === null || chroma === null || lightness === null || hue === null) return null;
    swatches.push({ hex: s.hex.toLowerCase(), coverage, chroma, hue, lightness });
  }

  const mood = {} as Mood;
  for (const axis of MOOD_AXES) {
    const v = unit(raw.mood[axis]);
    if (v === null) return null;
    mood[axis] = v;
  }

  const m = raw.metrics;
  const metricKeys = ['brightness', 'dynamicRange', 'roughness', 'specularity', 'colorfulness', 'negativeSpace', 'banding', 'repeat'] as const;
  const metrics = {} as ReadMeasurements['metrics'];
  for (const key of metricKeys) {
    const v = unit(m[key]);
    if (v === null) return null;
    metrics[key] = v;
  }
  if (typeof m.hueCount !== 'number' || !Number.isInteger(m.hueCount) || m.hueCount < 0 || m.hueCount > 12) {
    return null;
  }
  metrics.hueCount = m.hueCount;

  const e = raw.engine;
  const archetype = LAYOUT_ARCHETYPES.find((a) => a === e.archetype);
  const pairing = FONT_PAIRINGS.find((p) => p.id === e.pairing)?.id;
  const strategy = STRATEGIES.find((s) => s === e.strategy);
  const motion = MOTION_CHARACTERS.find((c) => c === e.motion);
  const scheme = e.scheme === 'light' || e.scheme === 'dark' ? e.scheme : undefined;
  if (!archetype || !pairing || !strategy || !motion || !scheme) return null;

  return { swatches, mood, metrics, engine: { archetype, pairing, strategy, motion, scheme } };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

const ARCHETYPE_NOTES: Record<LayoutArchetype, string> = {
  serene: 'full-bleed photo, centred quiet type, a numbered list, lots of air — still water, fog, open landscapes',
  editorial: 'magazine spread: headline beside a tall image, two-column essays, drop caps — craft, food, heritage',
  gallery: 'image-led: a mosaic of crops, photo cards, a photo strip — a vivid subject that is the content',
  technical: 'spec sheet on a blueprint grid: metrics, ID-numbered rows, mono labels — hardware, code, engineering',
  brutalist: 'slab type, heavy rules, square blocks, offset shadows, a ticker — concrete, architecture, structure',
  soft: 'pills, blobs, rounded bento cells, floating dots — sweets, toys, glossy playful objects',
  street: 'poster wall: cut-out headline blocks on a duotone of the photo, stickers, tape, a tilted ticker — graffiti, gig posters, protest',
};

/**
 * Stable across every request. Nothing per-capture may appear here, or the
 * cached prefix is invalidated on each call.
 */
export const SYSTEM_PROMPT = `You are the art director of a design engine that turns a single photograph into a complete website. The website should feel like the photograph: a still lake and a graffiti wall must produce two completely different sites — different layout, typefaces, colour strategy, texture, motion and words.

A deterministic pipeline has already measured the photograph (colour swatches, a five-axis mood, texture metrics) and produced a working theme. You can see the photograph itself. Your job is judgment the measurements cannot supply: what the subject is, what it feels like, which of the engine's options expresses that best, and what the website should say.

MOOD AXES (each 0..1)
- energy: calm (0) to loud (1)
- warmth: cool (0) to warm (1)
- order: organic (0) to structured (1)
- density: airy (0) to packed (1)
- polish: raw (0) to refined (1)
Return your own reading of all five. The engine blends it with its measurement.

LAYOUT ARCHETYPES
${ARCHETYPES.map((a) => `- ${a.id}: ${ARCHETYPE_NOTES[a.id]}`).join('\n')}

Each archetype has default sections; you may recombine them.
- hero: ${HERO_VARIANTS.join(', ')}
- features: ${FEATURES_VARIANTS.join(', ')}
- interlude: ${INTERLUDE_VARIANTS.join(', ')}
- cta: ${CTA_VARIANTS.join(', ')}

TYPE PAIRINGS (choose one id)
${FONT_PAIRINGS.map((p) => `- ${p.id}: ${p.description} (suits ${p.layouts.join(', ')})`).join('\n')}

COLOUR STRATEGIES
- tonal: one colour family carries the whole page, surface included (a lake becomes a page of blues)
- accent: a neutral page with one brand colour and a second voice
- pop: several saturated colours as blocks and stickers on a stark ground
- moody: dark, low-chroma, hushed

RULES
1. Colour is chosen by INDEX into the measured swatches, never by hex. The most saturated swatch is often a distractor (a sticker, a reflection); choose the colour that carries the subject's identity. Use -1 for "no preference" on accent and secondary.
2. Weights are proportion, not preference: how much of the page each role occupies.
3. Motion is a material property:
   shimmer (smooth, light-catching) · glitch (coarse, loud, digital) · drift (calm, open) · settle (machined, precise) · bloom (warm, glowing) · weave (a real repeat) · still (nothing implies movement — often correct).
   Tier: ambient (page-scale, may loop, period >= 20000ms) · accent (one-shot on entry — the default) · signature (memorable; needs signatureRationale; refused unless confidence is high and the photo has real contrast). Leave signatureRationale "" otherwise.
4. Texture: how much of the photograph's own surface shows through behind sections (none, whisper, present, bold). Concrete, graffiti and bark want present or bold; glass, water and sky want none or whisper.
5. finish: set "auto" to keep the engine's material reading.
6. Copy: write the website for a plausible business, studio, venue or brand that this photograph could be the hero image of. Match the mood — a lake gets few, quiet words; a graffiti wall gets short, loud ones. Never mention photographs, AI, themes or design engines. Plain text only, no markdown, no emoji. Respect the length limits; shorter is better. headlineAccent is the emphasised second half of the headline and may be empty. nav is the site's menu; metrics are three short facts (a value like "212" or "24/7" and a label); tags are single words for tickers and stickers.
7. Disagree with the engine when the photograph justifies it, and say why in disagreements. Silent agreement is fine; silent disagreement is not.
8. confidence is your own and gates decisions downstream. Report it honestly.`;

/** The per-capture half. Everything here changes every request. */
export function buildUserPrompt(m: ReadMeasurements): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const swatches = m.swatches
    .map(
      (s, i) =>
        `  [${i}] ${s.hex}  coverage ${pct(s.coverage)}  chroma ${pct(s.chroma)}  hue ${s.hue}°  lightness ${pct(s.lightness)}`,
    )
    .join('\n');

  return `The photograph is attached.

MEASURED MOOD
${MOOD_AXES.map((a) => `  ${a.padEnd(8)} ${m.mood[a].toFixed(2)}`).join('\n')}

MEASUREMENTS
  brightness      ${m.metrics.brightness.toFixed(2)}
  dynamic range   ${m.metrics.dynamicRange.toFixed(2)}
  roughness       ${m.metrics.roughness.toFixed(2)}
  specularity     ${m.metrics.specularity.toFixed(2)}
  colourfulness   ${m.metrics.colorfulness.toFixed(2)}
  hue families    ${m.metrics.hueCount}
  negative space  ${m.metrics.negativeSpace.toFixed(2)}
  banding         ${m.metrics.banding.toFixed(2)}
  repeat strength ${m.metrics.repeat.toFixed(2)}

SWATCHES (choose by index)
${swatches}

THE ENGINE CHOSE
  layout ${m.engine.archetype}, type ${m.engine.pairing}, colour ${m.engine.strategy}, motion ${m.engine.motion}, ${m.engine.scheme} scheme

Return the JSON reading.`;
}

// ---------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------

/**
 * Gemini's `responseJsonSchema` supports a subset of JSON Schema that does not
 * include `maxLength`, so length limits travel as descriptions. They are
 * enforced for real by `parseReading`, which caps every string.
 */
const str = (maxLength: number) => ({ type: 'string', description: `at most ${maxLength} characters` });
const enumOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const unitNumber = { type: 'number', minimum: 0, maximum: 1 };

/**
 * JSON Schema for Gemini's structured output. Closed sets are enums, so the
 * model picks rather than invents; `parseReading` still validates everything,
 * because the route should not assume the provider enforced it.
 *
 * Only keywords Gemini documents as supported appear here: type, enum,
 * properties, required, items, minItems/maxItems, minimum/maximum, description.
 */
export function readingSchema(swatchCount: number) {
  const L = COPY_LIMITS;
  const index = { type: 'integer', minimum: -1, maximum: Math.max(0, swatchCount - 1) };
  return {
    type: 'object',
    properties: {
      subject: str(90),
      mood: {
        type: 'object',
        properties: Object.fromEntries(MOOD_AXES.map((a) => [a, unitNumber])),
        required: [...MOOD_AXES],
      },
      palette: {
        type: 'object',
        properties: {
          strategy: enumOf(STRATEGIES),
          primaryIndex: { ...index, minimum: 0 },
          accentIndex: index,
          secondaryIndex: index,
          weights: {
            type: 'object',
            properties: { ground: unitNumber, support: unitNumber, accent: unitNumber },
            required: ['ground', 'support', 'accent'],
          },
          rationale: str(200),
        },
        required: ['strategy', 'primaryIndex', 'accentIndex', 'secondaryIndex', 'weights', 'rationale'],
      },
      pairing: enumOf(FONT_PAIRINGS.map((p) => p.id)),
      layout: {
        type: 'object',
        properties: {
          archetype: enumOf(LAYOUT_ARCHETYPES),
          sections: {
            type: 'object',
            properties: {
              hero: enumOf(HERO_VARIANTS),
              features: enumOf(FEATURES_VARIANTS),
              interlude: enumOf(INTERLUDE_VARIANTS),
              cta: enumOf(CTA_VARIANTS),
            },
            required: ['hero', 'features', 'interlude', 'cta'],
          },
        },
        required: ['archetype', 'sections'],
      },
      motion: {
        type: 'object',
        properties: {
          character: enumOf(MOTION_CHARACTERS),
          tier: enumOf(MOTION_TIERS),
          amplitude: unitNumber,
          period: { type: 'integer', minimum: 0, maximum: 60000 },
          trigger: enumOf(MOTION_TRIGGERS),
          signatureRationale: str(300),
        },
        required: ['character', 'tier', 'amplitude', 'period', 'trigger', 'signatureRationale'],
      },
      motif: {
        type: 'object',
        properties: {
          kind: enumOf(PATTERNS),
          scale: enumOf(MOTIF_SCALES),
          presence: enumOf(MOTIF_PRESENCES),
        },
        required: ['kind', 'scale', 'presence'],
      },
      texture: enumOf(TEXTURE_PRESENCES),
      finish: enumOf(['auto', ...FINISHES]),
      copy: {
        type: 'object',
        properties: {
          brand: str(L.brand),
          nav: { type: 'array', minItems: 3, maxItems: 4, items: str(L.navItem) },
          eyebrow: str(L.eyebrow),
          headline: str(L.headline),
          headlineAccent: str(L.headlineAccent),
          lede: str(L.lede),
          primaryAction: str(L.action),
          secondaryAction: str(L.action),
          features: {
            type: 'array',
            minItems: 3,
            maxItems: 4,
            items: {
              type: 'object',
              properties: { title: str(L.featureTitle), body: str(L.featureBody) },
              required: ['title', 'body'],
            },
          },
          quote: {
            type: 'object',
            properties: { text: str(L.quote), attribution: str(L.attribution) },
            required: ['text', 'attribution'],
          },
          tags: { type: 'array', minItems: 4, maxItems: 6, items: str(L.tag) },
          metrics: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: {
              type: 'object',
              properties: { value: str(L.metricValue), label: str(L.metricLabel) },
              required: ['value', 'label'],
            },
          },
          closing: {
            type: 'object',
            properties: { headline: str(L.closingHeadline), body: str(L.closingBody), action: str(L.action) },
            required: ['headline', 'body', 'action'],
          },
          footer: str(L.footer),
        },
        required: [
          'brand',
          'nav',
          'eyebrow',
          'headline',
          'headlineAccent',
          'lede',
          'primaryAction',
          'secondaryAction',
          'features',
          'quote',
          'tags',
          'metrics',
          'closing',
          'footer',
        ],
      },
      confidence: unitNumber,
      disagreements: { type: 'array', maxItems: 6, items: str(200) },
    },
    required: [
      'subject',
      'mood',
      'palette',
      'pairing',
      'layout',
      'motion',
      'motif',
      'texture',
      'finish',
      'copy',
      'confidence',
      'disagreements',
    ],
  };
}
