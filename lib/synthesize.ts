/**
 * Synthesis: analysis numbers in, design tokens out.
 *
 * This is the opinionated half of the engine. `analyze.ts` measures the
 * photograph; this module decides what those measurements *mean* for an
 * interface — which color leads, how round the corners get, whether the
 * surfaces read as glass or as stone, how much air the layout breathes.
 *
 * Every rule here is deterministic, so the same photograph always produces the
 * same site.
 */

import { ImageAnalysis } from './analyze';
import {
  contrastHex,
  ensureContrast,
  hexToHsl,
  hslToHex,
  isLight,
  mixHex,
  rotateHue,
  setLightness,
  withAlpha,
} from './color';
import { buildGrain, buildPattern } from './patterns';
import { Swatch } from './quantize';
import {
  DesignTokens,
  FONT_STACKS,
  Finish,
  Geometry,
  MeshStop,
  MotionCharacter,
  MotionTier,
  MotionTokens,
  MotionTrigger,
  LayoutArchetype,
  LayoutTokens,
  Palette,
  PatternKind,
  TypeVoice,
} from './tokens';

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
const round = (v: number, places = 3) => Number(v.toFixed(places));

/** Stable 32-bit hash, so mesh placement is reproducible per palette. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * Rank a swatch by how well it would carry an interface: chroma matters most,
 * mid lightness is preferred (a near-black or near-white "brand color" cannot
 * anchor anything), and coverage in the photo breaks ties.
 */
function vividness(s: Swatch): number {
  const midness = 1 - Math.abs(s.lightness - 0.55) * 1.5;
  return s.saturation * Math.max(0.05, midness) * (0.4 + s.population);
}

/**
 * Guarantee that a color can carry a label.
 *
 * Mid-luminance colors are the trap: a hue sitting around 18% relative
 * luminance fails 4.5:1 against *both* black and white, so no choice of label
 * color rescues it. When that happens the honest fix is to move the brand color
 * itself — away from the middle, in whichever direction is already closer —
 * rather than ship a button nobody can read.
 */
function makeLabelable(color: string, target = 4.5): { color: string; onColor: string } {
  const poles = (c: string) => {
    const onWhite = contrastHex('#ffffff', c);
    const onBlack = contrastHex('#0b0b0f', c);
    return onWhite >= onBlack
      ? { onColor: '#ffffff', ratio: onWhite }
      : { onColor: '#0b0b0f', ratio: onBlack };
  };

  const initial = poles(color);
  if (initial.ratio >= target) return { color, onColor: initial.onColor };

  const hsl = hexToHsl(color);
  // White already wins ⇒ the color is on the dark side of the middle; pushing it
  // darker widens that gap. Otherwise push it lighter for black text.
  const direction = initial.onColor === '#ffffff' ? -1 : 1;

  let bestColor = color;
  let bestPole = initial;

  for (let step = 1; step <= 100; step++) {
    const candidate = hslToHex({ ...hsl, l: Math.min(1, Math.max(0, hsl.l + direction * step * 0.01)) });
    const p = poles(candidate);
    if (p.ratio > bestPole.ratio) {
      bestPole = p;
      bestColor = candidate;
    }
    if (p.ratio >= target) return { color: candidate, onColor: p.onColor };
  }

  return { color: bestColor, onColor: bestPole.onColor };
}

/**
 * Turn three chosen source swatches into a full, readable palette.
 *
 * Split out from `buildPalette` so the AI layer can supply its own role
 * assignment and still go through the identical treatment — chroma lifting,
 * accent tempering, neutral tinting and every contrast repair. The model gets to
 * decide *which* measured colour leads; it does not get to skip the guards.
 */
export function composePalette(
  primarySrc: Swatch,
  accentSrc: Swatch | undefined,
  secondarySrc: Swatch | undefined,
  sourceIsDark: boolean,
  colorfulness: number,
  brightness: number,
): Palette {
  // A washed-out subject still needs a usable brand color, so lift very low
  // chroma into a workable range rather than shipping mud — then make sure a
  // label can actually sit on top of it.
  const { color: primary, onColor: onPrimary } = makeLabelable(
    (() => {
      const hsl = hexToHsl(primarySrc.hex);
      const s = Math.max(hsl.s, 0.28);
      const l = Math.min(0.62, Math.max(0.38, hsl.l));
      return hslToHex({ h: hsl.h, s, l });
    })(),
  );
  const primaryHue = hexToHsl(primary).h;
  const primarySat = hexToHsl(primary).s;

  // Accent saturation is *tempered*, never maximized. A complement taken at full
  // chroma reads as an alarm rather than an accent — rotating a saturated orange
  // by 150° and pinning it at s=1 gives electric cyan, which belongs to no
  // photograph. Keeping accent chroma at or below the primary's holds the pair
  // in the same material world.
  const accentLightness = sourceIsDark ? 0.62 : 0.46;
  const accentRaw = accentSrc
    ? hslToHex({
        h: accentSrc.hue,
        s: Math.min(0.65, Math.max(0.3, accentSrc.saturation)),
        l: accentLightness,
      })
    : // Nothing complementary in frame — derive one so the UI still has a second
      // voice for CTAs and highlights.
      hslToHex({
        h: (primaryHue + (colorfulness > 0.4 ? 150 : 32)) % 360,
        s: Math.min(0.6, Math.max(0.3, primarySat * 0.8)),
        l: accentLightness,
      });

  const secondary = secondarySrc
    ? setLightness(secondarySrc.hex, lerp(0.45, 0.6, secondarySrc.saturation))
    : mixHex(primary, accentRaw, 0.5);

  // Keep a whisper of the subject's hue in the neutrals — a warm wooden object
  // yields warm greys, a cold steel one yields cool greys.
  const neutralHue = hexToHsl(primary).h;
  const tint = lerp(0.02, 0.09, colorfulness);

  const surface = sourceIsDark
    ? hslToHex({ h: neutralHue, s: tint + 0.03, l: lerp(0.06, 0.11, brightness) })
    : hslToHex({ h: neutralHue, s: tint, l: lerp(0.99, 0.94, colorfulness) });

  const surfaceAlt = sourceIsDark
    ? mixHex(surface, primary, 0.14)
    : mixHex(surface, primary, 0.07);

  const inkBase = sourceIsDark
    ? hslToHex({ h: neutralHue, s: 0.08, l: 0.96 })
    : hslToHex({ h: neutralHue, s: 0.22, l: 0.12 });

  const ink = ensureContrast(inkBase, surface, 7);
  const inkMuted = ensureContrast(mixHex(ink, surface, 0.42), surface, 4.5);
  const border = mixHex(surface, ink, sourceIsDark ? 0.16 : 0.13);

  // The accent carries badges, meters and small marks, so it has to clear the
  // 3:1 floor WCAG sets for non-text UI components against its own background.
  const accent = ensureContrast(accentRaw, surface, 3);

  return { primary, secondary, accent, surface, surfaceAlt, ink, inkMuted, border, onPrimary };
}

/** The neutral swatch used when a photograph yields nothing usable. */
export const FALLBACK_SWATCH: Swatch = {
  rgb: { r: 90, g: 105, b: 130 },
  hex: '#5a6982',
  population: 1,
  saturation: 0.2,
  lightness: 0.43,
  hue: 218,
};

/**
 * Rank the measured swatches and assign roles by chroma, coverage and hue
 * separation. This is the heuristic half — the part the AI layer replaces when
 * it has a better idea about which colour is actually the subject.
 */
export function rankSwatches(analysis: ImageAnalysis) {
  const ranked = [...(analysis.swatches.length ? analysis.swatches : [FALLBACK_SWATCH])].sort(
    (a, b) => vividness(b) - vividness(a),
  );

  const primarySrc = ranked[0];
  const primaryHue = primarySrc.hue;

  // Accent: the most chromatic swatch that is genuinely a different hue, but
  // weighted by coverage too — a hue that occupies three pixels of JPEG fringing
  // is noise, not a second voice.
  const accentSrc = ranked
    .slice(1)
    .filter((s) => s.saturation > 0.12 && s.population > 0.03 && hueDistance(s.hue, primaryHue) > 25)
    .sort(
      (a, b) =>
        hueDistance(b.hue, primaryHue) * b.saturation * (0.5 + b.population) -
        hueDistance(a.hue, primaryHue) * a.saturation * (0.5 + a.population),
    )[0];

  const secondarySrc = ranked
    .slice(1)
    .filter((s) => s.hex !== accentSrc?.hex && hueDistance(s.hue, primaryHue) > 12)[0];

  return { ranked, primarySrc, accentSrc, secondarySrc };
}

function buildPalette(analysis: ImageAnalysis): Palette {
  const { primarySrc, accentSrc, secondarySrc } = rankSwatches(analysis);
  // Scheme follows the photograph: a night shot should not produce a white site.
  const sourceIsDark = analysis.texture.brightness < 0.46;

  return composePalette(
    primarySrc,
    accentSrc,
    secondarySrc,
    sourceIsDark,
    analysis.colorfulness,
    analysis.texture.brightness,
  );
}

// ---------------------------------------------------------------------------
// Geometry → border radii
// ---------------------------------------------------------------------------

/**
 * Angularity: how much the subject is built from straight, axis-aligned lines.
 * A wrench scores high, an orange scores near zero.
 */
export function angularity(analysis: ImageAnalysis): number {
  const { orthogonality, orientationEntropy, density } = analysis.edges;
  // Orientation entropy is the stronger signal — curves touch every angle bin —
  // but a frame with almost no edges shouldn't read as "organic" by default, so
  // low density pulls the score toward the middle.
  const structural = orthogonality * 0.45 + (1 - orientationEntropy) * 0.55;
  const confidence = Math.min(1, density / 0.08);
  return lerp(0.45, structural, confidence);
}

function classifyGeometry(score: number): Geometry {
  if (score > 0.68) return 'sharp';
  if (score > 0.55) return 'faceted';
  if (score > 0.42) return 'balanced';
  if (score > 0.28) return 'organic';
  return 'round';
}

const RADIUS_UNIT: Record<Geometry, number> = {
  sharp: 0,
  faceted: 4,
  balanced: 10,
  organic: 20,
  round: 30,
};

// ---------------------------------------------------------------------------
// Surface finish
// ---------------------------------------------------------------------------

export function classifyFinish(analysis: ImageAnalysis, paletteSaturation: number): Finish {
  const { specularity, roughness, granularity, dynamicRange } = analysis.texture;

  // Roughness carries a heavy negative weight on purpose. Bright speckle alone
  // is not gloss — coarse aggregate throws just as many blown-out pixels as
  // polished glass does. What separates them is that a glossy surface is
  // *smooth* between its highlights, so high roughness has to veto the call.
  const glossScore = specularity * 0.55 + dynamicRange * 0.3 - roughness * 0.75;
  if (glossScore > 0.3) {
    // Chrome and steel glint just as hard as glass but carry no color.
    return paletteSaturation < 0.22 ? 'metallic' : 'glossy';
  }
  if (roughness > 0.52 && granularity > 0.3) return 'rough';
  if (roughness < 0.22 && dynamicRange < 0.6) return 'soft';
  return 'matte';
}

interface SurfaceTokens {
  finish: Finish;
  blur: number;
  grain: number;
  borderAlpha: number;
  fillAlpha: number;
  shadow: string;
  sheen: number;
  grainImage: string;
}

export function buildSurface(
  analysis: ImageAnalysis,
  palette: Palette,
  finish: Finish,
  sourceIsDark: boolean,
): SurfaceTokens {
  const { specularity, roughness } = analysis.texture;

  // Glass wants a deep backdrop blur behind translucent panels; stone wants
  // almost none, because a rough material does not transmit light.
  const blurByFinish: Record<Finish, number> = {
    glossy: 20,
    metallic: 16,
    soft: 12,
    matte: 7,
    rough: 3,
  };

  const grainByFinish: Record<Finish, number> = {
    glossy: 0.02,
    metallic: 0.03,
    soft: 0.035,
    matte: 0.05,
    rough: 0.085,
  };

  const shiny = finish === 'glossy' || finish === 'metallic';

  // Shadow color is drawn from the palette rather than pure black, so elevation
  // reads as part of the same material world.
  const shadowHue = sourceIsDark ? '#000000' : mixHex(palette.primary, '#000000', 0.55);
  const depth = shiny ? 1 : 0.7;

  const layers = [
    `0 1px 2px ${withAlpha(shadowHue, 0.08 * depth)}`,
    `0 ${round(4 * depth, 1)}px ${round(12 * depth, 1)}px ${withAlpha(shadowHue, 0.1 * depth)}`,
    `0 ${round(16 * depth, 1)}px ${round(40 * depth, 1)}px ${withAlpha(shadowHue, 0.14 * depth)}`,
  ];
  if (shiny) {
    // The inset hairline is what sells a specular edge: a bright line where the
    // panel catches light, a dark one where it falls away.
    layers.push(`inset 0 1px 0 ${withAlpha('#ffffff', 0.18 + specularity * 0.22)}`);
    layers.push(`inset 0 -1px 0 ${withAlpha('#000000', 0.16)}`);
  }

  return {
    finish,
    blur: blurByFinish[finish],
    grain: round(grainByFinish[finish] * lerp(0.7, 1.35, roughness), 4),
    borderAlpha: round(shiny ? 0.1 + specularity * 0.14 : 0.06, 3),
    fillAlpha: round(shiny ? 0.55 : finish === 'rough' ? 0.95 : 0.8, 2),
    shadow: layers.join(', '),
    sheen: round(shiny ? Math.max(0.35, specularity) : specularity * 0.4, 3),
    // Coarse materials get chunky, low-frequency noise; polished ones get a
    // fine tooth that only shows up as a lack of banding.
    grainImage: buildGrain(lerp(0.35, 1.1, 1 - roughness), roughness > 0.5 ? 4 : 3),
  };
}

// ---------------------------------------------------------------------------
// Typography & density
// ---------------------------------------------------------------------------

function classifyVoice(geometry: Geometry, analysis: ImageAnalysis): TypeVoice {
  const stark = analysis.texture.dynamicRange > 0.7 && analysis.colorfulness < 0.35;

  switch (geometry) {
    case 'sharp':
      return 'technical';
    case 'faceted':
      return stark ? 'technical' : 'neutral';
    case 'balanced':
      return stark ? 'technical' : 'neutral';
    case 'organic':
      return 'editorial';
    case 'round':
    default:
      return 'friendly';
  }
}

interface TypographyTokens {
  voice: TypeVoice;
  headingFont: string;
  bodyFont: string;
  headingWeight: number;
  tracking: number;
  leading: number;
  scale: number;
}

export function buildTypography(voice: TypeVoice, analysis: ImageAnalysis): TypographyTokens {
  const contrastPush = analysis.texture.dynamicRange;

  const base: Record<TypeVoice, Omit<TypographyTokens, 'voice'>> = {
    technical: {
      headingFont: FONT_STACKS.technical,
      bodyFont: FONT_STACKS.neutral,
      headingWeight: 700,
      tracking: -0.035,
      leading: 1.5,
      scale: 1.04,
    },
    neutral: {
      headingFont: FONT_STACKS.neutral,
      bodyFont: FONT_STACKS.neutral,
      headingWeight: 650,
      tracking: -0.025,
      leading: 1.6,
      scale: 1,
    },
    editorial: {
      headingFont: FONT_STACKS.editorial,
      bodyFont: FONT_STACKS.neutral,
      headingWeight: 500,
      tracking: -0.012,
      leading: 1.7,
      scale: 1.06,
    },
    friendly: {
      headingFont: FONT_STACKS.friendly,
      bodyFont: FONT_STACKS.friendly,
      headingWeight: 800,
      tracking: -0.005,
      leading: 1.72,
      scale: 0.98,
    },
  };

  const t = base[voice];
  return {
    voice,
    ...t,
    // A high-contrast subject earns heavier, tighter display type.
    headingWeight: Math.round(lerp(t.headingWeight - 50, t.headingWeight + 50, contrastPush)),
    tracking: round(t.tracking - contrastPush * 0.008, 4),
    scale: round(t.scale * lerp(0.97, 1.06, contrastPush), 3),
  };
}

function buildSpace(geometry: Geometry, analysis: ImageAnalysis) {
  // Stark, angular subjects compress; organic ones breathe.
  const byGeometry: Record<Geometry, number> = {
    sharp: 0.86,
    faceted: 0.93,
    balanced: 1,
    organic: 1.12,
    round: 1.2,
  };
  // A visually busy photo gets a slightly calmer layout to stay readable.
  const busy = Math.min(1, analysis.edges.density / 0.14);
  return {
    unit: round(byGeometry[geometry] * lerp(0.98, 1.08, busy), 3),
    rhythm: round(lerp(0.9, 1.25, byGeometry[geometry] - 0.86), 3),
  };
}

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

export function classifyPattern(analysis: ImageAnalysis, geometry: Geometry): PatternKind {
  const { strength, angle } = analysis.periodicity;
  const { orthogonality, orientationEntropy } = analysis.edges;

  if (strength < 0.14) return 'none';

  // Rough, high-frequency surfaces read as aggregate, not as a drawn motif.
  if (analysis.texture.roughness > 0.62 && strength < 0.35) return 'scatter';

  const diagonal = angle === 45 || angle === 135;
  if (diagonal) return orientationEntropy < 0.82 ? 'chevron' : 'weave';

  if (orthogonality > 0.5) {
    // Energy split across both axes means a lattice; concentrated on one means bands.
    const h = analysis.edges.histogram;
    const horizontal = h[0] + h[h.length - 1];
    const vertical = h[5] + h[6];
    const balance = Math.min(horizontal, vertical) / Math.max(horizontal, vertical || 1e-6);
    return balance > 0.55 ? 'grid' : 'stripes';
  }

  if (geometry === 'round' || geometry === 'organic') return 'dots';
  return 'weave';
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

const LAYOUT_BY_GEOMETRY: Record<Geometry, LayoutArchetype> = {
  sharp: 'brutalist',
  faceted: 'technical',
  balanced: 'technical',
  organic: 'editorial',
  round: 'soft',
};

/**
 * The heuristic composition. Geometry is the strongest available proxy for how
 * a subject is *built*, and how a subject is built is what a layout echoes — a
 * machined object wants a tight grid, a weathered organic one wants a column
 * with air around it.
 */
export function buildLayout(geometry: Geometry, analysis: ImageAnalysis): LayoutTokens {
  const archetype = LAYOUT_BY_GEOMETRY[geometry];
  const busy = Math.min(1, analysis.edges.density / 0.14);

  return {
    archetype,
    heroAlign: archetype === 'editorial' || archetype === 'soft' ? 'center' : 'left',
    // A visually busy photograph gets a narrower column, so the page stays
    // readable against a more active background.
    measure: Math.round(lerp(72, 58, busy)),
    featureColumns: archetype === 'editorial' ? 2 : 3,
    imageRatio: archetype === 'gallery' ? '1 / 1' : '4 / 3',
  };
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * Motion is a material property, decided from the same measurements as finish.
 *
 * Scored rather than cascaded, so the thresholds are visible and tunable and no
 * single signal silently dominates. When nothing scores above the floor the
 * answer is `still` — a page that fidgets for no reason is worse than one that
 * holds still, so "nothing" has to be a reachable outcome rather than whatever
 * the last `else` branch happened to be.
 */
export function classifyMotion(analysis: ImageAnalysis): MotionCharacter {
  const { specularity, roughness, granularity, dynamicRange, brightness } = analysis.texture;
  const { orientationEntropy, orthogonality, density } = analysis.edges;

  // Nothing was observed, so nothing is implied. Orientation entropy is at its
  // maximum for a blank frame — every angle bin is equally empty — which reads
  // as "organic" to any score that trusts entropy alone. An empty frame is not
  // organic; it is empty, and it gets stillness.
  if (density < 0.012 || dynamicRange < 0.06) return 'still';

  const scores: Record<Exclude<MotionCharacter, 'still'>, number> = {
    // Light travelling over a smooth, curved surface. Roughness vetoes it for
    // the same reason it vetoes gloss: a coarse surface scatters instead.
    shimmer: specularity * 0.6 + orientationEntropy * 0.3 - roughness * 0.7,
    // Coarse and high-contrast. Granularity separates real grain from a merely
    // busy frame, which would otherwise score here on dynamic range alone.
    glitch: roughness * 0.5 + granularity * 0.35 + dynamicRange * 0.25 - specularity * 0.3,
    // Soft, organic, uncrowded. High edge density means structure, not drift.
    drift: orientationEntropy * 0.5 - Math.min(1, density / 0.12) * 0.35 - roughness * 0.25,
    // Machined: energy concentrated on the axes.
    settle: orthogonality * 0.6 + (1 - orientationEntropy) * 0.4 - 0.15,
    // Bright and specular — light coming off or through the subject.
    bloom: specularity * 0.5 + brightness * 0.4 - roughness * 0.4,
    // Something genuinely repeats.
    weave: analysis.periodicity.strength * 0.9 - 0.1,
  };

  let best: MotionCharacter = 'still';
  let bestScore = 0.34; // floor: below this, nothing has earned the right to move
  for (const [character, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = character as MotionCharacter;
    }
  }
  return best;
}

/** Per-character defaults. Period is in ms; amplitude is scaled below. */
const MOTION_BASE: Record<MotionCharacter, { period: number; amplitude: number; trigger: MotionTrigger; tier: MotionTier }> = {
  still: { period: 0, amplitude: 0, trigger: 'none', tier: 'ambient' },
  shimmer: { period: 1400, amplitude: 0.5, trigger: 'view', tier: 'accent' },
  glitch: { period: 620, amplitude: 0.55, trigger: 'view', tier: 'accent' },
  drift: { period: 26000, amplitude: 0.12, trigger: 'scroll', tier: 'ambient' },
  settle: { period: 520, amplitude: 0.45, trigger: 'view', tier: 'accent' },
  bloom: { period: 1100, amplitude: 0.4, trigger: 'view', tier: 'accent' },
  weave: { period: 22000, amplitude: 0.14, trigger: 'scroll', tier: 'ambient' },
};

export const MOTION_EASE: Record<MotionCharacter, string> = {
  still: 'linear',
  shimmer: 'cubic-bezier(0.4, 0, 0.2, 1)',
  // Stepped, so the displacement reads as digital rather than as a slide.
  glitch: 'steps(6, end)',
  drift: 'cubic-bezier(0.37, 0, 0.63, 1)',
  // No overshoot. A machined subject does not bounce.
  settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
  bloom: 'cubic-bezier(0.22, 1, 0.36, 1)',
  weave: 'linear',
};

function buildMotion(analysis: ImageAnalysis, character: MotionCharacter): MotionTokens {
  const base = MOTION_BASE[character];
  // A flat, quiet photograph cannot produce a busy page. Dynamic range is the
  // frame's own energy, and motion is not allowed to exceed it.
  const energy = lerp(0.55, 1, analysis.texture.dynamicRange);
  return {
    character,
    tier: base.tier,
    amplitude: round(base.amplitude * energy, 3),
    period: Math.round(base.period),
    easing: MOTION_EASE[character],
    trigger: base.trigger,
  };
}

// ---------------------------------------------------------------------------
// Gradient mesh
// ---------------------------------------------------------------------------

function buildMesh(palette: Palette, analysis: ImageAnalysis, sourceIsDark: boolean): MeshStop[] {
  const colors = [palette.primary, palette.accent, palette.secondary];
  const spread = lerp(45, 95, 1 - analysis.edges.density / 0.2);
  const intensity = lerp(0.1, 0.32, analysis.colorfulness) * (sourceIsDark ? 1.35 : 1);

  return colors.map((color, i) => {
    const h1 = hash(color + i);
    const h2 = hash(`${i}:${color}`);
    return {
      color: withAlpha(color, round(intensity * lerp(1, 0.6, i / colors.length), 3)),
      x: Math.round(lerp(8, 92, h1)),
      y: Math.round(lerp(0, 70, h2)),
      size: Math.round(spread * lerp(0.8, 1.3, h2)),
      opacity: 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function describe(geometry: Geometry, finish: Finish, voice: TypeVoice, pattern: PatternKind): string {
  const geometryWord: Record<Geometry, string> = {
    sharp: 'hard-edged',
    faceted: 'angular',
    balanced: 'evenly proportioned',
    organic: 'organic',
    round: 'soft and round',
  };
  const finishWord: Record<Finish, string> = {
    glossy: 'glossy, light-catching',
    metallic: 'brushed metallic',
    matte: 'matte',
    rough: 'coarse, tactile',
    soft: 'smooth and diffuse',
  };
  const voiceWord: Record<TypeVoice, string> = {
    technical: 'tight technical type',
    neutral: 'clean neutral type',
    editorial: 'editorial serif type',
    friendly: 'rounded, friendly type',
  };
  const patternPhrase = pattern === 'none' ? 'no repeating motif' : `a ${pattern} motif`;
  // "A organic subject" is the kind of seam that makes generated copy read as
  // generated. Every adjective in the tables above is vowel-unambiguous.
  const article = /^[aeiou]/i.test(geometryWord[geometry]) ? 'An' : 'A';
  return `${article} ${geometryWord[geometry]}, ${finishWord[finish]} subject — rendered with ${voiceWord[voice]} and ${patternPhrase}.`;
}

export function synthesize(analysis: ImageAnalysis): DesignTokens {
  const palette = buildPalette(analysis);
  const sourceIsDark = analysis.texture.brightness < 0.46;

  const geometryScore = angularity(analysis);
  const geometry = classifyGeometry(geometryScore);

  const paletteSaturation =
    (hexToHsl(palette.primary).s + hexToHsl(palette.accent).s) / 2;
  const finish = classifyFinish(analysis, paletteSaturation);

  const voice = classifyVoice(geometry, analysis);
  const unit = RADIUS_UNIT[geometry];

  const patternKind = classifyPattern(analysis, geometry);
  // The analysis buffer is 256px on its long edge; scale the detected pitch
  // into something legible as a CSS-space tile.
  const period = Math.round(
    Math.min(96, Math.max(8, analysis.periodicity.period * (analysis.width / 256) * 2.2)),
  );

  const surface = buildSurface(analysis, palette, finish, sourceIsDark);

  const pattern = {
    kind: patternKind,
    period,
    angle: Math.round(analysis.edges.dominantAngle),
    opacity: round(Math.min(0.12, analysis.periodicity.strength * 0.2), 3),
    image: buildPattern({
      kind: patternKind,
      period,
      angle: analysis.periodicity.angle,
      color: palette.accent,
      weight: lerp(0.05, 0.14, analysis.edges.strength),
    }),
  };

  // How much of this theme was actually driven by the photo, versus by our
  // fallbacks. Shown in the inspector so the result is never a black box.
  const confidence = round(
    Math.min(
      1,
      0.35 +
        Math.min(0.25, analysis.edges.density * 2) +
        analysis.colorfulness * 0.25 +
        Math.min(0.15, analysis.texture.dynamicRange * 0.2),
    ),
    2,
  );

  return {
    palette,
    radius: {
      unit,
      sm: `${round(unit * 0.4, 1)}px`,
      md: `${round(unit * 0.8, 1)}px`,
      lg: `${round(unit * 1.4, 1)}px`,
      xl: `${round(unit * 2.2, 1)}px`,
    },
    typography: buildTypography(voice, analysis),
    space: buildSpace(geometry, analysis),
    surface,
    pattern,
    mesh: buildMesh(palette, analysis, sourceIsDark),
    motion: buildMotion(analysis, classifyMotion(analysis)),
    layout: buildLayout(geometry, analysis),
    meta: {
      geometry,
      description: describe(geometry, finish, voice, patternKind),
      confidence,
      sourceIsDark,
    },
  };
}

/** Neutral theme shown before the first capture. */
export function defaultTokens(): DesignTokens {
  const palette: Palette = {
    primary: '#5b6cff',
    secondary: '#8a6cff',
    accent: '#38d1c4',
    surface: '#0b0c10',
    surfaceAlt: '#14161f',
    ink: '#f4f5fa',
    inkMuted: '#a9adc0',
    border: '#262a38',
    onPrimary: '#ffffff',
  };

  return {
    palette,
    radius: { unit: 14, sm: '5.6px', md: '11.2px', lg: '19.6px', xl: '30.8px' },
    typography: {
      voice: 'neutral',
      headingFont: FONT_STACKS.neutral,
      bodyFont: FONT_STACKS.neutral,
      headingWeight: 650,
      tracking: -0.025,
      leading: 1.6,
      scale: 1,
    },
    space: { unit: 1, rhythm: 1 },
    surface: {
      finish: 'glossy',
      blur: 18,
      grain: 0.03,
      borderAlpha: 0.12,
      fillAlpha: 0.55,
      shadow: [
        `0 1px 2px ${withAlpha('#000000', 0.08)}`,
        `0 4px 12px ${withAlpha('#000000', 0.1)}`,
        `0 16px 40px ${withAlpha('#000000', 0.14)}`,
        `inset 0 1px 0 ${withAlpha('#ffffff', 0.16)}`,
      ].join(', '),
      sheen: 0.45,
      grainImage: buildGrain(0.8, 3),
    },
    pattern: {
      kind: 'none',
      period: 24,
      angle: 0,
      opacity: 0,
      image: 'none',
    },
    mesh: [
      { color: withAlpha('#5b6cff', 0.24), x: 18, y: 12, size: 70, opacity: 1 },
      { color: withAlpha('#38d1c4', 0.16), x: 82, y: 30, size: 62, opacity: 1 },
      { color: withAlpha('#8a6cff', 0.14), x: 50, y: 68, size: 78, opacity: 1 },
    ],
    motion: {
      character: 'drift',
      tier: 'ambient',
      amplitude: 0.12,
      period: 26000,
      easing: MOTION_EASE.drift,
      trigger: 'scroll',
    },
    layout: {
      archetype: 'technical',
      heroAlign: 'left',
      measure: 68,
      featureColumns: 3,
      imageRatio: '4 / 3',
    },
    meta: {
      geometry: 'balanced',
      description: 'Waiting for a capture — this is the engine’s neutral resting state.',
      confidence: 0,
      sourceIsDark: true,
    },
  };
}

/** Convenience for the inspector: report the palette's readability. */
export function paletteContrast(palette: Palette) {
  return {
    inkOnSurface: round(contrastHex(palette.ink, palette.surface), 2),
    mutedOnSurface: round(contrastHex(palette.inkMuted, palette.surface), 2),
    onPrimary: round(contrastHex(palette.onPrimary, palette.primary), 2),
  };
}
