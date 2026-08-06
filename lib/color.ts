/**
 * Color primitives for the synthesis pipeline.
 *
 * Everything here is pure and dependency-free so it can run identically in the
 * browser (during live capture) and in Node (during tests).
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const clamp01 = (v: number) => clamp(v, 0, 1);

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): RGB {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;

  h *= 60;
  if (h < 0) h += 360;

  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  const m = l - c / 2;
  return {
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
  };
}

export const hexToHsl = (hex: string) => rgbToHsl(hexToRgb(hex));
export const hslToHex = (hsl: HSL) => rgbToHex(hslToRgb(hsl));

/** Relative luminance per WCAG 2.1. */
export function luminance({ r, g, b }: RGB): number {
  const chan = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** WCAG contrast ratio between two colors, 1..21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const contrastHex = (a: string, b: string) => contrastRatio(hexToRgb(a), hexToRgb(b));

/**
 * Nudge `fg` lighter or darker (whichever direction the background allows)
 * until it clears `target` contrast against `bg`. Hue and saturation survive,
 * so the adjusted color still reads as part of the captured palette.
 */
export function ensureContrast(fg: string, bg: string, target = 4.5): string {
  if (contrastHex(fg, bg) >= target) return fg;

  const bgLum = luminance(hexToRgb(bg));
  const hsl = hexToHsl(fg);
  // Push away from the background: dark backgrounds get lighter text.
  const direction = bgLum < 0.5 ? 1 : -1;

  let best = fg;
  let bestRatio = contrastHex(fg, bg);

  for (let step = 1; step <= 100; step++) {
    const l = clamp01(hsl.l + direction * step * 0.01);
    const candidate = hslToHex({ ...hsl, l });
    const ratio = contrastHex(candidate, bg);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
    if (ratio >= target) return candidate;
    if (l === 0 || l === 1) break;
  }

  // Even pure black/white in that direction fell short — take the other pole.
  if (bestRatio < target) {
    const pole = bgLum < 0.5 ? '#ffffff' : '#000000';
    if (contrastHex(pole, bg) > bestRatio) return pole;
  }
  return best;
}

/** Perceptual-ish distance in a cylindrical space, weighted toward hue. */
export function colorDistance(a: RGB, b: RGB): number {
  const ha = rgbToHsl(a);
  const hb = rgbToHsl(b);
  let dh = Math.abs(ha.h - hb.h);
  if (dh > 180) dh = 360 - dh;
  // Hue only matters when both colors carry chroma.
  const chroma = Math.min(ha.s, hb.s);
  return Math.sqrt(
    (dh / 180) ** 2 * chroma * 2 + (ha.s - hb.s) ** 2 + (ha.l - hb.l) ** 2 * 1.5,
  );
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

export const withAlpha = (hex: string, alpha: number) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${clamp01(alpha)})`;
};

export const isLight = (hex: string) => luminance(hexToRgb(hex)) > 0.45;

/** Rotate a hue by `deg`, keeping saturation and lightness. */
export function rotateHue(hex: string, deg: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, h: (hsl.h + deg + 360) % 360 });
}

export function setLightness(hex: string, l: number): string {
  return hslToHex({ ...hexToHsl(hex), l: clamp01(l) });
}

export function saturate(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, s: clamp01(hsl.s + amount) });
}
