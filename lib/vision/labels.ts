/**
 * The label sets CLIP scores against.
 *
 * This is a classification problem, not a captioning one. `SceneReading` wants
 * `material` and `context` from closed sets, so asking a model to write prose
 * and then parsing it back out would add a lossy step for nothing — zero-shot
 * scoring returns exactly the fields the schema needs, with confidences
 * attached, and confidences are what let the reasoning layer disagree.
 *
 * Pure data. No browser, no model, no network — so the vocabulary can be tested
 * and tuned without loading anything.
 */

export type MaterialLabel =
  | 'metal'
  | 'stone'
  | 'wood'
  | 'textile'
  | 'glass'
  | 'plastic'
  | 'organic'
  | 'paper'
  | 'liquid'
  | 'composite';

export type ContextLabel =
  | 'industrial'
  | 'natural'
  | 'domestic'
  | 'clinical'
  | 'editorial'
  | 'luxury'
  | 'utilitarian'
  | 'archival';

export const MATERIALS: MaterialLabel[] = [
  'metal',
  'stone',
  'wood',
  'textile',
  'glass',
  'plastic',
  'organic',
  'paper',
  'liquid',
  'composite',
];

export const CONTEXTS: ContextLabel[] = [
  'industrial',
  'natural',
  'domestic',
  'clinical',
  'editorial',
  'luxury',
  'utilitarian',
  'archival',
];

/**
 * Surface adjectives. These carry the information the enums can't: "metal" is
 * ambiguous between chrome and rust, and the difference decides both the finish
 * and how the page should move.
 */
export const DESCRIPTORS = [
  'corroded',
  'pitted',
  'polished',
  'brushed',
  'woven',
  'knitted',
  'cracked',
  'smooth',
  'grainy',
  'fibrous',
  'translucent',
  'weathered',
  'veined',
  'layered',
  'frosted',
] as const;

export type DescriptorLabel = (typeof DESCRIPTORS)[number];

/**
 * CLIP was trained on caption-like text, so a bare noun scores markedly worse
 * than the same noun in a sentence. Each set gets a template that matches how
 * its labels would plausibly appear in a caption.
 */
export const MATERIAL_PROMPT = (label: string) => `a close-up photograph of ${label}`;
export const CONTEXT_PROMPT = (label: string) => `a photograph taken in a ${label} setting`;
export const DESCRIPTOR_PROMPT = (label: string) => `a close-up photograph of a ${label} surface`;

/** One scored label. */
export interface ScoredLabel<T extends string = string> {
  label: T;
  score: number;
}

/**
 * What the vision layer hands to the reasoning layer. Deliberately a ranked list
 * per axis rather than a single winner: a confident `metal` sitting next to low
 * specularity and high roughness means corroded metal, and that inference is
 * only available to something that can see both the label *and* its confidence.
 */
export interface Classification {
  material: ScoredLabel<MaterialLabel>[];
  context: ScoredLabel<ContextLabel>[];
  descriptors: ScoredLabel<DescriptorLabel>[];
  /** Model id that produced this, for the inspector. */
  source: string;
  elapsedMs: number;
}

/** Trim a scored list to the entries worth sending. */
export function topLabels<T extends string>(
  scored: ScoredLabel<T>[],
  limit = 3,
  floor = 0.03,
): ScoredLabel<T>[] {
  return scored
    .filter((s) => s.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ label: s.label, score: Number(s.score.toFixed(3)) }));
}
