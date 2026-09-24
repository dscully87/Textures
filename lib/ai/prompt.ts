/**
 * Building the reasoning request.
 *
 * The model never sees the photograph — it sees what CLIP made of it and what
 * the pixel analysis measured. Those two views disagree usefully: a confident
 * `metal` label next to low specularity and high roughness is corroded metal,
 * and neither layer can conclude that alone.
 *
 * Split into a stable system half and a volatile data half so the provider's
 * context cache has a fixed prefix to hit. Pure — no network, no model.
 */

import { ImageAnalysis } from '../analyze';
import { Classification } from '../vision/labels';
import { DesignTokens } from '../tokens';

/**
 * Stable across every request. Nothing per-capture may appear here, or the
 * cached prefix is invalidated on each call and the caching is worthless.
 */
export const SYSTEM_PROMPT = `You are the interpretation layer of a design engine that turns a photographed object into a website. A deterministic pipeline has already measured the photograph and produced a working theme. Your job is to improve that theme's judgment, not to replace its measurements.

You receive:
- Zero-shot image classification labels with confidences (material, context, surface descriptors).
- Pixel measurements: edge statistics, texture statistics, periodicity, brightness.
- The measured colour swatches, each with an index, hex, coverage and HSL.
- The theme the deterministic engine produced on its own.

Return a single JSON object and nothing else.

RULES

1. Colour is chosen by INDEX, never by hex. You assign roles to colours that were
   measured in the photograph; you never introduce one that was not. The most
   saturated swatch is frequently a distractor — a sticker, a reflection, a
   label — rather than the subject's own colour. Choose the colour that carries
   the subject's identity.
2. Weights are proportion, not preference: roughly how much of the interface each
   role should occupy. A colour can be important and still be rare.
3. Motion is a material property. Choose the character the SURFACE implies:
   - shimmer  — smooth, curved, light-catching (glass, liquid, silk, polish)
   - glitch   — coarse, granular, high-contrast (rust, concrete, static, decay)
   - drift    — soft, organic, uncrowded (cloud, foliage, fabric)
   - settle   — machined, axis-aligned, precise (tools, architecture, hardware)
   - bloom    — bright and specular (backlit, chrome, frost)
   - weave    — something genuinely repeats at a regular pitch
   - still    — nothing about this subject implies movement
   'still' is a real answer and often the correct one. A page that moves for no
   reason is worse than one that holds still. Prefer it when unsure.
4. Tier is scope, not intensity:
   - ambient   — page-scale, never noticed, the only tier that may loop, period 20000ms+
   - accent    — fires once as an element enters view. THIS IS THE DEFAULT.
   - signature — section-scale and memorable. Requires signatureRationale, and is
     refused downstream unless confidence is high and the photograph itself has
     real dynamic range. Reserve it for a subject that genuinely warrants being
     the thing someone remembers. Most captures are not that subject.
5. Disagree with the deterministic engine when the labels and measurements
   together justify it, and say why in 'disagreements'. Silent agreement is
   fine; silent disagreement is not.
6. 'confidence' is your own, and it is used to gate decisions. Report it
   honestly — an inflated one buys a louder page you cannot support.`;

/** The JSON shape, described for a model without schema enforcement. */
export const SCHEMA_HINT = `{
  "subject": "short plain description, e.g. 'rusted hex bolt, close crop'",
  "material": "metal|stone|wood|textile|glass|plastic|organic|paper|liquid|composite",
  "context": "industrial|natural|domestic|clinical|editorial|luxury|utilitarian|archival",
  "palette": {
    "primaryIndex": 0,
    "accentIndex": 1,
    "neutralIndex": 2,
    "weights": { "ground": 0.6, "support": 0.3, "accent": 0.1 },
    "rationale": "one sentence on why this colour leads"
  },
  "motion": {
    "character": "still|shimmer|glitch|drift|settle|bloom|weave",
    "tier": "ambient|accent|signature",
    "amplitude": 0.45,
    "period": 800,
    "trigger": "none|scroll|view",
    "signatureRationale": null
  },
  "layout": {
    "archetype": "editorial|technical|gallery|brutalist|soft",
    "heroAlign": "left|center",
    "density": "tight|normal|airy",
    "measure": "narrow|normal|wide",
    "featureColumns": 3,
    "imageRatio": "1/1|4/3|3/2|16/9"
  },
  "motif": {
    "kind": "none|stripes|grid|dots|chevron|weave|scatter",
    "scale": "fine|medium|coarse",
    "presence": "absent|whisper|present"
  },
  "voice": "technical|neutral|editorial|friendly",
  "finishOverride": null,
  "confidence": 0.0,
  "disagreements": ["short statements of where you overrode the engine, and why"]
}`;

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The per-capture half. Everything here changes every request. */
export function buildUserPrompt(
  analysis: ImageAnalysis,
  classification: Classification | null,
  heuristic: DesignTokens,
): string {
  const { edges, texture, periodicity } = analysis;

  const labels = classification
    ? [
        `material:    ${classification.material.map((l) => `${l.label} ${pct(l.score)}`).join(', ') || 'none'}`,
        `context:     ${classification.context.map((l) => `${l.label} ${pct(l.score)}`).join(', ') || 'none'}`,
        `descriptors: ${classification.descriptors.map((l) => `${l.label} ${pct(l.score)}`).join(', ') || 'none'}`,
      ].join('\n')
    : 'unavailable — the vision layer did not run. Reason from the measurements alone, and lower your confidence accordingly.';

  const swatches = analysis.swatches
    .map(
      (s, i) =>
        `  [${i}] ${s.hex}  coverage ${pct(s.population)}  hue ${Math.round(s.hue)}°  sat ${pct(s.saturation)}  light ${pct(s.lightness)}`,
    )
    .join('\n');

  return `CLASSIFICATION
${labels}

MEASUREMENTS
  edge density         ${edges.density.toFixed(3)}   (fraction of pixels on a strong edge)
  edge strength        ${edges.strength.toFixed(3)}
  orthogonality        ${edges.orthogonality.toFixed(3)}   (share of edge energy on the H/V axes; high = machined)
  orientation entropy  ${edges.orientationEntropy.toFixed(3)}   (high = curved/organic, low = few distinct angles)
  dominant angle       ${Math.round(edges.dominantAngle)}°
  roughness            ${texture.roughness.toFixed(3)}   (high-frequency energy)
  granularity          ${texture.granularity.toFixed(3)}   (local variance)
  specularity          ${texture.specularity.toFixed(3)}   (small bright desaturated highlights)
  dynamic range        ${texture.dynamicRange.toFixed(3)}
  brightness           ${texture.brightness.toFixed(3)}
  colourfulness        ${analysis.colorfulness.toFixed(3)}
  repeat strength      ${periodicity.strength.toFixed(3)}   at pitch ${Math.round(periodicity.period)}px, angle ${Math.round(periodicity.angle)}°

SWATCHES (choose by index)
${swatches}

THE DETERMINISTIC ENGINE PRODUCED
  primary ${heuristic.palette.primary}, accent ${heuristic.palette.accent}
  geometry ${heuristic.meta.geometry}, finish ${heuristic.surface.finish}, type ${heuristic.typography.label}
  motif ${heuristic.pattern.kind}, motion ${heuristic.motion.character} (${heuristic.motion.tier})
  layout ${heuristic.layout.archetype}
  scheme ${heuristic.meta.sourceIsDark ? 'dark' : 'light'}

Return JSON matching exactly this shape:
${SCHEMA_HINT}`;
}
