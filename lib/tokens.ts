/**
 * The design-token contract.
 *
 * A `DesignTokens` object is the single artifact the analysis pipeline
 * produces. Everything *visual* reaches the DOM as CSS custom properties and
 * data attributes written by `applyTokens`, so colour, type, radius and motion
 * restyle in one frame without React. *Structure* — which hero, which feature
 * layout — is a React decision made from `layout.sections`, because a page that
 * can only be recoloured cannot become a different site.
 */

import type { SiteCopy } from './copy';
import type { Mood } from './mood';

export type Finish = 'glossy' | 'metallic' | 'matte' | 'rough' | 'soft';
export type Geometry = 'sharp' | 'faceted' | 'balanced' | 'organic' | 'round';
export type PatternKind = 'none' | 'stripes' | 'grid' | 'dots' | 'chevron' | 'weave' | 'scatter';

/**
 * How the palette is built, not just which colours are in it.
 *
 * `tonal` keeps to one colour family and lets the surface carry it (a lake
 * becomes a page of blues). `accent` is a neutral page with one brand colour
 * and a second voice. `pop` is several saturated colours used as blocks and
 * stickers on a stark ground. `moody` is dark, low-chroma and hushed.
 */
export type ColourStrategy = 'tonal' | 'accent' | 'pop' | 'moody';

/**
 * How the page moves.
 *
 * Motion is a material property: a smooth, glossy surface shimmers; a coarse,
 * loud one glitches; a calm, open one drifts. `still` is a real answer, not a
 * failure state.
 */
export type MotionCharacter =
  | 'still'
  | 'shimmer'
  | 'glitch'
  | 'drift'
  | 'settle'
  | 'bloom'
  | 'weave';

/**
 * Scope, not just amplitude.
 *
 * `ambient` is page-scale and never asks for attention — the only tier allowed
 * to loop, and only slowly. `accent` fires once as an element enters view and is
 * where most captures should land. `signature` is section-scale and memorable,
 * which is exactly why it is rationed to one element per page.
 */
export type MotionTier = 'ambient' | 'accent' | 'signature';

export type MotionTrigger = 'none' | 'scroll' | 'view';

export interface MotionTokens {
  character: MotionCharacter;
  tier: MotionTier;
  /** 0..1. The single scalar every keyframe reads, so one clamp bounds them all. */
  amplitude: number;
  /** Duration or loop period in ms. */
  period: number;
  easing: string;
  trigger: MotionTrigger;
}

export type LayoutArchetype =
  | 'serene'
  | 'editorial'
  | 'gallery'
  | 'technical'
  | 'brutalist'
  | 'soft'
  | 'street';

export type HeroVariant = 'bleed' | 'split' | 'poster' | 'minimal' | 'mosaic' | 'stack';
export type FeaturesVariant = 'list' | 'columns' | 'cards' | 'stickers' | 'bento' | 'spec';
export type InterludeVariant = 'quote' | 'marquee' | 'metrics' | 'strip';
export type CtaVariant = 'banner' | 'minimal' | 'poster';

/** Which component renders each section of the page. */
export interface SectionPlan {
  hero: HeroVariant;
  features: FeaturesVariant;
  interlude: InterludeVariant;
  cta: CtaVariant;
}

export interface LayoutTokens {
  archetype: LayoutArchetype;
  sections: SectionPlan;
  heroAlign: 'left' | 'center';
  /** Body copy line length, in ch. */
  measure: number;
  featureColumns: 2 | 3 | 4;
  /** CSS aspect-ratio value for images. */
  imageRatio: string;
}

/** A saturated colour for blocks and stickers, with a label colour that reads on it. */
export interface PopColour {
  color: string;
  on: string;
}

export interface Palette {
  strategy: ColourStrategy;
  primary: string;
  secondary: string;
  accent: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  inkMuted: string;
  border: string;
  /** Text color guaranteed to be readable on `primary`. */
  onPrimary: string;
  /** Extra block colours. Empty except under `pop`. */
  pops: PopColour[];
  /**
   * Proportions — roughly how much of the page each role occupies. `support`
   * drives how strongly alternate sections are tinted with the primary.
   */
  weights: { ground: number; support: number; accent: number };
}

export interface MeshStop {
  color: string;
  /** Position as a percentage of the viewport box. */
  x: number;
  y: number;
  /** Radius as a percentage. */
  size: number;
  opacity: number;
}

export interface TypographyTokens {
  /** Id of the chosen pairing in `lib/fonts.ts`. */
  pairing: string;
  /** Human-readable, e.g. "Anton / Archivo". */
  label: string;
  headingFont: string;
  bodyFont: string;
  accentFont: string;
  /** Google Fonts family names, for the exported theme kit. */
  families: { heading: string; body: string; accent: string };
  headingWeight: number;
  bodyWeight: number;
  /** letter-spacing for headings, in em. */
  tracking: number;
  /** line-height multiplier for body copy. */
  leading: number;
  /** Multiplier on the display type scale. */
  scale: number;
  uppercase: boolean;
  italic: boolean;
}

export interface DesignTokens {
  mood: Mood;
  palette: Palette;
  radius: {
    /** Base radius in px; every step derives from it. */
    unit: number;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  typography: TypographyTokens;
  space: {
    /** Base spacing unit in rem — density falls out of this. */
    unit: number;
    /** Section padding multiplier. */
    rhythm: number;
  };
  surface: {
    finish: Finish;
    /** backdrop-filter blur radius in px. */
    blur: number;
    /** Opacity of the procedural noise overlay. */
    grain: number;
    /** Alpha of the specular hairline border. */
    borderAlpha: number;
    /** Alpha of the card fill over the background. */
    fillAlpha: number;
    /** Composed box-shadow value. */
    shadow: string;
    /** Strength of the top-edge specular highlight, 0..1. */
    sheen: number;
    /** Ready-to-use `url("data:image/svg+xml,...")` for the noise overlay. */
    grainImage: string;
  };
  /**
   * How much of the photograph itself shows through as texture. The tile is
   * cut from the capture's most textured region at runtime (`lib/imagery.ts`).
   */
  texture: {
    /** Opacity of the photo-derived texture tile behind textured sections. */
    tileOpacity: number;
    /** Blend mode for the tile, chosen for the scheme so it reads on the surface. */
    blend: 'multiply' | 'screen' | 'soft-light' | 'overlay';
  };
  pattern: {
    kind: PatternKind;
    /** Tile size in px. */
    period: number;
    angle: number;
    opacity: number;
    /** Ready-to-use `url("data:image/svg+xml,...")`. */
    image: string;
  };
  mesh: MeshStop[];
  motion: MotionTokens;
  layout: LayoutTokens;
  copy: SiteCopy;
  meta: {
    geometry: Geometry;
    /** Human-readable summary, shown in the inspector. */
    description: string;
    /** How strongly the source image determined the theme, 0..1. */
    confidence: number;
    sourceIsDark: boolean;
  };
}

/**
 * Build the radial-gradient stack for the mesh background.
 * Kept as a function so the inspector and the renderer can't drift apart.
 */
export function meshToCss(mesh: MeshStop[]): string {
  if (mesh.length === 0) return 'none';
  return mesh
    .map(
      (s) =>
        `radial-gradient(${s.size}% ${s.size}% at ${s.x}% ${s.y}%, ${s.color} 0%, transparent 70%)`,
    )
    .join(', ');
}

/** Tailwind v4's default spacing step, which `--space-unit` scales. */
const BASE_SPACING_REM = 0.25;

/** How many pop colours CSS exposes as `--pop-N` / `--on-pop-N`. */
export const POP_SLOTS = 4;

/**
 * Every custom property `applyTokens` writes, with its value. Split out so the
 * theme-kit export writes exactly what the live page uses.
 */
export function tokenVariables(tokens: DesignTokens): Array<[string, string]> {
  const { palette, radius, typography, space, surface, pattern, texture, layout, motion } = tokens;
  const vars: Array<[string, string | number]> = [
    // --- Tailwind color namespace ------------------------------------------
    ['--color-primary', palette.primary],
    ['--color-secondary', palette.secondary],
    ['--color-accent', palette.accent],
    ['--color-surface', palette.surface],
    ['--color-surface-alt', palette.surfaceAlt],
    ['--color-ink', palette.ink],
    ['--color-ink-muted', palette.inkMuted],
    ['--color-line', palette.border],
    ['--color-on-primary', palette.onPrimary],
    ['--tint', palette.weights.support],

    // --- Tailwind radius namespace ------------------------------------------
    ['--radius-unit', `${radius.unit}px`],
    ['--radius-sm', radius.sm],
    ['--radius-md', radius.md],
    ['--radius-lg', radius.lg],
    ['--radius-xl', radius.xl],

    // --- Tailwind font / tracking / leading namespaces ----------------------
    ['--font-heading', typography.headingFont],
    ['--font-body', typography.bodyFont],
    ['--font-accent', typography.accentFont],
    ['--tracking-heading', `${typography.tracking}em`],
    ['--leading-body', typography.leading],
    ['--weight-heading', typography.headingWeight],
    ['--weight-body', typography.bodyWeight],
    ['--type-scale', typography.scale],
    ['--heading-case', typography.uppercase ? 'uppercase' : 'none'],
    ['--heading-style', typography.italic ? 'italic' : 'normal'],

    // --- Tailwind spacing scale ---------------------------------------------
    ['--spacing', `${(BASE_SPACING_REM * space.unit).toFixed(4)}rem`],
    ['--space-rhythm', space.rhythm],

    // --- Surface / material --------------------------------------------------
    ['--blur-surface', `${surface.blur}px`],
    ['--shadow-elevated', surface.shadow],
    ['--grain-opacity', surface.grain],
    ['--grain-image', surface.grainImage],
    ['--border-alpha', surface.borderAlpha],
    ['--fill-alpha', surface.fillAlpha],
    ['--sheen', surface.sheen],
    ['--texture-opacity', texture.tileOpacity],
    ['--texture-blend', texture.blend],

    // --- Decoration ----------------------------------------------------------
    ['--pattern-image', pattern.image],
    ['--pattern-size', `${pattern.period}px`],
    ['--pattern-opacity', pattern.opacity],
    ['--mesh-image', meshToCss(tokens.mesh)],

    // --- Motion ---------------------------------------------------------------
    ['--motion-amplitude', motion.amplitude],
    ['--motion-period', `${motion.period}ms`],
    ['--motion-ease', motion.easing],

    // --- Composition ----------------------------------------------------------
    ['--measure', `${layout.measure}ch`],
    ['--feature-cols', layout.featureColumns],
    ['--image-ratio', layout.imageRatio],
  ];

  // Pop colours fall back to the accent/primary so every slot always resolves.
  for (let i = 0; i < POP_SLOTS; i++) {
    const pop = palette.pops[i] ?? (i % 2 === 0
      ? { color: palette.accent, on: palette.surface }
      : { color: palette.primary, on: palette.onPrimary });
    vars.push([`--pop-${i + 1}`, pop.color], [`--on-pop-${i + 1}`, pop.on]);
  }

  return vars.map(([k, v]) => [k, String(v)]);
}

/** The data attributes CSS branches on. */
export function tokenAttributes(tokens: DesignTokens): Record<string, string> {
  return {
    finish: tokens.surface.finish,
    geometry: tokens.meta.geometry,
    scheme: tokens.meta.sourceIsDark ? 'dark' : 'light',
    strategy: tokens.palette.strategy,
    motion: tokens.motion.character,
    motionTier: tokens.motion.tier,
    layout: tokens.layout.archetype,
    align: tokens.layout.heroAlign,
  };
}

/**
 * Write tokens to CSS custom properties.
 *
 * This is the whole "dynamic CSS injection" step and the only bridge between
 * the engine and the DOM's styling. It touches no React state, so colour, type
 * and motion restyle the entire document in a single frame.
 *
 * The variable names are not arbitrary: they are Tailwind v4 theme namespaces.
 * Overriding `--color-primary` retargets every `bg-primary`/`text-primary`
 * utility already in the markup; overriding `--radius-lg` reshapes every
 * `rounded-lg`; overriding `--spacing` rescales every `p-*`, `gap-*` and `m-*`
 * at once.
 */
export function applyTokens(tokens: DesignTokens, target?: HTMLElement): void {
  const root = target ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!root) return;

  for (const [name, value] of tokenVariables(tokens)) root.style.setProperty(name, value);
  Object.assign(root.dataset, tokenAttributes(tokens));
}
