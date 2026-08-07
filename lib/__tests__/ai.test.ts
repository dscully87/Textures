import { describe, expect, it } from 'vitest';
import { ImageAnalysis, analyzeImage } from '../analyze';
import { parseReading, SceneReading } from '../ai/reading';
import { buildUserPrompt } from '../ai/prompt';
import { applyReading } from '../patch';
import { classifyMotion, synthesize } from '../synthesize';
import { contrastHex } from '../color';
import { PerceptualCache, hammingDistance, perceptualHash } from '../vision/phash';
import { topLabels } from '../vision/labels';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** Coarse, high-contrast noise — the profile `glitch` is meant to catch. */
const gritty = makeImage(96, 96, (x, y) => {
  const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
  const v = Math.abs(n) > 0.5 ? 235 : 25;
  return [v, v - 4, v - 10];
});

/** Smooth, bright, low-frequency — the profile `shimmer`/`bloom` is meant to catch. */
const glassy = makeImage(96, 96, (x, y) => {
  const t = Math.max(0, 1 - Math.hypot(x - 48, y - 48) / 60);
  const v = Math.round(120 + 130 * t * t);
  return [v, v, Math.min(255, v + 8)];
});

const grittyPixels = gritty;
const grittyAnalysis = analyzeImage(gritty);
const glassyAnalysis = analyzeImage(glassy);

/** A reading with every field valid, used as the base for targeted mutations. */
function validReading(overrides: Record<string, unknown> = {}) {
  return {
    subject: 'test subject',
    material: 'metal',
    context: 'industrial',
    palette: {
      primaryIndex: 0,
      accentIndex: null,
      neutralIndex: null,
      weights: { ground: 0.6, support: 0.3, accent: 0.1 },
      rationale: 'because',
    },
    motion: {
      character: 'glitch',
      tier: 'accent',
      amplitude: 0.5,
      period: 700,
      trigger: 'view',
      signatureRationale: null,
    },
    layout: {
      archetype: 'technical',
      heroAlign: 'left',
      density: 'normal',
      measure: 'normal',
      featureColumns: 3,
      imageRatio: '4/3',
    },
    motif: { kind: 'none', scale: 'medium', presence: 'absent' },
    voice: 'technical',
    finishOverride: null,
    confidence: 0.8,
    disagreements: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('parseReading', () => {
  it('rejects payloads that are not objects', () => {
    for (const raw of [null, undefined, 'text', 42, []]) {
      expect(parseReading(raw, 4)).toBeNull();
    }
  });

  it('rejects a swatch index outside the measured palette', () => {
    // The one route by which a model could smuggle in a colour that is not in
    // the photograph, so it must fall back rather than clamp to a neighbour.
    const reading = parseReading(
      validReading({ palette: { ...validReading().palette, primaryIndex: 99 } }),
      4,
    );
    expect(reading?.palette.primaryIndex).toBe(0);
  });

  it('rejects a negative, fractional or stringly-typed swatch index', () => {
    for (const bad of [-1, 1.5, '2', null, {}]) {
      const reading = parseReading(
        validReading({ palette: { ...validReading().palette, accentIndex: bad } }),
        4,
      );
      expect(reading!.palette.accentIndex).toBeNull();
    }
  });

  it('falls back on unknown enum members rather than passing them through', () => {
    const reading = parseReading(
      validReading({ voice: 'shouty', material: 'unobtainium', motion: { character: 'explode' } }),
      4,
    );
    expect(reading?.voice).toBe('neutral');
    expect(reading?.material).toBe('composite');
    expect(reading?.motion.character).toBe('still');
  });

  it('normalises palette weights that do not sum to one', () => {
    const reading = parseReading(
      validReading({
        palette: { ...validReading().palette, weights: { ground: 6, support: 3, accent: 1 } },
      }),
      4,
    );
    const { ground, support, accent } = reading!.palette.weights;
    expect(ground + support + accent).toBeCloseTo(1, 2);
    expect(ground).toBeCloseTo(0.6, 2);
  });

  it('refuses a signature tier that was not argued for', () => {
    const reading = parseReading(
      validReading({
        motion: { ...validReading().motion, tier: 'signature', signatureRationale: null },
      }),
      4,
    );
    expect(reading?.motion.tier).toBe('accent');
  });

  it('refuses a signature tier whose rationale is a token gesture', () => {
    const reading = parseReading(
      validReading({
        motion: { ...validReading().motion, tier: 'signature', signatureRationale: 'yes' },
      }),
      4,
    );
    expect(reading?.motion.tier).toBe('accent');
  });

  it('keeps a signature tier that is properly argued', () => {
    const reading = parseReading(
      validReading({
        motion: {
          ...validReading().motion,
          tier: 'signature',
          signatureRationale: 'the subject is a single dominant reflective curve',
        },
      }),
      4,
    );
    expect(reading?.motion.tier).toBe('signature');
  });

  it('collapses every motion field when the character is still', () => {
    // "still but signature" would be meaningless, so nothing else survives.
    const reading = parseReading(
      validReading({
        motion: { character: 'still', tier: 'signature', amplitude: 1, period: 50, trigger: 'hover' },
      }),
      4,
    );
    expect(reading?.motion).toMatchObject({
      character: 'still',
      tier: 'ambient',
      amplitude: 0,
      period: 0,
      trigger: 'none',
    });
  });

  it('holds ambient motion to a slow loop', () => {
    const reading = parseReading(
      validReading({
        motion: { ...validReading().motion, tier: 'ambient', period: 300, amplitude: 0.9 },
      }),
      4,
    );
    expect(reading!.motion.period).toBeGreaterThanOrEqual(20000);
    expect(reading!.motion.amplitude).toBeLessThanOrEqual(0.15);
  });

  it('clamps amplitude into the tier ceiling', () => {
    const reading = parseReading(
      validReading({ motion: { ...validReading().motion, amplitude: 42 } }),
      4,
    );
    expect(reading!.motion.amplitude).toBeLessThanOrEqual(0.7);
  });

  it('survives a payload with every field missing', () => {
    const reading = parseReading({}, 3);
    expect(reading).not.toBeNull();
    expect(reading!.motion.character).toBe('still');
    expect(reading!.palette.primaryIndex).toBe(0);
  });
});

describe('applyReading', () => {
  const base = synthesize(grittyAnalysis);

  function apply(reading: SceneReading, analysis: ImageAnalysis = grittyAnalysis) {
    return applyReading(base, reading, analysis);
  }

  it('preserves the contrast floors after the model reassigns the palette', () => {
    // The central promise: colour role assignment is the model's, but the
    // guards are not negotiable.
    for (let i = 0; i < grittyAnalysis.swatches.length; i++) {
      const reading = parseReading(
        validReading({ palette: { ...validReading().palette, primaryIndex: i } }),
        grittyAnalysis.swatches.length,
      )!;
      const { tokens } = apply(reading);

      expect(contrastHex(tokens.palette.ink, tokens.palette.surface)).toBeGreaterThanOrEqual(6.9);
      expect(contrastHex(tokens.palette.inkMuted, tokens.palette.surface)).toBeGreaterThanOrEqual(4.4);
      expect(contrastHex(tokens.palette.onPrimary, tokens.palette.primary)).toBeGreaterThanOrEqual(4.4);
    }
  });

  it('downgrades signature when the model is not confident', () => {
    const reading = parseReading(
      validReading({
        confidence: 0.4,
        motion: {
          ...validReading().motion,
          tier: 'signature',
          signatureRationale: 'the subject is a single dominant reflective curve',
        },
      }),
      grittyAnalysis.swatches.length,
    )!;

    const { tokens, report } = apply(reading);
    expect(tokens.motion.tier).toBe('accent');
    expect(report.refused.join(' ')).toMatch(/confidence/);
  });

  it('downgrades signature when the photograph has no dynamic range to carry it', () => {
    // A flat frame cannot justify a loud page, whatever the model asks for.
    const flat = analyzeImage(makeImage(64, 64, () => [128, 128, 130]));
    const reading = parseReading(
      validReading({
        confidence: 0.95,
        motion: {
          ...validReading().motion,
          tier: 'signature',
          signatureRationale: 'the subject is a single dominant reflective curve',
        },
      }),
      Math.max(1, flat.swatches.length),
    )!;

    const { tokens, report } = applyReading(synthesize(flat), reading, flat);
    expect(tokens.motion.tier).toBe('accent');
    expect(report.refused.join(' ')).toMatch(/dynamic range/);
  });

  it('caps motion amplitude by the frame’s own energy', () => {
    const flat = analyzeImage(makeImage(64, 64, () => [128, 128, 130]));
    const reading = parseReading(
      validReading({ motion: { ...validReading().motion, amplitude: 0.7 } }),
      Math.max(1, flat.swatches.length),
    )!;

    const loud = apply(reading).tokens.motion.amplitude;
    const quiet = applyReading(synthesize(flat), reading, flat).tokens.motion.amplitude;
    expect(quiet).toBeLessThan(loud);
  });

  it('never emits an ambient loop faster than twenty seconds', () => {
    const reading = parseReading(
      validReading({ motion: { character: 'drift', tier: 'ambient', period: 400, amplitude: 0.1 } }),
      grittyAnalysis.swatches.length,
    )!;
    expect(apply(reading).tokens.motion.period).toBeGreaterThanOrEqual(20000);
  });

  it('leaves untouched anything the reading does not speak to', () => {
    const reading = parseReading(validReading(), grittyAnalysis.swatches.length)!;
    const { tokens } = apply(reading);
    expect(tokens.radius).toEqual(base.radius);
    expect(tokens.space).toEqual(base.space);
    expect(tokens.mesh).toEqual(base.mesh);
  });

  it('replaces the proxy confidence with the model’s own', () => {
    const reading = parseReading(
      validReading({ confidence: 0.33 }),
      grittyAnalysis.swatches.length,
    )!;
    expect(apply(reading).tokens.meta.confidence).toBeCloseTo(0.33, 2);
  });

  it('drops the motif entirely when presence is absent', () => {
    const reading = parseReading(
      validReading({ motif: { kind: 'grid', scale: 'coarse', presence: 'absent' } }),
      grittyAnalysis.swatches.length,
    )!;
    const { tokens } = apply(reading);
    expect(tokens.pattern.kind).toBe('none');
    expect(tokens.pattern.image).toBe('none');
  });
});

describe('classifyMotion', () => {
  it('reads coarse high-contrast grain as glitch', () => {
    expect(classifyMotion(grittyAnalysis)).toBe('glitch');
  });

  it('never invents movement for a flat frame', () => {
    const flat = analyzeImage(makeImage(64, 64, () => [130, 130, 132]));
    expect(classifyMotion(flat)).toBe('still');
  });

  it('is deterministic', () => {
    expect(classifyMotion(glassyAnalysis)).toBe(classifyMotion(glassyAnalysis));
  });
});

describe('perceptualHash', () => {
  it('is stable for identical input', () => {
    expect(perceptualHash(grittyPixels)).toBe(perceptualHash(grittyPixels));
  });

  it('produces a 64-bit hash', () => {
    expect(perceptualHash(grittyPixels)).toHaveLength(16);
  });

  it('separates structurally different images', () => {
    expect(hammingDistance(perceptualHash(gritty), perceptualHash(glassy))).toBeGreaterThan(5);
  });

  it('survives a uniform exposure shift', () => {
    // Brightening every pixel changes no ordering, so the hash must not move.
    const brighter = makeImage(96, 96, (x, y) => {
      const i = (y * 96 + x) * 4;
      return [
        Math.min(255, glassy.data[i] + 18),
        Math.min(255, glassy.data[i + 1] + 18),
        Math.min(255, glassy.data[i + 2] + 18),
      ];
    });
    expect(hammingDistance(perceptualHash(glassy), perceptualHash(brighter))).toBeLessThanOrEqual(5);
  });

  it('handles an empty buffer without throwing', () => {
    expect(perceptualHash({ data: [], width: 0, height: 0 })).toHaveLength(16);
  });
});

describe('PerceptualCache', () => {
  it('returns a hit for a near-identical hash', () => {
    const cache = new PerceptualCache<string>();
    cache.set('0000000000000000', 'value');
    expect(cache.get('0000000000000001')).toBe('value');
  });

  it('misses when the images are genuinely different', () => {
    const cache = new PerceptualCache<string>();
    cache.set('0000000000000000', 'value');
    expect(cache.get('ffffffffffffffff')).toBeUndefined();
  });

  it('evicts past capacity', () => {
    const cache = new PerceptualCache<number>(2);
    cache.set('0000000000000000', 1);
    cache.set('00000000000000ff', 2);
    cache.set('0000000000ffff00', 3);
    expect(cache.size).toBe(2);
  });
});

describe('topLabels', () => {
  it('ranks, trims and drops noise', () => {
    const scored = [
      { label: 'a', score: 0.1 },
      { label: 'b', score: 0.7 },
      { label: 'c', score: 0.001 },
      { label: 'd', score: 0.2 },
    ];
    expect(topLabels(scored, 2).map((s) => s.label)).toEqual(['b', 'd']);
    expect(topLabels(scored, 4).find((s) => s.label === 'c')).toBeUndefined();
  });
});

describe('buildUserPrompt', () => {
  const base = synthesize(grittyAnalysis);

  it('indexes every swatch so the model can only choose measured colours', () => {
    const prompt = buildUserPrompt(grittyAnalysis, null, base);
    grittyAnalysis.swatches.forEach((s, i) => {
      expect(prompt).toContain(`[${i}] ${s.hex}`);
    });
  });

  it('says so plainly when classification is unavailable', () => {
    expect(buildUserPrompt(grittyAnalysis, null, base)).toMatch(/unavailable/);
  });

  it('includes the deterministic answers so the model can disagree with them', () => {
    const prompt = buildUserPrompt(grittyAnalysis, null, base);
    expect(prompt).toContain(base.meta.geometry);
    expect(prompt).toContain(base.surface.finish);
  });
});
