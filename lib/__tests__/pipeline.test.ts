import { describe, expect, it } from 'vitest';
import { contrastHex, ensureContrast, hexToHsl, hslToHex, rgbToHex } from '../color';
import { colorfulness, quantize } from '../quantize';
import { ImageAnalysis, analyzeEdges, analyzeImage, analyzePeriodicity, toGrayscale } from '../analyze';
import { angularity, classifyFinish, classifyPattern, synthesize } from '../synthesize';
import { buildGrain, buildPattern, stripeSegments, svgToDataUri } from '../patterns';
import { applyTokens, meshToCss } from '../tokens';

// ---------------------------------------------------------------------------
// Synthetic image helpers
// ---------------------------------------------------------------------------

interface Painter {
  (x: number, y: number): [number, number, number];
}

function makeImage(width: number, height: number, paint: Painter) {
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

/** Hard-edged, axis-aligned, low-chroma — a machined-object stand-in. */
const machined = makeImage(128, 128, (x, y) => {
  const inBox = x > 24 && x < 104 && y > 32 && y < 96;
  const v = inBox ? (x % 32 < 16 ? 210 : 40) : 20;
  return [v, v, v + 6];
});

/** Smooth radial blob, saturated — an organic-object stand-in. */
const organic = makeImage(128, 128, (x, y) => {
  const d = Math.hypot(x - 64, y - 64) / 64;
  const t = Math.max(0, 1 - d);
  return [Math.round(60 + 195 * t), Math.round(40 + 130 * t), Math.round(30 + 30 * t)];
});

/** Regular vertical bands at a 16px pitch. */
const striped = makeImage(128, 128, (x) => {
  const on = x % 16 < 8;
  return on ? [230, 230, 235] : [30, 30, 40];
});

describe('color', () => {
  it('round-trips hex through HSL', () => {
    for (const hex of ['#5b6cff', '#38d1c4', '#ffffff', '#000000', '#7f3d0a']) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
    }
  });

  it('computes known WCAG contrast ratios', () => {
    expect(contrastHex('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastHex('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Documented AA-passing pair.
    expect(contrastHex('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('lifts a failing foreground until it clears the target', () => {
    // Mid grey on mid grey starts far below AA.
    const bg = '#767676';
    const fg = '#6f6f6f';
    expect(contrastHex(fg, bg)).toBeLessThan(4.5);
    const fixed = ensureContrast(fg, bg, 4.5);
    expect(contrastHex(fixed, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('preserves hue while correcting contrast', () => {
    const fixed = ensureContrast('#3a5a9a', '#33538f', 4.5);
    const before = hexToHsl('#3a5a9a').h;
    const after = hexToHsl(fixed).h;
    expect(Math.abs(before - after)).toBeLessThan(2);
  });

  it('returns the input untouched when contrast already passes', () => {
    expect(ensureContrast('#ffffff', '#000000', 4.5)).toBe('#ffffff');
  });

  it('clamps out-of-range channels when converting to hex', () => {
    expect(rgbToHex({ r: 300, g: -20, b: 128 })).toBe('#ff0080');
  });
});

describe('quantize', () => {
  it('recovers the planted colors of a two-tone image', () => {
    const swatches = quantize(striped.data, { count: 4 });
    expect(swatches.length).toBeGreaterThanOrEqual(2);
    const lightness = swatches.map((s) => s.lightness).sort((a, b) => a - b);
    expect(lightness[0]).toBeLessThan(0.25);
    expect(lightness[lightness.length - 1]).toBeGreaterThan(0.75);
  });

  it('reports populations that sum to one', () => {
    const total = quantize(organic.data, { count: 8 }).reduce((s, x) => s + x.population, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('returns nothing for a fully transparent buffer', () => {
    expect(quantize(new Uint8ClampedArray(64 * 4), { count: 4 })).toEqual([]);
  });

  it('scores a saturated image as more colorful than a greyscale one', () => {
    expect(colorfulness(organic.data)).toBeGreaterThan(colorfulness(machined.data));
  });
});

describe('analyze', () => {
  it('finds axis-aligned edges in a machined subject', () => {
    const gray = toGrayscale(machined);
    const edges = analyzeEdges(gray, machined.width, machined.height);
    expect(edges.density).toBeGreaterThan(0);
    expect(edges.orthogonality).toBeGreaterThan(0.8);
  });

  it('spreads edge orientation across bins for a curved subject', () => {
    const machinedEdges = analyzeEdges(toGrayscale(machined), 128, 128);
    const organicEdges = analyzeEdges(toGrayscale(organic), 128, 128);
    expect(organicEdges.orientationEntropy).toBeGreaterThan(machinedEdges.orientationEntropy);
  });

  it('normalizes the orientation histogram', () => {
    const { histogram } = analyzeEdges(toGrayscale(machined), 128, 128);
    expect(histogram.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('detects the pitch of a regular stripe', () => {
    const report = analyzePeriodicity(toGrayscale(striped), 128, 128);
    expect(report.strength).toBeGreaterThan(0.3);
    // Colors repeat every 16px, but the *edge map* repeats every 8 — there is a
    // transition at both the rising and the falling edge of each band.
    expect(report.period % 8).toBe(0);
    // The repeat runs across the bands, not along them.
    expect(report.angle).toBe(0);
  });

  it('reports no periodicity for a flat field', () => {
    const flat = makeImage(64, 64, () => [128, 128, 128]);
    expect(analyzePeriodicity(toGrayscale(flat), 64, 64).strength).toBe(0);
  });

  it('rates a stark subject as higher dynamic range than a soft one', () => {
    const starkRange = analyzeImage(machined).texture.dynamicRange;
    const softRange = analyzeImage(
      makeImage(64, 64, (x) => [100 + (x % 8), 100, 100]),
    ).texture.dynamicRange;
    expect(starkRange).toBeGreaterThan(softRange);
  });
});

describe('synthesize', () => {
  it('scores a machined subject as more angular than an organic one', () => {
    expect(angularity(analyzeImage(machined))).toBeGreaterThan(angularity(analyzeImage(organic)));
  });

  it('gives hard-edged subjects tighter corners than round ones', () => {
    const hard = synthesize(analyzeImage(machined));
    const soft = synthesize(analyzeImage(organic));
    expect(hard.radius.unit).toBeLessThan(soft.radius.unit);
  });

  it('always produces AA-readable body text', () => {
    for (const image of [machined, organic, striped]) {
      const { palette } = synthesize(analyzeImage(image));
      expect(contrastHex(palette.ink, palette.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastHex(palette.inkMuted, palette.surface)).toBeGreaterThanOrEqual(4.4);
      expect(contrastHex(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.4);
    }
  });

  it('is deterministic', () => {
    const a = synthesize(analyzeImage(organic));
    const b = synthesize(analyzeImage(organic));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('picks a dark surface for a dark photograph and a light one for a bright photograph', () => {
    const dark = synthesize(analyzeImage(makeImage(64, 64, () => [24, 26, 40])));
    const light = synthesize(analyzeImage(makeImage(64, 64, () => [238, 234, 226])));
    expect(dark.meta.sourceIsDark).toBe(true);
    expect(light.meta.sourceIsDark).toBe(false);
  });

  it('derives an accent when the photo has only one hue', () => {
    const monochrome = synthesize(analyzeImage(makeImage(64, 64, () => [40, 90, 200])));
    expect(monochrome.palette.accent).not.toBe(monochrome.palette.primary);
  });

  it('keeps a derived accent in the same chroma world as the primary', () => {
    // A saturated orange rotated 150° at full chroma lands on electric cyan,
    // which belongs to no photograph — the accent must stay tempered.
    for (const image of [organic, machined, striped]) {
      const { palette } = synthesize(analyzeImage(image));
      expect(hexToHsl(palette.accent).s).toBeLessThanOrEqual(0.72);
    }
  });

  it('keeps the accent legible against the surface it sits on', () => {
    for (const image of [organic, machined, striped]) {
      const { palette } = synthesize(analyzeImage(image));
      // WCAG 1.4.11: non-text UI components need 3:1.
      expect(contrastHex(palette.accent, palette.surface)).toBeGreaterThanOrEqual(2.9);
    }
  });

  it('agrees the article with the adjective it introduces', () => {
    const organicTheme = synthesize(analyzeImage(organic));
    expect(organicTheme.meta.description).not.toMatch(/\bA (organic|angular|evenly)/);
    expect(organicTheme.meta.description).toMatch(/^(A|An) /);
  });

  it('classifies a coarse surface as rough and a flat one as soft', () => {
    const noisy = makeImage(96, 96, (x, y) => {
      const n = ((x * 7 + y * 13) % 17) * 14;
      return [n, n, n];
    });
    const flat = makeImage(96, 96, () => [120, 122, 128]);
    expect(classifyFinish(analyzeImage(noisy), 0.3)).toBe('rough');
    expect(classifyFinish(analyzeImage(flat), 0.3)).toBe('soft');
  });

  it('turns a striped photograph into a striped or grid motif', () => {
    const analysis = analyzeImage(striped);
    expect(['stripes', 'grid']).toContain(classifyPattern(analysis, 'sharp'));
  });

  it('emits no motif when nothing repeats', () => {
    const analysis = analyzeImage(makeImage(64, 64, () => [90, 90, 90]));
    expect(classifyPattern(analysis, 'balanced')).toBe('none');
  });

  it('keeps every numeric token finite and in range', () => {
    for (const image of [machined, organic, striped]) {
      const t = synthesize(analyzeImage(image));
      expect(Number.isFinite(t.radius.unit)).toBe(true);
      expect(t.surface.grain).toBeGreaterThan(0);
      expect(t.surface.grain).toBeLessThan(0.2);
      expect(t.surface.blur).toBeGreaterThanOrEqual(0);
      expect(t.pattern.opacity).toBeLessThanOrEqual(0.12);
      expect(t.space.unit).toBeGreaterThan(0.5);
      expect(t.typography.headingWeight).toBeGreaterThanOrEqual(400);
      expect(t.typography.headingWeight).toBeLessThanOrEqual(900);
      expect(t.meta.confidence).toBeGreaterThan(0);
      expect(t.meta.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('patterns', () => {
  it('escapes characters that would truncate a CSS url()', () => {
    const uri = svgToDataUri('<svg fill="#abcdef" style="width:100%"/>');
    const payload = uri.slice('url("'.length, -'")'.length);
    expect(payload).not.toMatch(/[<>"]/);
    expect(uri).toContain('%23abcdef');
    expect(uri).toContain('100%25');
  });

  it('builds a data URI for every motif kind', () => {
    for (const kind of ['stripes', 'grid', 'dots', 'chevron', 'weave', 'scatter'] as const) {
      const uri = buildPattern({ kind, period: 24, angle: 30, color: '#38d1c4' });
      expect(uri.startsWith('url("data:image/svg+xml,')).toBe(true);
    }
    expect(buildPattern({ kind: 'none', period: 24, angle: 0, color: '#fff' })).toBe('none');
  });

  it('generates a deterministic scatter for a given pitch', () => {
    const a = buildPattern({ kind: 'scatter', period: 30, angle: 0, color: '#fff' });
    const b = buildPattern({ kind: 'scatter', period: 30, angle: 0, color: '#fff' });
    expect(a).toBe(b);
  });

  it('keeps the grain filter reference intact through encoding', () => {
    expect(buildGrain(0.8, 3)).toContain('url(%23n)');
  });

  it('draws stripes perpendicular to the direction they repeat along', () => {
    // The striped fixture repeats along x (periodicity angle 0): its lines are
    // vertical, and the motif has to be too.
    expect(analyzePeriodicity(toGrayscale(striped), 128, 128).angle).toBe(0);
    for (const [x1, , x2] of stripeSegments(24, 0)) expect(x1).toBe(x2);
    for (const [, y1, , y2] of stripeSegments(24, 90)) expect(y1).toBe(y2);
  });

  it('tiles diagonal stripes without a seam', () => {
    // A tile joins its neighbour when every line leaving one edge re-enters at
    // the opposite edge — i.e. the set of crossings on x=0 equals that on x=p.
    const p = 24;
    for (const angle of [45, 135]) {
      const crossings = (x: number) =>
        stripeSegments(p, angle)
          .map(([x1, y1, x2, y2]) => y1 + ((x - x1) * (y2 - y1)) / (x2 - x1))
          .filter((y) => y >= 0 && y <= p)
          .sort((a, b) => a - b);
      expect(crossings(0)).toEqual(crossings(p));
    }
  });
});

describe('tokens', () => {
  it('serializes the mesh to layered radial gradients', () => {
    const css = meshToCss([{ color: 'rgb(1 2 3 / 0.2)', x: 10, y: 20, size: 60, opacity: 1 }]);
    expect(css).toBe('radial-gradient(60% 60% at 10% 20%, rgb(1 2 3 / 0.2) 0%, transparent 70%)');
    expect(meshToCss([])).toBe('none');
  });

  it('writes every variable the stylesheet consumes', () => {
    const declarations: Record<string, string> = {};
    const dataset: Record<string, string> = {};
    const fake = {
      style: { setProperty: (k: string, v: string) => (declarations[k] = v) },
      dataset,
    } as unknown as HTMLElement;

    applyTokens(synthesize(analyzeImage(organic)), fake);

    for (const name of [
      '--color-primary',
      '--color-surface',
      '--color-ink',
      '--color-on-primary',
      '--radius-lg',
      '--font-heading',
      '--tracking-heading',
      '--leading-body',
      '--spacing',
      '--blur-surface',
      '--shadow-elevated',
      '--grain-image',
      '--grain-opacity',
      '--pattern-image',
      '--mesh-image',
    ]) {
      expect(declarations[name], `${name} was not written`).toBeTruthy();
    }
    expect(dataset.finish).toBeTruthy();
    expect(dataset.geometry).toBeTruthy();
  });

  it('scales the Tailwind spacing step with the density token', () => {
    const declarations: Record<string, string> = {};
    const fake = {
      style: { setProperty: (k: string, v: string) => (declarations[k] = v) },
      dataset: {},
    } as unknown as HTMLElement;

    const tokens = synthesize(analyzeImage(organic));
    applyTokens(tokens, fake);
    const written = parseFloat(declarations['--spacing']);
    expect(written).toBeCloseTo(0.25 * tokens.space.unit, 4);
  });
});

describe('robustness', () => {
  it('survives a single-pixel image', () => {
    const tiny = makeImage(1, 1, () => [12, 200, 90]);
    const tokens = synthesize(analyzeImage(tiny));
    expect(tokens.palette.primary).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('survives a pure-black and a pure-white frame', () => {
    for (const shade of [0, 255]) {
      const flat = makeImage(48, 48, () => [shade, shade, shade]);
      const analysis: ImageAnalysis = analyzeImage(flat);
      const tokens = synthesize(analysis);
      expect(contrastHex(tokens.palette.ink, tokens.palette.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
