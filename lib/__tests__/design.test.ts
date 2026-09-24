import { describe, expect, it } from 'vitest';
import { analyzeColour, analyzeComposition, analyzeImage, toGrayscale } from '../analyze';
import { contrastHex, hexToHsl } from '../color';
import { ARCHETYPE_COPY } from '../copy';
import { FONT_FAMILIES, FONT_PAIRINGS, PAIRING_BY_ID, googleFontsUrl } from '../fonts';
import { duotone, mirrorTile, textureTileOrigin } from '../imagery';
import { ARCHETYPES, LAYOUT_ARCHETYPES } from '../layouts';
import { MOOD_AXES, computeMood, nearest } from '../mood';
import { quantize } from '../quantize';
import { buildPalette, choosePairing, chooseStrategy, synthesize } from '../synthesize';
import { POP_SLOTS, tokenVariables } from '../tokens';

function makeImage(width: number, height: number, paint: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const noise = (x: number, y: number) => Math.abs((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1);

/** Sky over sea: two calm horizontal bands. */
const seascape = makeImage(96, 64, (_, y) => (y < 30 ? [150, 185, 215] : [40, 80, 120]));
/** Coarse multi-coloured speckle. */
const confetti = makeImage(96, 64, (x, y) => {
  const n = noise(x, y);
  return n < 0.25 ? [220, 40, 40] : n < 0.5 ? [40, 200, 60] : n < 0.75 ? [40, 90, 220] : [240, 210, 30];
});

describe('quantize', () => {
  it('reports real coverage rather than median-cut’s equal boxes', () => {
    // Three quarters red, one quarter blue.
    const image = makeImage(40, 40, (x) => (x < 30 ? [200, 30, 30] : [30, 30, 200]));
    const swatches = quantize(image.data, { count: 8 });
    expect(swatches[0].population).toBeCloseTo(0.75, 1);
    expect(swatches[1].population).toBeCloseTo(0.25, 1);
  });

  it('merges colours a viewer could not tell apart', () => {
    const image = makeImage(40, 40, (x, y) => [250 - ((x + y) % 3), 250, 250]);
    expect(quantize(image.data, { count: 8 })).toHaveLength(1);
  });

  it('gives white no chroma, whatever HSL claims its saturation is', () => {
    const [white] = quantize(makeImage(8, 8, () => [255, 255, 254]).data);
    expect(white.chroma).toBeLessThan(0.01);
  });
});

describe('colour and composition measurements', () => {
  it('counts hue families', () => {
    expect(analyzeColour(makeImage(32, 32, () => [128, 128, 128])).hueCount).toBe(0);
    expect(analyzeColour(seascape).hueCount).toBe(1);
    expect(analyzeColour(confetti).hueCount).toBeGreaterThanOrEqual(3);
  });

  it('reads orange as warm and blue as cool', () => {
    const orange = analyzeColour(makeImage(16, 16, () => [230, 120, 30])).warmth;
    const blue = analyzeColour(makeImage(16, 16, () => [30, 90, 220])).warmth;
    expect(orange).toBeGreaterThan(0.8);
    expect(blue).toBeLessThan(0.2);
  });

  it('finds bands and negative space in a seascape, and neither in speckle', () => {
    const sea = analyzeComposition(toGrayscale(seascape), 96, 64);
    const busy = analyzeComposition(toGrayscale(confetti), 96, 64);
    expect(sea.banding).toBeGreaterThan(0.8);
    expect(sea.calm).toBeGreaterThan(0.8);
    expect(busy.banding).toBeLessThan(0.1);
    expect(busy.calm).toBeLessThan(0.2);
  });
});

describe('mood', () => {
  it('keeps every axis in 0..1', () => {
    for (const image of [seascape, confetti]) {
      const mood = computeMood(analyzeImage(image));
      for (const axis of MOOD_AXES) {
        expect(mood[axis]).toBeGreaterThanOrEqual(0);
        expect(mood[axis]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reads a calm seascape as calmer, airier and more refined than coarse speckle', () => {
    const sea = computeMood(analyzeImage(seascape));
    const busy = computeMood(analyzeImage(confetti));
    expect(sea.energy).toBeLessThan(busy.energy);
    expect(sea.density).toBeLessThan(busy.density);
    expect(sea.polish).toBeGreaterThan(busy.polish);
  });

  it('ignores axes a target leaves out', () => {
    const mood = { energy: 0.9, warmth: 0, order: 0, density: 0, polish: 0 };
    const pick = nearest(mood, [
      { id: 'calm', mood: { energy: 0.1 } },
      { id: 'loud', mood: { energy: 0.9, warmth: 1 } },
      { id: 'loud-any-warmth', mood: { energy: 0.9 } },
    ]);
    expect(pick.id).toBe('loud-any-warmth');
  });
});

describe('library coverage', () => {
  it('offers at least one pairing for every layout', () => {
    for (const archetype of LAYOUT_ARCHETYPES) {
      expect(FONT_PAIRINGS.some((p) => p.layouts.includes(archetype)), archetype).toBe(true);
    }
  });

  it('keeps the chosen pairing inside the layout it was chosen for', () => {
    for (const spec of ARCHETYPES) {
      expect(choosePairing(spec.mood as never, spec.id).layouts).toContain(spec.id);
    }
  });

  it('names only declared font families', () => {
    for (const p of FONT_PAIRINGS) {
      for (const key of [p.heading, p.body, p.accent]) expect(FONT_FAMILIES[key]).toBeDefined();
      expect(PAIRING_BY_ID.get(p.id)).toBe(p);
    }
  });

  it('builds a Google Fonts URL for the theme kit', () => {
    const url = googleFontsUrl(PAIRING_BY_ID.get('poster')!);
    expect(url).toContain('family=Anton');
    expect(url).toContain('family=Permanent+Marker');
    expect(url).toContain('display=swap');
  });

  it('writes copy for every layout', () => {
    for (const archetype of LAYOUT_ARCHETYPES) {
      const copy = ARCHETYPE_COPY[archetype];
      expect(copy.features.length, archetype).toBeGreaterThanOrEqual(2);
      expect(copy.metrics.length, archetype).toBe(3);
      expect(copy.tags.length, archetype).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('palette strategies', () => {
  const analysis = analyzeImage(confetti);
  const mood = computeMood(analysis);

  it('meets every contrast floor under every strategy and scheme', () => {
    for (const strategy of ['tonal', 'accent', 'pop', 'moody'] as const) {
      for (const dark of [true, false]) {
        const p = buildPalette(analysis, mood, strategy, dark);
        const label = `${strategy}/${dark ? 'dark' : 'light'}`;
        expect(contrastHex(p.ink, p.surface), label).toBeGreaterThanOrEqual(7);
        expect(contrastHex(p.ink, p.surfaceAlt), label).toBeGreaterThanOrEqual(4.5);
        expect(contrastHex(p.inkMuted, p.surface), label).toBeGreaterThanOrEqual(4.5);
        expect(contrastHex(p.inkMuted, p.surfaceAlt), label).toBeGreaterThanOrEqual(4.5);
        expect(contrastHex(p.onPrimary, p.primary), label).toBeGreaterThanOrEqual(4.5);
        expect(contrastHex(p.accent, p.surface), label).toBeGreaterThanOrEqual(3);
        for (const pop of p.pops) expect(contrastHex(pop.on, pop.color), label).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives a loud multi-coloured frame several pop colours', () => {
    expect(chooseStrategy(analysis, mood)).toBe('pop');
    expect(synthesize(analysis).palette.pops.length).toBeGreaterThanOrEqual(3);
  });

  it('lets a tonal surface carry the subject’s hue', () => {
    const p = buildPalette(analyzeImage(seascape), computeMood(analyzeImage(seascape)), 'tonal', false);
    const surface = hexToHsl(p.surface);
    expect(surface.s).toBeGreaterThan(0.15);
    expect(Math.abs(surface.h - 210)).toBeLessThan(25);
  });

  it('exposes a value for every pop slot, even without pops', () => {
    const vars = new Map(tokenVariables(synthesize(analyzeImage(seascape))));
    for (let i = 1; i <= POP_SLOTS; i++) {
      expect(vars.get(`--pop-${i}`)).toMatch(/^#/);
      expect(vars.get(`--on-pop-${i}`)).toMatch(/^#/);
    }
  });
});

describe('imagery', () => {
  const gradient = makeImage(64, 32, (x) => [x * 4, x * 4, x * 4]);

  it('prints a duotone from the shadow colour to the highlight colour', () => {
    const out = duotone(gradient, '#102030', '#f0e0d0');
    expect([out[0], out[1], out[2]]).toEqual([0x10, 0x20, 0x30]);
    const last = (64 - 1) * 4;
    expect([out[last], out[last + 1], out[last + 2]]).toEqual([0xf0, 0xe0, 0xd0]);
  });

  it('cuts the texture tile where the texture is', () => {
    // Flat on the left, noisy on the right.
    const half = makeImage(96, 48, (x, y) => (x < 48 ? [120, 120, 120] : noise(x, y) > 0.5 ? [240, 240, 240] : [20, 20, 20]));
    expect(textureTileOrigin(half, 24).x).toBeGreaterThanOrEqual(40);
  });

  it('mirror-tiles so every edge meets its own reflection', () => {
    const tile = mirrorTile(half(), 0, 0, 16);
    const at = (x: number, y: number) => tile.data[(y * tile.width + x) * 4];
    for (let i = 0; i < tile.width; i++) {
      expect(at(i, 0)).toBe(at(i, tile.height - 1));
      expect(at(0, i)).toBe(at(tile.width - 1, i));
    }
  });
});

function half() {
  return makeImage(32, 32, (x, y) => {
    const v = Math.round(noise(x, y) * 255);
    return [v, v, v];
  });
}
