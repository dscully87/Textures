/**
 * Procedural SVG generation.
 *
 * Motifs detected in a photograph (stripes on fabric, a grid of tiles, the
 * scatter of stone aggregate) become tiling SVGs, serialized to data URIs and
 * handed to CSS as `background-image`. Nothing is rasterized, so a pattern
 * stays crisp at any zoom and costs a few hundred bytes.
 */

import { PatternKind } from './tokens';

/**
 * Encode SVG markup for use inside a CSS `url()`.
 * `#` and `%` must be escaped or the CSS parser truncates the value; quotes and
 * angle brackets are escaped for the same reason.
 */
export function svgToDataUri(svg: string): string {
  const cleaned = svg.replace(/\s+/g, ' ').trim();
  const encoded = cleaned
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/"/g, "'")
    .replace(/\{/g, '%7B')
    .replace(/\}/g, '%7D');
  return `url("data:image/svg+xml,${encoded}")`;
}

export interface PatternOptions {
  kind: PatternKind;
  /** Tile edge length in px. */
  period: number;
  /**
   * Direction the motif *repeats along*, in degrees — the periodicity angle
   * from `analyzePeriodicity`, snapped to 0/45/90/135. Vertical stripes repeat
   * along x, so they arrive as 0 and their lines run at 90.
   */
  angle: number;
  /** Stroke/fill color — usually the accent, already alpha-composited by CSS opacity. */
  color: string;
  /** Line weight relative to the period, 0..1. */
  weight?: number;
}

/** A line segment inside one tile, in tile coordinates. */
export type Segment = [x1: number, y1: number, x2: number, y2: number];

/**
 * Stripe lines for one seamless tile.
 *
 * Lines run perpendicular to the repeat direction. Diagonals are drawn natively
 * rather than by rotating a horizontal tile: a rotated square tile no longer
 * meets its neighbours, which shows up as a visible seam every period. Lines of
 * slope ±1 spaced p/2 apart are periodic in both x and y with period p, so
 * these tiles join exactly.
 */
export function stripeSegments(p: number, repeatAngle: number): Segment[] {
  const a = ((Math.round(repeatAngle / 45) * 45) % 180 + 180) % 180;
  const h = p / 2;
  switch (a) {
    case 0: // repeats along x → vertical lines
      return [0, h, p].map((x) => [x, 0, x, p] as Segment);
    case 90: // repeats along y → horizontal lines
      return [0, h, p].map((y) => [0, y, p, y] as Segment);
    case 45: // repeats along (1,1) → lines along (1,-1): x + y = c
      return [0, h, p, p + h, 2 * p].map((c) => [c - p, p, c, 0] as Segment);
    default: // 135: repeats along (-1,1) → lines along (1,1): x - y = c
      return [-p, -h, 0, h, p].map((c) => [c, 0, c + p, p] as Segment);
  }
}

function stripes(p: number, color: string, weight: number, angle: number): string {
  const w = Math.max(1, p * weight);
  const d = stripeSegments(p, angle)
    .map(([x1, y1, x2, y2]) => `M ${x1} ${y1} L ${x2} ${y2}`)
    .join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p}" height="${p}">
    <path d="${d}" stroke="${color}" stroke-width="${w}"/>
  </svg>`;
}

function grid(p: number, color: string, weight: number): string {
  const w = Math.max(1, p * weight * 0.5);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p}" height="${p}">
    <path d="M ${p} 0 L 0 0 0 ${p}" fill="none" stroke="${color}" stroke-width="${w}"/>
  </svg>`;
}

function dots(p: number, color: string, weight: number): string {
  const r = Math.max(0.75, p * weight * 0.9);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p}" height="${p}">
    <circle cx="${p / 4}" cy="${p / 4}" r="${r}" fill="${color}"/>
    <circle cx="${(p * 3) / 4}" cy="${(p * 3) / 4}" r="${r}" fill="${color}"/>
  </svg>`;
}

/**
 * A zigzag already reads as diagonal, so it is drawn unrotated — rotating the
 * tile would break its edges the same way it breaks rotated stripes.
 */
function chevron(p: number, color: string, weight: number): string {
  const w = Math.max(1, p * weight);
  const h = p / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p}" height="${p}">
    <g fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="square">
      <path d="M 0 ${h} L ${h} 0 L ${p} ${h}"/>
      <path d="M 0 ${p} L ${h} ${h} L ${p} ${p}"/>
    </g>
  </svg>`;
}

function weave(p: number, color: string, weight: number): string {
  const w = Math.max(1, p * weight * 0.8);
  const h = p / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p}" height="${p}">
    <g fill="none" stroke="${color}" stroke-width="${w}">
      <path d="M 0 ${h / 2} L ${h} ${h / 2} M ${h} ${(h * 3) / 2} L ${p} ${(h * 3) / 2}"/>
      <path d="M ${h / 2} 0 L ${h / 2} ${h} M ${(h * 3) / 2} ${h} L ${(h * 3) / 2} ${p}"/>
    </g>
  </svg>`;
}

/** Deterministic scatter — same period always yields the same speckle. */
function scatter(p: number, color: string, weight: number): string {
  let seed = Math.round(p) * 2654435761;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const count = 14;
  const marks: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.max(0.5, p * weight * (0.25 + rand() * 0.6));
    marks.push(
      `<circle cx="${(rand() * p).toFixed(1)}" cy="${(rand() * p).toFixed(1)}" r="${r.toFixed(2)}" fill="${color}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p}" height="${p}">${marks.join('')}</svg>`;
}

export function buildPattern(options: PatternOptions): string {
  const { kind, color, angle } = options;
  const period = Math.max(6, Math.round(options.period));
  const weight = options.weight ?? 0.08;

  switch (kind) {
    case 'stripes':
      return svgToDataUri(stripes(period, color, weight, angle));
    case 'grid':
      return svgToDataUri(grid(period, color, weight));
    case 'dots':
      return svgToDataUri(dots(period, color, weight));
    case 'chevron':
      return svgToDataUri(chevron(period, color, weight));
    case 'weave':
      return svgToDataUri(weave(period, color, weight));
    case 'scatter':
      return svgToDataUri(scatter(period, color, weight));
    case 'none':
    default:
      return 'none';
  }
}

/**
 * Fractal-noise overlay. Layered over flat fills at 2–6% opacity it removes the
 * plastic sheen of solid color and reads as film grain or material tooth.
 *
 * `baseFrequency` scales with the surface's measured roughness: coarse stone
 * gets low frequency (chunky grain), brushed metal gets high.
 */
export function buildGrain(frequency = 0.8, octaves = 3, size = 160): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <filter id="n" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${frequency.toFixed(3)}"
        numOctaves="${octaves}" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    <rect width="100%" height="100%" filter="url(#n)"/>
  </svg>`;
  // The `#` in the filter reference is escaped to %23 by svgToDataUri, which is
  // exactly what the CSS parser needs.
  return svgToDataUri(svg);
}
