/**
 * Image analysis: everything the synthesizer needs to know about a photograph,
 * expressed as plain numbers.
 *
 * This module deliberately knows nothing about CSS. It answers questions like
 * "how hard are the edges?", "is the surface glossy or matte?", "does a motif
 * repeat, and at what pitch?" — `synthesize.ts` turns those answers into design
 * tokens.
 *
 * All routines operate on RGBA data from a canvas, and are written against
 * plain arrays so they run under Node in tests.
 */

import { Swatch, colorfulness, quantize } from './quantize';

export interface Pixels {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

export interface EdgeReport {
  /** Fraction of pixels sitting on a strong edge, 0..1. */
  density: number;
  /** Mean gradient magnitude, normalized 0..1. */
  strength: number;
  /**
   * Share of edge energy aligned to the horizontal/vertical axes (within ±15°).
   * High for machined, boxy, man-made objects; low for organic contours.
   */
  orthogonality: number;
  /**
   * Normalized entropy of the orientation histogram, 0..1. Curved and organic
   * subjects spread energy across every angle (high); straight-edged subjects
   * concentrate it in a few bins (low).
   */
  orientationEntropy: number;
  /** Dominant edge angle in degrees, 0..180. */
  dominantAngle: number;
  /** 12-bin orientation histogram, normalized to sum 1. */
  histogram: number[];
}

export interface TextureReport {
  /** High-frequency energy — sandpaper and stone score high, glass scores low. */
  roughness: number;
  /** Mean local variance, i.e. how busy the surface is at small scale. */
  granularity: number;
  /** Strength of small, bright, desaturated highlights. Glass and chrome score high. */
  specularity: number;
  /** Spread between the darkest and brightest regions, 0..1. */
  dynamicRange: number;
  /** Mean relative luminance of the whole frame, 0..1. */
  brightness: number;
}

export interface PeriodicityReport {
  /** Confidence that a motif repeats, 0..1. */
  strength: number;
  /** Repeat pitch in pixels of the analyzed (downscaled) image. */
  period: number;
  /** Angle of the repeat in degrees. */
  angle: number;
}

export interface ImageAnalysis {
  swatches: Swatch[];
  colorfulness: number;
  edges: EdgeReport;
  texture: TextureReport;
  periodicity: PeriodicityReport;
  /** Dimensions of the downscaled buffer the metrics were computed on. */
  width: number;
  height: number;
}

/** Longest edge of the buffer we analyze. Small enough to be instant, big enough to be honest. */
export const ANALYSIS_SIZE = 256;

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function toGrayscale({ data, width, height }: Pixels): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = luma(data[i], data[i + 1], data[i + 2]);
  }
  return out;
}

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

export interface SobelResult {
  magnitude: Float32Array;
  angle: Float32Array;
  width: number;
  height: number;
}

export function sobel(gray: Float32Array, width: number, height: number): SobelResult {
  const magnitude = new Float32Array(width * height);
  const angle = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0;
      let gy = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++, k++) {
          const v = gray[(y + dy) * width + (x + dx)];
          gx += v * SOBEL_X[k];
          gy += v * SOBEL_Y[k];
        }
      }
      const i = y * width + x;
      magnitude[i] = Math.hypot(gx, gy);
      // Edge direction is perpendicular to the gradient; we fold to 0..180
      // because an edge and its reverse are the same line.
      let a = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
      a = ((a % 180) + 180) % 180;
      angle[i] = a;
    }
  }

  return { magnitude, angle, width, height };
}

export function analyzeEdges(gray: Float32Array, width: number, height: number): EdgeReport {
  const { magnitude, angle } = sobel(gray, width, height);

  let sum = 0;
  let max = 0;
  for (const m of magnitude) {
    sum += m;
    if (m > max) max = m;
  }
  const mean = sum / magnitude.length;
  // Relative threshold keeps the measure exposure-independent.
  const threshold = Math.max(0.12, mean * 1.8);

  const BINS = 12;
  const histogram = new Array<number>(BINS).fill(0);
  let strongCount = 0;
  let energy = 0;

  for (let i = 0; i < magnitude.length; i++) {
    const m = magnitude[i];
    if (m < threshold) continue;
    strongCount++;
    energy += m;
    const bin = Math.min(BINS - 1, Math.floor((angle[i] / 180) * BINS));
    histogram[bin] += m;
  }

  if (energy === 0) {
    return {
      density: 0,
      strength: 0,
      orthogonality: 0,
      orientationEntropy: 1,
      dominantAngle: 0,
      histogram,
    };
  }

  for (let i = 0; i < BINS; i++) histogram[i] /= energy;

  // Bins 0 and 6 straddle horizontal and vertical (each bin spans 15°).
  const orthogonality = histogram[0] + histogram[BINS - 1] + histogram[5] + histogram[6];

  let entropy = 0;
  for (const p of histogram) if (p > 0) entropy -= p * Math.log(p);
  const orientationEntropy = entropy / Math.log(BINS);

  let peak = 0;
  for (let i = 1; i < BINS; i++) if (histogram[i] > histogram[peak]) peak = i;

  return {
    density: strongCount / magnitude.length,
    strength: Math.min(1, mean / 0.35),
    orthogonality: Math.min(1, orthogonality),
    orientationEntropy,
    dominantAngle: (peak + 0.5) * (180 / BINS),
    histogram,
  };
}

export function analyzeTexture(
  { data }: Pixels,
  gray: Float32Array,
  width: number,
  height: number,
): TextureReport {
  // Laplacian energy: the classic "is this sharp or smooth" measure, which for
  // an in-focus photo tracks surface roughness.
  let lapSum = 0;
  let lapCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      lapSum += Math.abs(v);
      lapCount++;
    }
  }
  const roughness = lapCount ? Math.min(1, lapSum / lapCount / 0.12) : 0;

  // Local variance over 4x4 tiles.
  let varSum = 0;
  let tiles = 0;
  const TILE = 4;
  for (let ty = 0; ty + TILE <= height; ty += TILE) {
    for (let tx = 0; tx + TILE <= width; tx += TILE) {
      let s = 0;
      let s2 = 0;
      for (let y = ty; y < ty + TILE; y++) {
        for (let x = tx; x < tx + TILE; x++) {
          const v = gray[y * width + x];
          s += v;
          s2 += v * v;
        }
      }
      const n = TILE * TILE;
      varSum += Math.max(0, s2 / n - (s / n) ** 2);
      tiles++;
    }
  }
  const granularity = tiles ? Math.min(1, Math.sqrt(varSum / tiles) / 0.25) : 0;

  // Specular highlights: small, bright, *desaturated* regions. Saturation
  // matters — a bright yellow wall is not a highlight, a white glint is.
  let highlight = 0;
  let counted = 0;
  let lumSum = 0;
  const lums: number[] = [];
  for (let i = 0, p = 0; p < width * height; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = luma(r, g, b);
    lumSum += l;
    lums.push(l);
    counted++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (l > 0.85 && sat < 0.25) highlight++;
  }

  lums.sort((a, b) => a - b);
  const pct = (q: number) => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))] ?? 0;
  const dynamicRange = Math.max(0, pct(0.98) - pct(0.02));

  const share = counted ? highlight / counted : 0;
  // Highlights are meant to be *small*. A blown-out white frame is not glossy,
  // so the response peaks around a few percent coverage and falls off after.
  const specularity = Math.min(1, share < 0.14 ? share / 0.07 : Math.max(0, (0.4 - share) / 0.26));

  return {
    roughness,
    granularity,
    specularity,
    dynamicRange,
    brightness: counted ? lumSum / counted : 0,
  };
}

/**
 * Directional autocorrelation of the edge map. If a motif repeats — stripes on
 * a shirt, a brick course, a woven grid — the edge map correlates strongly with
 * itself at the repeat pitch.
 */
export function analyzePeriodicity(
  gray: Float32Array,
  width: number,
  height: number,
): PeriodicityReport {
  const { magnitude } = sobel(gray, width, height);

  // Mean-center so the correlation measures structure, not overall brightness.
  let mean = 0;
  for (const m of magnitude) mean += m;
  mean /= magnitude.length;

  const centered = new Float32Array(magnitude.length);
  let variance = 0;
  for (let i = 0; i < magnitude.length; i++) {
    const v = magnitude[i] - mean;
    centered[i] = v;
    variance += v * v;
  }
  if (variance === 0) return { strength: 0, period: 0, angle: 0 };

  const directions: Array<{ angle: number; dx: number; dy: number }> = [
    { angle: 0, dx: 1, dy: 0 },
    { angle: 45, dx: 1, dy: 1 },
    { angle: 90, dx: 0, dy: 1 },
    { angle: 135, dx: -1, dy: 1 },
  ];

  const maxLag = Math.floor(Math.min(width, height) / 3);
  const norm = variance / magnitude.length;
  const results: PeriodicityReport[] = [];

  for (const dir of directions) {
    const curve: number[] = [];
    // Skip lag 0..3: neighboring pixels always correlate, that's not a motif.
    for (let lag = 4; lag <= maxLag; lag++) {
      let sum = 0;
      let n = 0;
      const ox = dir.dx * lag;
      const oy = dir.dy * lag;
      // Rows are subsampled for speed, but columns are not: skipping columns
      // aliases odd lags onto even ones and blurs the fundamental.
      for (let y = 0; y < height; y += 2) {
        const y2 = y + oy;
        if (y2 < 0 || y2 >= height) continue;
        for (let x = 0; x < width; x++) {
          const x2 = x + ox;
          if (x2 < 0 || x2 >= width) continue;
          sum += centered[y * width + x] * centered[y2 * width + x2];
          n++;
        }
      }
      curve.push(n === 0 ? 0 : sum / n / norm);
    }
    if (curve.length === 0) continue;

    // Prominence, not raw correlation, is the evidence of a repeat.
    //
    // A striped subject correlates near-perfectly at *every* lag along the
    // stripe direction, because the image is translation-invariant that way —
    // high correlation there means "nothing changes", not "something repeats".
    // A real motif produces peaks at multiples of its pitch and troughs
    // between, so we score the peak against the mean of the whole curve.
    const mean = curve.reduce((s, v) => s + v, 0) / curve.length;
    const peak = Math.max(...curve);
    const prominence = peak - mean;

    // Among the harmonics, the smallest lag that reaches the peak is the
    // fundamental; the rest are its multiples.
    const threshold = mean + prominence * 0.95;
    const fundamental = curve.findIndex((v) => v >= threshold);

    results.push({
      strength: prominence,
      period: fundamental >= 0 ? fundamental + 4 : curve.indexOf(peak) + 4,
      angle: dir.angle,
    });
  }

  if (results.length === 0) return { strength: 0, period: 0, angle: 0 };

  // A diagonal shift displaces along both axes, so an axis-aligned motif also
  // shows up (weakly attenuated) on the diagonals — for vertical stripes, a 135°
  // shift aliases onto exactly the same x-displacement as a 0° one. Left to a
  // plain maximum, sampling noise at the borders decides between them. Require a
  // diagonal to win by a clear margin before calling a motif diagonal.
  const strongest = (list: PeriodicityReport[]) =>
    list.sort((a, b) => b.strength - a.strength)[0];

  const axis = strongest(results.filter((r) => r.angle % 90 === 0));
  const diagonal = strongest(results.filter((r) => r.angle % 90 !== 0));
  const best = diagonal && diagonal.strength > axis.strength * 1.15 ? diagonal : axis;

  return { ...best, strength: Math.max(0, Math.min(1, best.strength)) };
}

/** Run the full analysis over a downscaled RGBA buffer. */
export function analyzeImage(pixels: Pixels): ImageAnalysis {
  const { width, height, data } = pixels;
  const gray = toGrayscale(pixels);

  return {
    swatches: quantize(data, { count: 8, stride: 1 }),
    colorfulness: colorfulness(data),
    edges: analyzeEdges(gray, width, height),
    texture: analyzeTexture(pixels, gray, width, height),
    periodicity: analyzePeriodicity(gray, width, height),
    width,
    height,
  };
}

/**
 * Draw an image source onto an offscreen canvas at analysis resolution and
 * return its pixels. Browser-only — the rest of this module is environment
 * agnostic.
 */
export function extractPixels(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  size = ANALYSIS_SIZE,
): Pixels {
  const scale = Math.min(1, size / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.drawImage(source, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}
