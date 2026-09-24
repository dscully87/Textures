/**
 * Synthesis: analysis numbers in, design tokens out.
 *
 * This is the opinionated half of the engine. `analyze.ts` measures the
 * photograph, `mood.ts` condenses those measurements into five perceptual axes,
 * and this module decides what the mood *means* for a website — which layout,
 * which typefaces, how the palette is built, how much of the photograph shows
 * through as texture, how the page moves.
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
  mixHex,
  setLightness,
  withAlpha,
} from './color';
import { ARCHETYPE_COPY, RESTING_COPY } from './copy';
import { DEFAULT_PAIRING, FONT_FAMILIES, FONT_PAIRINGS, FontPairing, fontStack } from './fonts';
import { ARCHETYPES, ARCHETYPE_BY_ID } from './layouts';
import { Mood, NEUTRAL_MOOD, computeMood, nearest } from './mood';
import { buildGrain, buildPattern } from './patterns';
import { Swatch } from './quantize';
import {
  ColourStrategy,
  DesignTokens,
  Finish,
  Geometry,
  LayoutArchetype,
  LayoutTokens,
  MeshStop,
  MotionCharacter,
  MotionTier,
  MotionTokens,
  MotionTrigger,
  Palette,
  PatternKind,
  PopColour,
  SectionPlan,
  TypographyTokens,
} from './tokens';
import type { SiteCopy } from './copy';

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
const round = (v: number, places = 3) => Number(v.toFixed(places));
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const hsl = (h: number, s: number, l: number) =>
  hslToHex({ h: ((h % 360) + 360) % 360, s: clamp(s, 0, 1), l: clamp(l, 0, 1) });

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
 * Rank a swatch by how well it would carry an interface: colourfulness matters
 * most, mid lightness is preferred (a near-black or near-white "brand color"
 * cannot anchor anything), and coverage in the photo breaks ties.
 *
 * Ranked on chroma rather than HSL saturation: HSL reports an off-white as
 * 80–100% saturated, which let a white background outrank the subject.
 */
function vividness(s: Swatch): number {
  const midness = 1 - Math.abs(s.lightness - 0.55) * 1.5;
  return s.chroma * Math.max(0.05, midness) * (0.4 + s.population);
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

  const base = hexToHsl(color);
  // White already wins ⇒ the color is on the dark side of the middle; pushing it
  // darker widens that gap. Otherwise push it lighter for black text.
  const direction = initial.onColor === '#ffffff' ? -1 : 1;

  let bestColor = color;
  let bestPole = initial;

  for (let step = 1; step <= 100; step++) {
    const candidate = hslToHex({ ...base, l: clamp(base.l + direction * step * 0.01, 0, 1) });
    const p = poles(candidate);
    if (p.ratio > bestPole.ratio) {
      bestPole = p;
      bestColor = candidate;
    }
    if (p.ratio >= target) return { color: candidate, onColor: p.onColor };
  }

  return { color: bestColor, onColor: bestPole.onColor };
}

const DEFAULT_WEIGHTS: Record<ColourStrategy, Palette['weights']> = {
  tonal: { ground: 0.7, support: 0.25, accent: 0.05 },
  accent: { ground: 0.6, support: 0.3, accent: 0.1 },
  pop: { ground: 0.4, support: 0.35, accent: 0.25 },
  moody: { ground: 0.8, support: 0.15, accent: 0.05 },
};

interface PaletteParts {
  strategy: ColourStrategy;
  primary: string;
  accent: string;
  secondary: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  pops?: string[];
  weights?: Palette['weights'];
  dark: boolean;
}

/**
 * Every strategy ends here, so every strategy gets the same guarantees: body
 * text at 7:1 on the surface (and 4.5:1 on the alternate surface), muted text at
 * 4.5:1 on both, the accent at the 3:1 floor WCAG sets for non-text UI and large
 * display type (it colours the headline's emphasised phrase), and a label
 * colour that clears 4.5:1 on the primary and on every pop colour.
 */
function finishPalette(parts: PaletteParts): Palette {
  const { color: primary, onColor: onPrimary } = makeLabelable(parts.primary);
  // Tinted sections sit on `surfaceAlt`, so both text roles are checked there too.
  const ink = ensureContrast(ensureContrast(parts.ink, parts.surface, 7), parts.surfaceAlt, 4.5);
  const inkMuted = ensureContrast(
    ensureContrast(mixHex(ink, parts.surface, 0.42), parts.surface, 4.5),
    parts.surfaceAlt,
    4.5,
  );
  const border = mixHex(parts.surface, ink, parts.dark ? 0.16 : 0.13);
  const accent = ensureContrast(parts.accent, parts.surface, 3);
  const pops: PopColour[] = (parts.pops ?? []).map((c) => {
    const { color, onColor } = makeLabelable(c);
    return { color, on: onColor };
  });

  return {
    strategy: parts.strategy,
    primary,
    secondary: parts.secondary,
    accent,
    surface: parts.surface,
    surfaceAlt: parts.surfaceAlt,
    ink,
    inkMuted,
    border,
    onPrimary,
    pops,
    weights: parts.weights ?? DEFAULT_WEIGHTS[parts.strategy],
  };
}

/**
 * The `accent` strategy: a neutral page with one brand colour and a second voice.
 *
 * Exported so the AI layer can supply its own role assignment and still go
 * through the identical treatment — chroma lifting, accent tempering, neutral
 * tinting and every contrast repair.
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
  // chroma into a workable range rather than shipping mud.
  const base = hexToHsl(primarySrc.hex);
  const primary = hsl(base.h, Math.max(base.s, 0.28), clamp(base.l, 0.38, 0.62));
  const primaryHue = hexToHsl(primary).h;
  const primarySat = hexToHsl(primary).s;

  // Accent saturation is *tempered*, never maximized. A complement taken at full
  // chroma reads as an alarm rather than an accent.
  const accentLightness = sourceIsDark ? 0.62 : 0.46;
  const accent = accentSrc
    ? hsl(accentSrc.hue, clamp(accentSrc.saturation, 0.3, 0.65), accentLightness)
    : // Nothing complementary in frame — derive one so the UI still has a second
      // voice for CTAs and highlights.
      hsl(primaryHue + (colorfulness > 0.4 ? 150 : 32), clamp(primarySat * 0.8, 0.3, 0.6), accentLightness);

  const secondary = secondarySrc
    ? setLightness(secondarySrc.hex, lerp(0.45, 0.6, secondarySrc.saturation))
    : mixHex(primary, accent, 0.5);

  // Keep a whisper of the subject's hue in the neutrals — a warm wooden object
  // yields warm greys, a cold steel one yields cool greys.
  const tint = lerp(0.02, 0.09, colorfulness);
  const surface = sourceIsDark
    ? hsl(primaryHue, tint + 0.03, lerp(0.06, 0.11, brightness))
    : hsl(primaryHue, tint, lerp(0.99, 0.94, colorfulness));

  return finishPalette({
    strategy: 'accent',
    primary,
    accent,
    secondary,
    surface,
    surfaceAlt: mixHex(surface, primary, sourceIsDark ? 0.14 : 0.07),
    ink: sourceIsDark ? hsl(primaryHue, 0.08, 0.96) : hsl(primaryHue, 0.22, 0.12),
    dark: sourceIsDark,
  });
}

/**
 * The `tonal` strategy: one colour family, carried by the surface itself.
 *
 * This is what a lake needs and what the neutral-page strategy could never
 * give it — the whole page takes the water's hue, deep or pale, with the brand
 * colour and accent as darker and lighter notes of the same family.
 */
function composeTonal(base: Swatch, second: Swatch | undefined, dark: boolean, mood: Mood): Palette {
  const h = base.hue;
  const s = clamp(base.chroma * 1.6 + 0.15, 0.25, 0.6);
  const accentHue =
    second && second.chroma > 0.08 && hueDistance(second.hue, h) < 90
      ? second.hue
      : h + (mood.warmth > 0.5 ? -28 : 28);

  return finishPalette({
    strategy: 'tonal',
    primary: hsl(h, Math.max(0.42, s), dark ? 0.62 : 0.36),
    accent: hsl(accentHue, 0.48, dark ? 0.68 : 0.42),
    secondary: hsl(h, s * 0.7, dark ? 0.42 : 0.72),
    surface: dark ? hsl(h, Math.min(0.35, s * 0.6), 0.11) : hsl(h, Math.min(0.42, s * 0.6), 0.95),
    surfaceAlt: dark ? hsl(h, Math.min(0.35, s * 0.6), 0.16) : hsl(h, Math.min(0.45, s * 0.7), 0.89),
    ink: dark ? hsl(h, 0.25, 0.93) : hsl(h, 0.45, 0.13),
    dark,
  });
}

/**
 * The `pop` strategy: several saturated colours as blocks and stickers, on a
 * stark ground — the graffiti-wall and sweet-shop register. Colours come from
 * the photograph first; if it only has one or two, triadic companions are
 * derived so the page still has enough voices to be loud.
 */
function composePop(ranked: Swatch[], lead: Swatch, dark: boolean): Palette {
  const hues: number[] = [lead.hue];
  for (const s of [...ranked].sort((a, b) => b.chroma * Math.sqrt(b.population) - a.chroma * Math.sqrt(a.population))) {
    if (hues.length >= 4) break;
    if (s.chroma < 0.18) continue;
    if (hues.every((h) => hueDistance(h, s.hue) >= 40)) hues.push(s.hue);
  }
  for (const offset of [120, 210, 60, 300]) {
    if (hues.length >= 4) break;
    const candidate = (lead.hue + offset) % 360;
    if (hues.every((h) => hueDistance(h, candidate) >= 40)) hues.push(candidate);
  }

  // Saturated but not neon: s 0.7 keeps the set in one printed-ink world.
  const pops = hues.map((h, i) => hsl(h, 0.7, i % 2 === 0 ? 0.52 : 0.58));
  const groundHue = lead.hue;

  return finishPalette({
    strategy: 'pop',
    primary: pops[0],
    accent: pops[1],
    secondary: pops[2],
    surface: dark ? hsl(groundHue, 0.08, 0.06) : hsl(45, 0.35, 0.95),
    surfaceAlt: dark ? hsl(groundHue, 0.08, 0.11) : hsl(45, 0.3, 0.89),
    ink: dark ? '#f6f2ea' : '#121010',
    pops,
    dark,
  });
}

/**
 * The `moody` strategy: dark, low-chroma, hushed. A greyscale or night frame
 * has no brand colour to offer, so it gets candlelight — a warm bone tone —
 * rather than an arbitrary hue.
 */
function composeMoody(lead: Swatch | undefined, chromatic: boolean): Palette {
  const h = chromatic && lead ? lead.hue : 38;
  const s = chromatic && lead ? Math.min(0.4, lead.saturation) : 0.35;
  return finishPalette({
    strategy: 'moody',
    primary: hsl(h, s, 0.7),
    accent: hsl(h + (chromatic ? 25 : 0), chromatic ? 0.35 : 0.5, 0.6),
    secondary: hsl(h, 0.1, 0.35),
    surface: hsl(h, chromatic ? 0.12 : 0.05, 0.07),
    surfaceAlt: hsl(h, chromatic ? 0.12 : 0.05, 0.11),
    ink: hsl(h, 0.12, 0.9),
    dark: true,
  });
}

/** The neutral swatch used when a photograph yields nothing usable. */
export const FALLBACK_SWATCH: Swatch = {
  rgb: { r: 90, g: 105, b: 130 },
  hex: '#5a6982',
  population: 1,
  saturation: 0.2,
  lightness: 0.43,
  hue: 218,
  chroma: 0.16,
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
    .filter((s) => s.chroma > 0.08 && s.population > 0.03 && hueDistance(s.hue, primaryHue) > 25)
    .sort(
      (a, b) =>
        hueDistance(b.hue, primaryHue) * b.chroma * (0.5 + b.population) -
        hueDistance(a.hue, primaryHue) * a.chroma * (0.5 + a.population),
    )[0];

  const secondarySrc = ranked
    .slice(1)
    .filter((s) => s.hex !== accentSrc?.hex && hueDistance(s.hue, primaryHue) > 12)[0];

  return { ranked, primarySrc, accentSrc, secondarySrc };
}

/**
 * The swatch that carries a tonal page: coverage times colour, so a sky that
 * fills a tenth of the frame in real blue beats a warm grey that fills a fifth.
 */
function tonalBase(analysis: ImageAnalysis): Swatch {
  const coloured = analysis.swatches.filter((s) => s.chroma > 0.05);
  if (coloured.length === 0) return rankSwatches(analysis).primarySrc;
  return [...coloured].sort((a, b) => b.population * b.chroma - a.population * a.chroma)[0];
}

/** Which way to build the palette, from how colour is distributed and how loud the frame is. */
export function chooseStrategy(analysis: ImageAnalysis, mood: Mood): ColourStrategy {
  const { colour, texture } = analysis;
  // Night frames and dim greyscale get hushed palettes. A bright greyscale frame
  // (fog, paper, snow) is not moody — it falls through to a neutral page.
  if (texture.brightness < 0.28 || (colour.chromaticShare < 0.06 && texture.brightness < 0.5)) {
    return 'moody';
  }
  if (analysis.colorfulness >= 0.38 && (mood.energy >= 0.6 || colour.hueCount >= 3)) return 'pop';
  if (colour.hueCount <= 2 && mood.energy < 0.55 && colour.chromaticShare >= 0.15) return 'tonal';
  return 'accent';
}

/** Light or dark page. Moody is always dark; tonal leans light, since its surface carries colour. */
export function chooseScheme(analysis: ImageAnalysis, strategy: ColourStrategy): boolean {
  if (strategy === 'moody') return true;
  return analysis.texture.brightness < (strategy === 'tonal' ? 0.38 : 0.46);
}

/** Optional role overrides, e.g. from the AI layer. Anything absent is chosen heuristically. */
export interface PaletteRoles {
  primary?: Swatch;
  accent?: Swatch;
  secondary?: Swatch;
}

export function buildPalette(
  analysis: ImageAnalysis,
  mood: Mood,
  strategy: ColourStrategy,
  dark: boolean,
  roles: PaletteRoles = {},
): Palette {
  const heuristic = rankSwatches(analysis);
  switch (strategy) {
    case 'tonal':
      return composeTonal(roles.primary ?? tonalBase(analysis), roles.accent ?? heuristic.accentSrc, dark, mood);
    case 'pop':
      return composePop(heuristic.ranked, roles.primary ?? heuristic.primarySrc, dark);
    case 'moody':
      return composeMoody(roles.primary ?? heuristic.primarySrc, analysis.colour.chromaticShare >= 0.06);
    case 'accent':
    default:
      return composePalette(
        roles.primary ?? heuristic.primarySrc,
        roles.accent ?? heuristic.accentSrc,
        roles.secondary ?? heuristic.secondarySrc,
        dark,
        analysis.colorfulness,
        analysis.texture.brightness,
      );
  }
}

// ---------------------------------------------------------------------------
// Geometry
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

/**
 * Corner radius comes from the layout's character, nudged by how organic the
 * subject is: a poster wall and a concrete block are square, sweets are pills.
 */
const RADIUS_BY_ARCHETYPE: Record<LayoutArchetype, number> = {
  serene: 10,
  editorial: 4,
  gallery: 2,
  technical: 4,
  brutalist: 0,
  soft: 26,
  street: 0,
};

// ---------------------------------------------------------------------------
// Surface finish
// ---------------------------------------------------------------------------

export function classifyFinish(analysis: ImageAnalysis, paletteSaturation: number, mood = computeMood(analysis)): Finish {
  const { specularity, roughness, dynamicRange } = analysis.texture;

  // Roughness carries a heavy negative weight on purpose. Bright speckle alone
  // is not gloss — coarse aggregate throws just as many blown-out pixels as
  // polished glass does. What separates them is that a glossy surface is
  // *smooth* between its highlights, so high roughness has to veto the call.
  const glossScore = specularity * 0.55 + dynamicRange * 0.3 - roughness * 0.75;
  if (glossScore > 0.3) {
    // Chrome and steel glint just as hard as glass but carry no color.
    return paletteSaturation < 0.22 ? 'metallic' : 'glossy';
  }
  if (mood.polish < 0.3) return 'rough';
  if (mood.polish > 0.7) return 'soft';
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
  mood: Mood = computeMood(analysis),
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

  // Grain used to sit at 2–9% under an overlay blend, which on most screens is
  // indistinguishable from none. It now tracks how raw and loud the subject is:
  // a still lake keeps a whisper of tooth, a graffiti wall gets real grit.
  const grit = (1 - mood.polish) * 0.7 + mood.energy * 0.3;

  return {
    finish,
    blur: blurByFinish[finish],
    grain: round(lerp(0.025, 0.16, grit), 4),
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
// Layout, typography & density
// ---------------------------------------------------------------------------

export function chooseArchetype(mood: Mood): LayoutArchetype {
  return nearest(mood, ARCHETYPES).id;
}

/**
 * The pairing closest to the mood among those that belong in this layout. A
 * layout constrains type — a poster wall never gets a hairline serif — and the
 * mood picks within that range.
 */
export function choosePairing(mood: Mood, archetype: LayoutArchetype): FontPairing {
  const suited = FONT_PAIRINGS.filter((p) => p.layouts.includes(archetype));
  return nearest(mood, suited.length ? suited : FONT_PAIRINGS);
}

export function buildTypography(pairing: FontPairing, mood: Mood = NEUTRAL_MOOD): TypographyTokens {
  const heading = FONT_FAMILIES[pairing.heading];
  const body = FONT_FAMILIES[pairing.body];
  const accent = FONT_FAMILIES[pairing.accent];
  return {
    pairing: pairing.id,
    label: heading.name === body.name ? heading.name : `${heading.name} / ${body.name}`,
    headingFont: fontStack(pairing.heading),
    bodyFont: fontStack(pairing.body),
    accentFont: fontStack(pairing.accent),
    families: { heading: heading.name, body: body.name, accent: accent.name },
    headingWeight: pairing.headingWeight,
    bodyWeight: pairing.bodyWeight,
    tracking: pairing.tracking,
    leading: pairing.leading,
    // A loud subject earns bigger display type; a quiet one stays measured.
    scale: round(pairing.scale * lerp(0.95, 1.08, mood.energy), 3),
    uppercase: pairing.uppercase,
    italic: pairing.italic,
  };
}

export function buildSpace(mood: Mood) {
  // Airy subjects breathe; packed ones compress. Section rhythm moves further
  // than the base unit so the difference reads at page scale.
  return {
    unit: round(lerp(1.22, 0.86, mood.density), 3),
    rhythm: round(lerp(1.5, 0.8, mood.density), 3),
  };
}

export function buildLayout(archetype: LayoutArchetype, mood: Mood): LayoutTokens {
  const spec = ARCHETYPE_BY_ID.get(archetype) ?? ARCHETYPES[0];
  return {
    archetype,
    sections: { ...spec.sections },
    heroAlign: spec.heroAlign,
    // A packed photograph gets a narrower column, so the page stays readable
    // against a more active background.
    measure: Math.round(lerp(72, 58, mood.density)),
    featureColumns: spec.featureColumns,
    imageRatio: spec.imageRatio,
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
// Motion
// ---------------------------------------------------------------------------

/**
 * Where each motion character sits in mood space. Chosen by distance, like
 * layouts and type, so a calm open frame drifts, a loud raw one glitches and
 * a hushed one holds still — the first version scored every one of ten test
 * photographs as `glitch`.
 */
const MOTION_PROTOTYPES: Array<{ character: MotionCharacter; mood: Partial<Mood> }> = [
  { character: 'still', mood: { energy: 0.05, density: 0.4 } },
  { character: 'drift', mood: { energy: 0.15, density: 0.2, polish: 0.8 } },
  { character: 'shimmer', mood: { energy: 0.4, order: 0.3, polish: 0.9 } },
  { character: 'bloom', mood: { energy: 0.5, warmth: 0.8, polish: 0.7 } },
  { character: 'settle', mood: { energy: 0.6, order: 0.9, density: 0.85, polish: 0.3 } },
  { character: 'glitch', mood: { energy: 0.9, density: 0.9, polish: 0.15 } },
];

/**
 * Motion is a material property, decided from the same mood as everything else.
 *
 * When the frame is empty the answer is `still` — a page that fidgets for no
 * reason is worse than one that holds still, so "nothing" has to be a
 * reachable outcome rather than whatever the last `else` branch happened to be.
 */
export function classifyMotion(analysis: ImageAnalysis, mood: Mood = computeMood(analysis)): MotionCharacter {
  const { dynamicRange, specularity } = analysis.texture;
  // Nothing was observed, so nothing is implied. Orientation entropy is at its
  // maximum for a blank frame — every angle bin is equally empty — which reads
  // as "organic" to any score that trusts entropy alone.
  if (analysis.edges.density < 0.012 || dynamicRange < 0.06) return 'still';

  // Something genuinely repeats: let the motif carry the movement.
  if (analysis.periodicity.strength >= 0.5) return 'weave';
  // Real specular highlights on a smooth surface: light travelling across it.
  if (specularity > 0.5 && mood.polish > 0.6) return 'shimmer';

  return nearest(mood, MOTION_PROTOTYPES).character;
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
// Gradient mesh & texture
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

/**
 * How much of the photograph's own surface shows through. Raw, packed subjects
 * wear their texture openly; polished, airy ones keep it to a trace.
 */
function buildTexture(mood: Mood, sourceIsDark: boolean): DesignTokens['texture'] {
  return {
    tileOpacity: round(lerp(0.04, 0.3, (1 - mood.polish) * 0.6 + mood.density * 0.4), 3),
    blend: sourceIsDark ? 'soft-light' : 'multiply',
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Describe a mood in words — the inspector's one-line summary. */
export function describeMood(mood: Mood): string {
  const pick = (v: number, low: string, mid: string, high: string) =>
    v < 0.35 ? low : v > 0.65 ? high : mid;
  const words = [
    pick(mood.energy, 'calm', 'lively', 'loud'),
    pick(mood.warmth, 'cool', 'neutral', 'warm'),
    pick(mood.order, 'organic', 'balanced', 'structured'),
    pick(mood.density, 'airy', 'measured', 'packed'),
    pick(mood.polish, 'raw', 'textured', 'refined'),
  ];
  return words.join(', ');
}

function describe(mood: Mood, archetype: LayoutArchetype, typography: TypographyTokens, strategy: ColourStrategy): string {
  const summary = describeMood(mood);
  // "A airy subject" is the kind of seam that makes generated copy read as generated.
  const article = /^[aeiou]/i.test(summary) ? 'An' : 'A';
  return `${article} ${summary} subject — a ${archetype} page set in ${typography.label}, with a ${strategy} palette.`;
}

/**
 * Every choice that shapes a theme. `synthesize` makes them heuristically from
 * the measurements; the AI layer (`lib/patch.ts`) makes some of them from what
 * the model saw. Both go through `assemble`, so a model-made choice gets
 * exactly the same contrast repairs, clamps and derivations as a measured one.
 */
export interface Decisions {
  mood: Mood;
  strategy: ColourStrategy;
  roles?: PaletteRoles;
  weights?: Palette['weights'];
  archetype: LayoutArchetype;
  sections?: SectionPlan;
  pairing: FontPairing;
  /** Classified from the analysis when absent. */
  finish?: Finish;
  motion?: MotionTokens;
  pattern?: Omit<DesignTokens['pattern'], 'image'>;
  textureOpacity?: number;
  copy?: SiteCopy;
  description?: string;
  confidence?: number;
}

/** The heuristic decisions: what the measurements alone say. */
export function decide(analysis: ImageAnalysis): Decisions {
  const mood = computeMood(analysis);
  const archetype = chooseArchetype(mood);
  return {
    mood,
    strategy: chooseStrategy(analysis, mood),
    archetype,
    pairing: choosePairing(mood, archetype),
  };
}

function measuredPattern(analysis: ImageAnalysis, geometry: Geometry) {
  // The analysis buffer is 256px on its *long* edge; scale the detected pitch
  // into something legible as a CSS-space tile. Scaling by width alone shrank
  // every motif from a portrait photo.
  const longEdge = Math.max(analysis.width, analysis.height);
  return {
    kind: classifyPattern(analysis, geometry),
    period: Math.round(Math.min(96, Math.max(8, analysis.periodicity.period * (longEdge / 256) * 2.2))),
    angle: Math.round(analysis.edges.dominantAngle),
    opacity: round(Math.min(0.12, analysis.periodicity.strength * 0.2), 3),
  };
}

/** Turn decisions into a complete, guarded token set. */
export function assemble(analysis: ImageAnalysis, d: Decisions): DesignTokens {
  const { mood, archetype, strategy } = d;
  const sourceIsDark = chooseScheme(analysis, strategy);
  const built = buildPalette(analysis, mood, strategy, sourceIsDark, d.roles);
  const palette = d.weights ? { ...built, weights: d.weights } : built;

  const geometry = classifyGeometry(angularity(analysis));
  const paletteSaturation = (hexToHsl(palette.primary).s + hexToHsl(palette.accent).s) / 2;
  const finish = d.finish ?? classifyFinish(analysis, paletteSaturation, mood);

  // A little more roundness for organic subjects, a little less for structured.
  const unit = Math.round(RADIUS_BY_ARCHETYPE[archetype] * lerp(1.25, 0.75, mood.order));

  const typography = buildTypography(d.pairing, mood);
  const layout = buildLayout(archetype, mood);
  if (d.sections) layout.sections = { ...d.sections };

  const patternSpec = d.pattern ?? measuredPattern(analysis, geometry);
  const pattern = {
    ...patternSpec,
    image:
      patternSpec.kind === 'none'
        ? 'none'
        : buildPattern({
            kind: patternSpec.kind,
            period: patternSpec.period,
            angle: analysis.periodicity.angle,
            color: palette.accent,
            weight: lerp(0.05, 0.14, analysis.edges.strength),
          }),
  };

  const texture = buildTexture(mood, sourceIsDark);
  if (d.textureOpacity !== undefined) texture.tileOpacity = round(d.textureOpacity, 3);

  // How much of this theme was actually driven by the photo, versus by our
  // fallbacks. Shown in the inspector so the result is never a black box.
  const confidence =
    d.confidence ??
    round(
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
    mood,
    palette,
    radius: {
      unit,
      sm: `${round(unit * 0.4, 1)}px`,
      md: `${round(unit * 0.8, 1)}px`,
      lg: `${round(unit * 1.4, 1)}px`,
      xl: `${round(unit * 2.2, 1)}px`,
    },
    typography,
    space: buildSpace(mood),
    surface: buildSurface(analysis, palette, finish, sourceIsDark, mood),
    texture,
    pattern,
    mesh: buildMesh(palette, analysis, sourceIsDark),
    motion: d.motion ?? buildMotion(analysis, classifyMotion(analysis, mood)),
    layout,
    copy: d.copy ?? ARCHETYPE_COPY[archetype],
    meta: {
      geometry,
      description: d.description ?? describe(mood, archetype, typography, strategy),
      confidence,
      sourceIsDark,
    },
  };
}

export function synthesize(analysis: ImageAnalysis): DesignTokens {
  return assemble(analysis, decide(analysis));
}

/** Neutral theme shown before the first capture. */
export function defaultTokens(): DesignTokens {
  const palette: Palette = {
    strategy: 'accent',
    primary: '#5b6cff',
    secondary: '#8a6cff',
    accent: '#38d1c4',
    surface: '#0b0c10',
    surfaceAlt: '#14161f',
    ink: '#f4f5fa',
    inkMuted: '#a9adc0',
    border: '#262a38',
    onPrimary: '#ffffff',
    pops: [],
    weights: DEFAULT_WEIGHTS.accent,
  };

  return {
    mood: NEUTRAL_MOOD,
    palette,
    radius: { unit: 12, sm: '4.8px', md: '9.6px', lg: '16.8px', xl: '26.4px' },
    typography: buildTypography(DEFAULT_PAIRING),
    space: { unit: 1.05, rhythm: 1.2 },
    surface: {
      finish: 'glossy',
      blur: 18,
      grain: 0.04,
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
    texture: { tileOpacity: 0, blend: 'soft-light' },
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
    layout: buildLayout('serene', NEUTRAL_MOOD),
    copy: RESTING_COPY,
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
