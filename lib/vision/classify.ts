'use client';

/**
 * Zero-shot image classification, in the browser.
 *
 * CLIP runs client-side via WebGPU (falling back to WASM), which is what keeps
 * the photograph on the device: the reasoning layer downstream receives labels
 * and numbers, never pixels. That preserves the engine's original property —
 * nothing leaves the machine — even with the AI layer switched on.
 *
 * Everything here is optional. The model is fetched on first use, never at page
 * load, and any failure resolves to `null` rather than throwing: a blocked CDN,
 * a browser without WASM, or a user who navigates away mid-download all degrade
 * to the deterministic engine, which is a complete product on its own.
 */

import {
  CONTEXTS,
  CONTEXT_PROMPT,
  Classification,
  ContextLabel,
  DESCRIPTORS,
  DESCRIPTOR_PROMPT,
  DescriptorLabel,
  MATERIALS,
  MATERIAL_PROMPT,
  MaterialLabel,
  ScoredLabel,
  topLabels,
} from './labels';

/**
 * Base CLIP, int8-quantized. Roughly an order of magnitude smaller than the
 * fp32 weights at a small accuracy cost, which is the right trade for a model
 * whose entire job is ranking eighteen labels.
 */
const MODEL_ID = 'Xenova/clip-vit-base-patch32';

type Classifier = (
  image: string,
  labels: string[],
) => Promise<{ label: string; score: number }[]>;

let classifierPromise: Promise<Classifier | null> | null = null;

/**
 * Load once per session, and cache the *promise* rather than the result so
 * concurrent captures during a slow download share one fetch instead of racing
 * to start several.
 */
function loadClassifier(): Promise<Classifier | null> {
  if (classifierPromise) return classifierPromise;

  classifierPromise = (async () => {
    try {
      // Imported dynamically so the model runtime never enters the initial
      // bundle — the engine must stay instant for anyone who never opts in.
      const { pipeline } = await import('@huggingface/transformers');

      const pipe = await pipeline('zero-shot-image-classification', MODEL_ID, {
        dtype: 'q8',
        // WebGPU where available; the library falls back to WASM on its own.
        device: typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm',
      });

      return (image, labels) =>
        pipe(image, labels) as Promise<{ label: string; score: number }[]>;
    } catch (err) {
      console.warn('[textures] CLIP unavailable, continuing without it:', err);
      return null;
    }
  })();

  return classifierPromise;
}

/** Score one axis and map the caption-shaped prompts back to bare labels. */
async function scoreAxis<T extends string>(
  classify: Classifier,
  image: string,
  labels: readonly T[],
  toPrompt: (label: string) => string,
): Promise<ScoredLabel<T>[]> {
  const prompts = labels.map(toPrompt);
  const results = await classify(image, prompts);

  const byPrompt = new Map(results.map((r) => [r.label, r.score]));
  return labels.map((label) => ({ label, score: byPrompt.get(toPrompt(label)) ?? 0 }));
}

/**
 * Classify a capture.
 *
 * `image` is a data URL — the same downscaled buffer the analysis pipeline
 * works from, not the full-resolution frame.
 *
 * Returns `null` on any failure. Callers must treat that as normal.
 */
export async function classifyCapture(image: string): Promise<Classification | null> {
  const started = typeof performance !== 'undefined' ? performance.now() : 0;

  const classify = await loadClassifier();
  if (!classify) return null;

  try {
    // Sequential rather than parallel: these share one model instance, and
    // three concurrent calls into the same session contend rather than overlap.
    const material = await scoreAxis<MaterialLabel>(classify, image, MATERIALS, MATERIAL_PROMPT);
    const context = await scoreAxis<ContextLabel>(classify, image, CONTEXTS, CONTEXT_PROMPT);
    const descriptors = await scoreAxis<DescriptorLabel>(
      classify,
      image,
      DESCRIPTORS,
      DESCRIPTOR_PROMPT,
    );

    return {
      material: topLabels(material, 3),
      context: topLabels(context, 3),
      descriptors: topLabels(descriptors, 4),
      source: MODEL_ID,
      elapsedMs: Math.round(
        (typeof performance !== 'undefined' ? performance.now() : 0) - started,
      ),
    };
  } catch (err) {
    console.warn('[textures] classification failed, continuing without it:', err);
    return null;
  }
}

/**
 * Begin the download without blocking anything, for callers that know a capture
 * is imminent — mounting the camera, say. Safe to call repeatedly.
 */
export function warmClassifier(): void {
  void loadClassifier();
}
