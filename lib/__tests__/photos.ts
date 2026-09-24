/**
 * Real-photograph fixtures for tests.
 *
 * The synthetic images in `pipeline.test.ts` are perfect boxes and stripes, and
 * thresholds tuned against them do not survive contact with a photograph — real
 * frames have edges at every angle, noise, and more than one colour. These
 * helpers decode the JPEGs in `fixtures/photos/` and downscale them the way the
 * browser does in `extractPixels`, so calibration runs against what a capture
 * actually looks like.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { ANALYSIS_SIZE, Pixels } from '../analyze';

export const PHOTO_DIR = join(process.cwd(), 'fixtures', 'photos');

export const PHOTOS = [
  'lake',
  'graffiti',
  'building',
  'circuit',
  'fruit',
  'candy',
  'cathedral',
  'aqueduct',
  'painting',
  'mandrill',
] as const;

export type PhotoName = (typeof PHOTOS)[number];

/**
 * Area-average downscale to the analysis size. Canvas `drawImage` filters when
 * shrinking; point sampling would alias fine texture into noise the browser
 * never sees, and skew every texture metric.
 */
function downscale(src: Pixels, size = ANALYSIS_SIZE): Pixels {
  const scale = Math.min(1, size / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * src.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * src.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.width) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = b / n;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

const cache = new Map<string, Pixels>();

/** Decode a fixture photo at analysis resolution. */
export function loadPhoto(name: PhotoName): Pixels {
  const hit = cache.get(name);
  if (hit) return hit;
  const decoded = jpeg.decode(readFileSync(join(PHOTO_DIR, `${name}.jpg`)), {
    useTArray: true,
  });
  const data = new Uint8ClampedArray(
    decoded.data.buffer,
    decoded.data.byteOffset,
    decoded.data.byteLength,
  );
  const pixels = downscale({ data, width: decoded.width, height: decoded.height });
  cache.set(name, pixels);
  return pixels;
}
