/**
 * Median-cut color quantization over raw RGBA pixel data.
 *
 * Color Thief and friends do roughly this, but rolling it ourselves keeps the
 * pipeline dependency-free, lets us keep per-swatch population and saturation
 * statistics (which the token synthesizer needs to assign roles), and means the
 * exact same code path runs in tests.
 */

import { RGB, rgbToHsl, rgbToHex } from './color';

export interface Swatch {
  rgb: RGB;
  hex: string;
  /** Share of sampled pixels nearest to this colour, 0..1. */
  population: number;
  /**
   * HSL saturation. Unstable near black and white — HSL divides by a term that
   * vanishes at both poles, so an off-white reads as 80–100% "saturated".
   * Rank by `chroma` instead.
   */
  saturation: number;
  lightness: number;
  hue: number;
  /** Colourfulness as (max − min) / 255 — well-behaved at every lightness. */
  chroma: number;
}

interface Box {
  pixels: RGB[];
}

const channelRange = (pixels: RGB[], channel: keyof RGB) => {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pixels) {
    const v = p[channel];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
};

function splitBox(box: Box): [Box, Box] | null {
  if (box.pixels.length < 2) return null;

  const ranges: Array<[keyof RGB, number]> = [
    ['r', channelRange(box.pixels, 'r')],
    ['g', channelRange(box.pixels, 'g')],
    ['b', channelRange(box.pixels, 'b')],
  ];
  ranges.sort((a, b) => b[1] - a[1]);
  const [channel, range] = ranges[0];
  if (range === 0) return null;

  const sorted = [...box.pixels].sort((a, b) => a[channel] - b[channel]);
  const mid = Math.floor(sorted.length / 2);
  return [{ pixels: sorted.slice(0, mid) }, { pixels: sorted.slice(mid) }];
}

function averageOf(pixels: RGB[]): RGB {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = pixels.length;
  return { r: r / n, g: g / n, b: b / n };
}

export interface QuantizeOptions {
  /** Number of swatches to aim for. Rounded up to the next power of two internally. */
  count?: number;
  /** Skip near-transparent pixels. */
  alphaThreshold?: number;
  /** Sample every Nth pixel. 1 = every pixel. */
  stride?: number;
}

/**
 * Reduce RGBA image data to a ranked list of representative swatches.
 * Returned swatches are sorted by population, most common first.
 */
export function quantize(
  data: Uint8ClampedArray | number[],
  options: QuantizeOptions = {},
): Swatch[] {
  const { count = 8, alphaThreshold = 125, stride = 1 } = options;

  const pixels: RGB[] = [];
  for (let i = 0; i < data.length; i += 4 * stride) {
    const a = data[i + 3];
    if (a !== undefined && a < alphaThreshold) continue;
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }

  if (pixels.length === 0) return [];

  let boxes: Box[] = [{ pixels }];
  // Each pass doubles the box count, so ceil(log2(count)) passes is enough.
  const passes = Math.ceil(Math.log2(Math.max(2, count)));

  for (let pass = 0; pass < passes; pass++) {
    const next: Box[] = [];
    for (const box of boxes) {
      const split = splitBox(box);
      if (split) next.push(split[0], split[1]);
      else next.push(box);
    }
    if (next.length === boxes.length) break; // nothing left to split
    boxes = next;
  }

  // Median cut splits every box at its median, so each final box holds the
  // same number of pixels — 1/8 each — whatever the photograph looks like.
  // Taken as-is, "population" would be a constant. Reassigning pixels to their
  // nearest box colour (two Lloyd iterations) recovers real coverage: a sky
  // that fills half the frame reports half the frame.
  let centroids = boxes.filter((b) => b.pixels.length > 0).map((b) => averageOf(b.pixels));
  let counts = new Array<number>(centroids.length).fill(0);
  for (let iteration = 0; iteration < 2; iteration++) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0 }));
    counts = new Array<number>(centroids.length).fill(0);
    for (const p of pixels) {
      const k = nearestIndex(centroids, p);
      sums[k].r += p.r;
      sums[k].g += p.g;
      sums[k].b += p.b;
      counts[k]++;
    }
    centroids = centroids.map((c, k) =>
      counts[k] ? { r: sums[k].r / counts[k], g: sums[k].g / counts[k], b: sums[k].b / counts[k] } : c,
    );
  }

  // Merge colours a viewer could not tell apart; a white background otherwise
  // occupies three of eight slots and crowds out the subject.
  const merged: Array<{ rgb: RGB; count: number }> = [];
  centroids.forEach((rgb, k) => {
    if (!counts[k]) return;
    const twin = merged.find((m) => rgbDistance(m.rgb, rgb) < MERGE_DISTANCE);
    if (twin) {
      const n = twin.count + counts[k];
      twin.rgb = {
        r: (twin.rgb.r * twin.count + rgb.r * counts[k]) / n,
        g: (twin.rgb.g * twin.count + rgb.g * counts[k]) / n,
        b: (twin.rgb.b * twin.count + rgb.b * counts[k]) / n,
      };
      twin.count = n;
    } else {
      merged.push({ rgb, count: counts[k] });
    }
  });

  const total = pixels.length;
  const swatches = merged.map<Swatch>(({ rgb, count: n }) => {
    const hsl = rgbToHsl(rgb);
    return {
      rgb,
      hex: rgbToHex(rgb),
      population: n / total,
      saturation: Math.min(1, hsl.s),
      lightness: hsl.l,
      hue: hsl.h,
      chroma: (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255,
    };
  });

  return swatches.sort((a, b) => b.population - a.population).slice(0, count);
}

/** Euclidean RGB distance below which two swatches are the same colour to the eye. */
const MERGE_DISTANCE = 18;

const rgbDistance = (a: RGB, b: RGB) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

function nearestIndex(centroids: RGB[], p: RGB): number {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < centroids.length; k++) {
    const c = centroids[k];
    const d = (c.r - p.r) ** 2 + (c.g - p.g) ** 2 + (c.b - p.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * Overall "colorfulness" after Hasler & Süsstrunk (2003), normalized to 0..1.
 * Drives how far the generated theme leans on saturated gradients versus
 * restrained neutrals.
 */
export function colorfulness(data: Uint8ClampedArray | number[], stride = 4): number {
  const rg: number[] = [];
  const yb: number[] = [];

  for (let i = 0; i < data.length; i += 4 * stride) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    rg.push(r - g);
    yb.push(0.5 * (r + g) - b);
  }
  if (rg.length === 0) return 0;

  const stats = (arr: number[]) => {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    return { mean, std: Math.sqrt(variance) };
  };

  const a = stats(rg);
  const b = stats(yb);
  const stdRoot = Math.sqrt(a.std ** 2 + b.std ** 2);
  const meanRoot = Math.sqrt(a.mean ** 2 + b.mean ** 2);
  const metric = stdRoot + 0.3 * meanRoot;

  // ~150 is a vividly colorful image in the original paper's scale.
  return Math.min(1, metric / 150);
}
