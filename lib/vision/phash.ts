/**
 * Perceptual hashing, for caching readings.
 *
 * The deterministic engine guarantees that the same photograph always produces
 * the same site — a property worth keeping once a model is in the loop, since a
 * model asked twice may answer twice. Keying the cache on what the image *looks
 * like* rather than on its bytes restores that: two captures of the same object
 * from the same angle resolve to the same hash, reuse the same reading, and
 * therefore render the same page.
 *
 * Difference hash: downscale, then record whether each pixel is brighter than
 * its right-hand neighbour. Robust to exposure and compression, sensitive to
 * structure — which is the right trade here, because structure is what the rest
 * of the pipeline reasons about.
 *
 * Pure and dependency-free.
 */

import { Pixels } from '../analyze';

/** Hash grid. 9×8 comparisons yield the conventional 64 bits. */
const HASH_W = 9;
const HASH_H = 8;

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Box-sample the source down to the hash grid.
 *
 * Averaging over each cell rather than point-sampling is what makes the hash
 * stable under JPEG noise: a single sampled pixel can flip on compression
 * artefacts alone, while a cell mean cannot.
 */
function downsample({ data, width, height }: Pixels): number[] {
  const out = new Array<number>(HASH_W * HASH_H).fill(0);

  for (let gy = 0; gy < HASH_H; gy++) {
    for (let gx = 0; gx < HASH_W; gx++) {
      const x0 = Math.floor((gx * width) / HASH_W);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / HASH_W));
      const y0 = Math.floor((gy * height) / HASH_H);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / HASH_H));

      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const i = (y * width + x) * 4;
          sum += luma(data[i], data[i + 1], data[i + 2]);
          count++;
        }
      }
      out[gy * HASH_W + gx] = count ? sum / count : 0;
    }
  }

  return out;
}

/** A 64-bit difference hash, as 16 lowercase hex characters. */
export function perceptualHash(pixels: Pixels): string {
  if (!pixels.width || !pixels.height) return '0'.repeat(16);

  const grid = downsample(pixels);
  const bits: number[] = [];

  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      bits.push(grid[y * HASH_W + x] > grid[y * HASH_W + x + 1] ? 1 : 0);
    }
  }

  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  }
  return hex;
}

/** Differing bits between two hashes. 0 is identical; ~32 is unrelated. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;

  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Near-identical captures share a reading.
 *
 * The threshold is deliberately tight. A generous one would collapse two
 * genuinely different objects onto one theme, which is a far worse failure than
 * paying for a second reading — the whole point of the product is that a
 * different subject yields a different site.
 */
export const MATCH_THRESHOLD = 5;

export interface CacheEntry<T> {
  hash: string;
  value: T;
}

/** A tiny LRU keyed by perceptual similarity rather than by exact identity. */
export class PerceptualCache<T> {
  private entries: CacheEntry<T>[] = [];

  constructor(private readonly capacity = 24) {}

  get(hash: string): T | undefined {
    const index = this.entries.findIndex(
      (e) => hammingDistance(e.hash, hash) <= MATCH_THRESHOLD,
    );
    if (index === -1) return undefined;

    // Promote on hit, so a repeatedly-photographed subject stays resident.
    const [entry] = this.entries.splice(index, 1);
    this.entries.unshift(entry);
    return entry.value;
  }

  set(hash: string, value: T): void {
    this.entries.unshift({ hash, value });
    if (this.entries.length > this.capacity) this.entries.length = this.capacity;
  }

  get size(): number {
    return this.entries.length;
  }
}
