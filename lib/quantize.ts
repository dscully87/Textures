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
  /** Share of sampled pixels falling in this box, 0..1. */
  population: number;
  saturation: number;
  lightness: number;
  hue: number;
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

  const total = pixels.length;
  const swatches = boxes
    .filter((b) => b.pixels.length > 0)
    .map<Swatch>((box) => {
      const rgb = averageOf(box.pixels);
      const hsl = rgbToHsl(rgb);
      return {
        rgb,
        hex: rgbToHex(rgb),
        population: box.pixels.length / total,
        saturation: hsl.s,
        lightness: hsl.l,
        hue: hsl.h,
      };
    });

  return swatches.sort((a, b) => b.population - a.population).slice(0, count);
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
