/**
 * The design-token contract.
 *
 * A `DesignTokens` object is the single artifact the analysis pipeline
 * produces, and CSS custom properties are the only way it reaches the DOM.
 * Nothing re-renders when the theme changes: `applyTokens` writes ~30
 * variables onto `:root` and every Tailwind utility that references them
 * repaints in the same frame.
 */

export type Finish = 'glossy' | 'metallic' | 'matte' | 'rough' | 'soft';
export type Geometry = 'sharp' | 'faceted' | 'balanced' | 'organic' | 'round';
export type PatternKind = 'none' | 'stripes' | 'grid' | 'dots' | 'chevron' | 'weave' | 'scatter';
export type TypeVoice = 'technical' | 'neutral' | 'editorial' | 'friendly';

/**
 * How the page moves.
 *
 * Motion is a material property: a wavy, specular surface shimmers; a granular,
 * high-contrast one glitches. Every character below is chosen from signals
 * `analyze.ts` already measures, so motion is decided the same way finish and
 * geometry are — and `still` is a real answer, not a failure state.
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

export type MotionTrigger = 'none' | 'scroll' | 'view' | 'hover';

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

export type LayoutArchetype = 'editorial' | 'technical' | 'gallery' | 'brutalist' | 'soft';

/**
 * Composition, expressed as tokens.
 *
 * Without this the markup can only ever be recoloured — the hero stays left, the
 * features stay three-across, and two captures produce the same product in
 * different paint. An archetype plus four scalars is enough for them to read as
 * different products, and it costs no re-render: CSS branches on the attribute
 * exactly as it already does on `data-finish`.
 */
export interface LayoutTokens {
  archetype: LayoutArchetype;
  heroAlign: 'left' | 'center';
  /** Body copy line length, in ch. */
  measure: number;
  featureColumns: 2 | 3 | 4;
  /** CSS aspect-ratio value for the capture figure. */
  imageRatio: string;
}

export interface Palette {
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

export interface DesignTokens {
  palette: Palette;
  radius: {
    /** Base radius in px; every step derives from it. */
    unit: number;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  typography: {
    voice: TypeVoice;
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
    /** letter-spacing for headings, in em. */
    tracking: number;
    /** line-height multiplier for body copy. */
    leading: number;
    /** Multiplier on the display type scale. */
    scale: number;
  };
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
 * Font stacks, keyed to the CSS variables `layout.tsx` publishes via next/font.
 * The `-src` suffixes keep these clear of Tailwind's own `--font-*` namespace,
 * which the theme reassigns at runtime.
 */
export const FONT_STACKS: Record<string, string> = {
  technical: 'var(--font-grotesk-src), ui-sans-serif, system-ui, sans-serif',
  neutral: 'var(--font-sans-src), ui-sans-serif, system-ui, sans-serif',
  editorial: 'var(--font-serif-src), ui-serif, Georgia, serif',
  friendly: 'var(--font-rounded-src), ui-rounded, system-ui, sans-serif',
  mono: 'var(--font-mono-src), ui-monospace, SFMono-Regular, monospace',
};

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

/**
 * Write tokens to CSS custom properties.
 *
 * This is the whole "dynamic CSS injection" step, and it is deliberately the
 * only bridge between the engine and the DOM. It touches no React state, so a
 * new capture restyles the entire document in a single frame without
 * re-rendering a single component.
 *
 * The variable names are not arbitrary: they are Tailwind v4 theme namespaces.
 * Overriding `--color-primary` retargets every `bg-primary`/`text-primary`
 * utility already in the markup; overriding `--radius-lg` reshapes every
 * `rounded-lg`; overriding `--spacing` rescales every `p-*`, `gap-*` and `m-*`
 * at once. That is what makes the restyle zero-latency — the class names on the
 * page never change.
 */
export function applyTokens(tokens: DesignTokens, target?: HTMLElement): void {
  const root = target ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!root) return;

  const set = (name: string, value: string | number) =>
    root.style.setProperty(name, String(value));

  const { palette, radius, typography, space, surface, pattern } = tokens;

  // --- Tailwind color namespace -------------------------------------------
  set('--color-primary', palette.primary);
  set('--color-secondary', palette.secondary);
  set('--color-accent', palette.accent);
  set('--color-surface', palette.surface);
  set('--color-surface-alt', palette.surfaceAlt);
  set('--color-ink', palette.ink);
  set('--color-ink-muted', palette.inkMuted);
  set('--color-line', palette.border);
  set('--color-on-primary', palette.onPrimary);

  // --- Tailwind radius namespace ------------------------------------------
  set('--radius-unit', `${radius.unit}px`);
  set('--radius-sm', radius.sm);
  set('--radius-md', radius.md);
  set('--radius-lg', radius.lg);
  set('--radius-xl', radius.xl);

  // --- Tailwind font / tracking / leading namespaces ----------------------
  set('--font-heading', typography.headingFont);
  set('--font-body', typography.bodyFont);
  set('--tracking-heading', `${typography.tracking}em`);
  set('--leading-body', String(typography.leading));
  set('--weight-heading', typography.headingWeight);
  set('--type-scale', typography.scale);

  // --- Tailwind spacing scale ---------------------------------------------
  set('--spacing', `${(BASE_SPACING_REM * space.unit).toFixed(4)}rem`);
  set('--space-rhythm', space.rhythm);

  // --- Surface / material --------------------------------------------------
  set('--blur-surface', `${surface.blur}px`);
  set('--shadow-elevated', surface.shadow);
  set('--grain-opacity', surface.grain);
  set('--grain-image', surface.grainImage);
  set('--border-alpha', surface.borderAlpha);
  set('--fill-alpha', surface.fillAlpha);
  set('--sheen', surface.sheen);

  // --- Decoration ----------------------------------------------------------
  set('--pattern-image', pattern.image);
  set('--pattern-size', `${pattern.period}px`);
  set('--pattern-opacity', pattern.opacity);
  set('--mesh-image', meshToCss(tokens.mesh));

  // --- Motion ---------------------------------------------------------------
  // Four variables and two attributes are the entire motion surface. The
  // keyframes live in CSS and read `--motion-amplitude`, so changing character
  // or intensity never touches a component.
  set('--motion-amplitude', tokens.motion.amplitude);
  set('--motion-period', `${tokens.motion.period}ms`);
  set('--motion-ease', tokens.motion.easing);

  // --- Composition ----------------------------------------------------------
  set('--measure', `${tokens.layout.measure}ch`);
  set('--feature-cols', tokens.layout.featureColumns);
  set('--image-ratio', tokens.layout.imageRatio);

  // Data attributes let CSS branch on material without inline styles.
  root.dataset.finish = surface.finish;
  root.dataset.geometry = tokens.meta.geometry;
  root.dataset.scheme = tokens.meta.sourceIsDark ? 'dark' : 'light';
  root.dataset.motion = tokens.motion.character;
  root.dataset.motionTier = tokens.motion.tier;
  root.dataset.motionTrigger = tokens.motion.trigger;
  root.dataset.layout = tokens.layout.archetype;
  root.dataset.align = tokens.layout.heroAlign;
}
