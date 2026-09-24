/**
 * Texture from the photograph itself.
 *
 * The first version expressed texture as 2–9% procedural grain, which on most
 * screens is indistinguishable from none, while the richest texture source
 * available — the capture — sat in a thumbnail. This module turns the capture
 * into material the page can wear:
 *
 * - a **duotone** in the palette's darkest colour and its primary, for poster
 *   and brutalist heroes;
 * - a seamless **texture tile** cut from the frame's most textured region and
 *   mirror-tiled, so concrete reads as concrete and water as water behind whole
 *   sections.
 *
 * The pixel operations are pure and tested under Node; `renderImagery` is the
 * thin canvas wrapper the browser calls.
 */

import { Pixels } from './analyze';
import { hexToRgb, luminance } from './color';
import { Palette } from './tokens';

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Map luminance onto a two-colour ramp. Contrast is stretched first so a flat photo still prints. */
export function duotone({ data, width, height }: Pixels, shadowHex: string, highlightHex: string): Uint8ClampedArray {
  const lo = hexToRgb(shadowHex);
  const hi = hexToRgb(highlightHex);
  const n = width * height;

  let min = 1;
  let max = 0;
  for (let i = 0; i < n * 4; i += 4) {
    const l = luma(data[i], data[i + 1], data[i + 2]);
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const span = max - min || 1;

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n * 4; i += 4) {
    // A slight S-curve keeps the print punchy rather than muddy in the mids.
    const t0 = (luma(data[i], data[i + 1], data[i + 2]) - min) / span;
    const t = t0 * t0 * (3 - 2 * t0);
    out[i] = lo.r + (hi.r - lo.r) * t;
    out[i + 1] = lo.g + (hi.g - lo.g) * t;
    out[i + 2] = lo.b + (hi.b - lo.b) * t;
    out[i + 3] = 255;
  }
  return out;
}

/**
 * Top-left corner of the `size`×`size` window with the most luminance
 * variance — where the frame's texture is, as opposed to its sky.
 */
export function textureTileOrigin({ data, width, height }: Pixels, size: number): { x: number; y: number } {
  if (width <= size || height <= size) return { x: 0, y: 0 };
  const step = Math.max(4, Math.floor(size / 4));
  let best = { x: 0, y: 0 };
  let bestVar = -1;

  for (let y0 = 0; y0 + size <= height; y0 += step) {
    for (let x0 = 0; x0 + size <= width; x0 += step) {
      let s = 0;
      let s2 = 0;
      let n = 0;
      // Sample every other pixel; the ranking is all that matters.
      for (let y = y0; y < y0 + size; y += 2) {
        for (let x = x0; x < x0 + size; x += 2) {
          const i = (y * width + x) * 4;
          const l = luma(data[i], data[i + 1], data[i + 2]);
          s += l;
          s2 += l * l;
          n++;
        }
      }
      const v = s2 / n - (s / n) ** 2;
      if (v > bestVar) {
        bestVar = v;
        best = { x: x0, y: y0 };
      }
    }
  }
  return best;
}

/**
 * A seamless, greyscale tile: the chosen window, mirrored into a 2×2 block so
 * every edge meets its own reflection. Greyscale because the tile carries
 * texture, not colour — under a blend mode it takes the page's palette.
 */
export function mirrorTile({ data, width }: Pixels, x0: number, y0: number, size: number): Pixels {
  const out = new Uint8ClampedArray(size * 2 * size * 2 * 4);
  const side = size * 2;

  let min = 1;
  let max = 0;
  const grey = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = ((y0 + y) * width + (x0 + x)) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      grey[y * size + x] = l;
      if (l < min) min = l;
      if (l > max) max = l;
    }
  }
  const span = max - min || 1;

  for (let y = 0; y < side; y++) {
    const sy = y < size ? y : side - 1 - y;
    for (let x = 0; x < side; x++) {
      const sx = x < size ? x : side - 1 - x;
      const v = Math.round(((grey[sy * size + sx] - min) / span) * 255);
      const o = (y * side + x) * 4;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: side, height: side };
}

/** The darker and lighter ends of a duotone for this palette. */
export function duotoneColours(palette: Palette): [string, string] {
  const inkDarker = luminance(hexToRgb(palette.ink)) < luminance(hexToRgb(palette.surface));
  return [inkDarker ? palette.ink : palette.surface, palette.primary];
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

export interface Imagery {
  /** The capture itself, for heroes, crops and strips. */
  photo: string;
  duotone: string;
  tile: string;
}

type Source = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

function canvasFor(source: Source, width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

function toUrl(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.86): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('toBlob failed'))), type, quality),
  );
}

function pixelsToCanvas({ data, width, height }: Pixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

/** Render the capture into the three images the page wears. Object URLs; revoke with `revokeImagery`. */
export async function renderImagery(source: Source, width: number, height: number, palette: Palette): Promise<Imagery> {
  const { canvas: photoCanvas } = canvasFor(source, width, height, 1280);
  const { canvas: work, ctx } = canvasFor(source, width, height, 640);
  const pixels: Pixels = { data: ctx.getImageData(0, 0, work.width, work.height).data, width: work.width, height: work.height };

  const [shadow, highlight] = duotoneColours(palette);
  const toned = duotone(pixels, shadow, highlight);

  const tileSize = Math.max(32, Math.min(160, Math.floor(Math.min(work.width, work.height) / 3)));
  const origin = textureTileOrigin(pixels, tileSize);
  const tile = mirrorTile(pixels, origin.x, origin.y, tileSize);

  const [photo, duo, tex] = await Promise.all([
    toUrl(photoCanvas),
    toUrl(pixelsToCanvas({ data: toned, width: work.width, height: work.height })),
    toUrl(pixelsToCanvas(tile), 'image/png'),
  ]);
  return { photo, duotone: duo, tile: tex };
}

export function revokeImagery(imagery: Imagery | null): void {
  if (!imagery) return;
  for (const url of [imagery.photo, imagery.duotone, imagery.tile]) URL.revokeObjectURL(url);
}

/** The tile is page-wide texture, so it travels as a CSS variable rather than through React. */
export function applyImagery(imagery: Imagery | null, target?: HTMLElement): void {
  const root = target ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!root) return;
  root.style.setProperty('--photo-tile', imagery ? `url("${imagery.tile}")` : 'none');
}
