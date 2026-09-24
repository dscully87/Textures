/**
 * The mood vector: five axes every design decision reads from.
 *
 * The first version of the engine decided type from edge geometry, layout from
 * edge geometry, and motion from a separate score — so on real photographs,
 * where edges run at every angle, nearly everything landed on the same font,
 * the same layout and the same movement. A lake and a graffiti wall came out as
 * one product in two paints.
 *
 * Collapsing the measurements into a handful of perceptual axes fixes that in
 * two ways. Every choice (type, layout, colour strategy, motion) reads the same
 * five numbers, so choices stay coherent with each other; and the axes are
 * calibrated against real photographs (`fixtures/photos`), so photographs
 * actually spread across them instead of piling up at one end.
 *
 * Pure and dependency-free.
 */

import { ImageAnalysis } from './analyze';

export interface Mood {
  /** Calm (0) ↔ loud (1): busyness, colour, contrast, lack of empty space. */
  energy: number;
  /** Cool (0) ↔ warm (1), weighted by how much of the frame is coloured at all. */
  warmth: number;
  /** Organic (0) ↔ structured (1): straight lines, few angles, repeats, bands. */
  order: number;
  /** Airy (0) ↔ packed (1): how much of the frame is detail rather than space. */
  density: number;
  /** Raw (0) ↔ refined (1): smooth, quiet surfaces versus coarse, noisy ones. */
  polish: number;
}

export const MOOD_AXES: (keyof Mood)[] = ['energy', 'warmth', 'order', 'density', 'polish'];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Map a raw score onto 0..1 using the range real photographs actually occupy.
 * `lo`/`hi` are roughly the 5th and 95th percentiles over the calibration set;
 * without this the raw blends sit in a narrow band in the middle and every
 * photograph reads as "moderate".
 */
const stretch = (raw: number, lo: number, hi: number) => clamp01((raw - lo) / (hi - lo));

/** How visually busy the frame is: mean gradient, calibrated on photographs. */
export function busyness(analysis: ImageAnalysis): number {
  // `edges.strength` is mean Sobel magnitude / 0.6 — see analyzeEdges.
  return clamp01((analysis.edges.strength * 0.6 - 0.12) / 0.5);
}

export function computeMood(analysis: ImageAnalysis): Mood {
  const { edges, texture, colour, composition, periodicity } = analysis;
  const busy = busyness(analysis);
  const grain = clamp01((texture.granularity - 0.15) / 0.4);

  const energy =
    0.3 * busy +
    0.25 * clamp01(analysis.colorfulness / 0.6) +
    0.15 * texture.dynamicRange +
    0.15 * (1 - composition.calm) +
    0.15 * colour.saturation;

  // Uniform orientation puts 4 of 12 bins — a third of the energy — on the
  // axes, so orthogonality only means something above that baseline.
  const order =
    0.35 * clamp01((edges.orthogonality - 1 / 3) / 0.35) +
    0.35 * clamp01((1 - edges.orientationEntropy) / 0.15) +
    0.15 * periodicity.strength +
    0.15 * composition.banding;

  const density = 0.5 * busy + 0.3 * (1 - composition.calm) + 0.2 * grain;

  const polish =
    0.45 * (1 - texture.roughness) + 0.3 * composition.calm + 0.25 * (1 - grain);

  return {
    energy: round(stretch(energy, 0.3, 0.85)),
    warmth: round(clamp01(0.5 + (colour.warmth - 0.5) * 1.2)),
    order: round(stretch(order, 0.08, 0.7)),
    density: round(stretch(density, 0.12, 0.97)),
    polish: round(stretch(polish, 0.03, 0.85)),
  };
}

const round = (v: number) => Number(v.toFixed(3));

/** A point in mood space that a design option is best suited to. */
export type MoodTarget = Partial<Mood>;

/**
 * Weighted distance between a mood and a target. Axes a target leaves out
 * don't count — a font that works warm or cool shouldn't be penalised on
 * warmth.
 */
export function moodDistance(mood: Mood, target: MoodTarget, weights: Partial<Mood> = {}): number {
  let sum = 0;
  let norm = 0;
  for (const axis of MOOD_AXES) {
    const t = target[axis];
    if (t === undefined) continue;
    const w = weights[axis] ?? 1;
    sum += w * (mood[axis] - t) ** 2;
    norm += w;
  }
  return norm ? Math.sqrt(sum / norm) : 0;
}

/**
 * The option whose target sits closest to the mood. Ties break toward the
 * earlier option, so ordering a list is how you express a default.
 */
export function nearest<T extends { mood: MoodTarget }>(
  mood: Mood,
  options: readonly T[],
  weights?: Partial<Mood>,
): T {
  let best = options[0];
  let bestDistance = Infinity;
  for (const option of options) {
    const d = moodDistance(mood, option.mood, weights);
    if (d < bestDistance - 1e-9) {
      best = option;
      bestDistance = d;
    }
  }
  return best;
}

/** The resting mood — dead centre — used before any capture. */
export const NEUTRAL_MOOD: Mood = { energy: 0.5, warmth: 0.5, order: 0.5, density: 0.5, polish: 0.5 };
