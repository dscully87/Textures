# Proposal: an AI layer for Textures

**Status:** implemented. See the README for how it is configured, and
`lib/patch.ts` for the guards.
**Shape as built:** CLIP zero-shot on device → DeepSeek (`deepseek-v4-pro`) over
labels + measurements → validated token patch. The photograph never leaves the
browser, so §8 below is stronger than proposed rather than weaker.

---

## 1. What is actually wrong with the current draft

Pixels go in, statistics come out, deterministic rules turn those statistics into ~30
CSS variables. The measurements are honest and the colour work is real — that part
lands. What's missing is a layer that knows what the measurements *mean*, and a whole
output dimension the engine never touches at all.

Four concrete gaps, each traceable to a place in the code:

**No semantics.** `lib/analyze.ts` knows roughness is 0.61 and orthogonality is 0.44.
It does not know it is looking at a rusted bolt rather than a slice of sourdough. Those
two subjects can land within noise of each other on every measured axis and still imply
completely different interfaces. Every classifier downstream —
`classifyGeometry`, `classifyFinish`, `classifyVoice`, `classifyPattern` — is inferring
meaning from proxies.

**Role assignment is naive.** `buildPalette` sorts swatches by `vividness()` and takes
`ranked[0]` as primary (`lib/synthesize.ts:127`). A red inspection sticker on a grey
machine wins that sort. The photograph's *subject* and the photograph's *most saturated
region* are frequently different things, and only one of them should drive the brand
colour. There is also no notion of proportion — nothing decides that the rust orange
should be a 5% accent rather than the button fill.

**The page doesn't move.** Everything the engine produces is static except a 34-second
mesh drift and CSS transitions on the morph clock. But motion is one of the most direct
material cues there is: a wavy, specular surface *shimmers*, a granular high-contrast
one *glitches*, a soft organic one *drifts*. The engine measures specularity,
roughness, granularity, dynamic range and periodicity — every signal needed to decide
how a page should move — and then throws all of it at surface opacity and blur radius.
This is the largest unused output in the system.

**Layout structurally cannot respond.** `components/GeneratedSite.tsx` is static by
design, which is right for colour and radius — but it means the hero is always
left-aligned, features are always `md:grid-cols-3`, the image is always `aspect-[4/3]`,
and the sections are always in one order. Two captures produce the same product
recoloured.

---

## 2. The core idea

**One model call, image in, tokens out.** The model looks at the photograph and the
measurements, and returns a structured refinement of the design tokens — including a
motion character. It never sees the rendered page, never writes CSS, and never invents
a colour.

```
                  ┌──────────────────── instant, offline, unchanged ────────────────┐
  capture ──────▶ │ extractPixels → analyzeImage → synthesize → applyTokens         │──▶ painted
                  └────────────────────────────────────────────────────────────────┘
                          │                                             ▲
                          │ 512px buffer + analysis numbers             │ TokenPatch
                          ▼                                             │
                  ┌──────────────────┐    ┌──────────────────────────────┴────────┐
                  │  read the        │───▶│  validate → clamp → contrast guards   │
                  │  subject         │    │  → motion clamps  (lib/patch.ts)      │
                  └──────────────────┘    └───────────────────────────────────────┘
```

The heuristic path is untouched and paints in one frame, as it does today. The AI layer
is **additive refinement** that morphs in over `--morph` when it lands. No key, slow
network, refusal, or opt-out → the site is precisely what it is now. That constraint
protects the demo, the tests, and the offline story, and it is not negotiable.

Because the model never looks at the output, correctness has to be guaranteed
structurally rather than checked after the fact. That is what §6 is about, and it's the
main reason the schema is shaped the way it is.

---

## 3. The read

**Input:** the 512px analysis buffer as base64 JPEG, the `ImageAnalysis` numbers, and
the ranked swatch list *with indices*.

**Output:** strict JSON. Structured outputs (`output_config.format` with a JSON schema)
makes this schema-guaranteed, not parsed-and-hoped-over.

```ts
// lib/ai/schema.ts — the contract. Pure, no network, unit-testable.
const SceneReading = z.object({
  subject:  z.string(),              // "rusted hex bolt, close crop"
  material: z.enum(['metal','stone','wood','textile','glass','plastic',
                    'organic','paper','liquid','composite']),
  context:  z.enum(['industrial','natural','domestic','clinical',
                    'editorial','luxury','utilitarian','archival']),

  // Colour: the model ASSIGNS ROLES. It does not invent hexes.
  palette: z.object({
    primaryIndex: z.number().int(),          // index into analysis.swatches
    accentIndex:  z.number().int().nullable(),
    neutralIndex: z.number().int().nullable(),
    // 60/30/10 — proportion is the thing statistics can't give us
    weights: z.object({ ground: z.number(), support: z.number(), accent: z.number() }),
    rationale: z.string(),
  }),

  motion: z.object({
    character: z.enum(['still','shimmer','glitch','drift','settle','bloom','weave']),
    tier:      z.enum(['ambient','accent','signature']),
    amplitude: z.number(),                   // 0..1
    period:    z.number(),                   // ms
    trigger:   z.enum(['scroll','view','hover','none']),
    // Required when tier === 'signature'. Forces the model to argue for it.
    signatureRationale: z.string().nullable(),
  }),

  layout: z.object({
    archetype: z.enum(['editorial','technical','gallery','brutalist','soft']),
    heroAlign: z.enum(['left','center']),
    density:   z.enum(['tight','normal','airy']),
    measure:   z.enum(['narrow','normal','wide']),
    featureColumns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    imageRatio: z.enum(['1/1','4/3','3/2','16/9']),
  }),

  motif: z.object({
    kind:  z.enum(['none','stripes','grid','dots','chevron','weave','scatter']),
    scale: z.enum(['fine','medium','coarse']),
    presence: z.enum(['absent','whisper','present']),
  }),

  voice: z.enum(['technical','neutral','editorial','friendly']),
  finishOverride: z.enum(['glossy','metallic','matte','rough','soft']).nullable(),

  confidence: z.number(),
  disagreements: z.array(z.string()),  // where it overrode the heuristics, and why
});
```

Two decisions worth defending:

**Colour by index, never by hex.** The model picks *which measured swatch* plays each
role. It cannot hallucinate a colour that isn't in the photograph. This preserves the
"sampled, not guessed" property the README claims, and protects the part of the current
output that already works. The model contributes judgment about *role and proportion* —
exactly what median-cut can't provide.

**`disagreements` is a first-class output.** `ThemeInspector.tsx` exists to make the
engine legible. "Heuristics called this `sharp`; the model called it `organic` because
the subject is a weathered stone bollard" turns the AI from a black box into the most
interesting panel on the page.

---

## 4. Motion as a material property

This is the substantial new work, and it should follow the same rule as everything else
in this codebase: **motion is a token, not a component change.** The AI picks a
character and parameters, `applyTokens` writes a data attribute and four variables, and
CSS does the rest. Nothing re-renders.

### The vocabulary

Seven characters, each grounded in signals `analyze.ts` already computes:

| Character | Measured signal | What it does |
|---|---|---|
| `shimmer` | high `specularity`, low `roughness`, high `orientationEntropy` | A specular highlight travels across panel surfaces as they scroll — wavy, liquid, silk, polished metal |
| `glitch` | high `roughness` + high `granularity` + high `dynamicRange` | Brief chromatic split and scanline displacement on entry. One-shot, never looping |
| `drift` | high `orientationEntropy`, low `edges.density` | Slow parallax float on background layers — clouds, foliage, fabric |
| `settle` | high `orthogonality`, low `orientationEntropy` | Precise snap into place on entry. No bounce, no overshoot — machined subjects |
| `bloom` | high `specularity` + high `brightness` | Soft light expansion, glow ramp on entry — backlit, glass, chrome |
| `weave` | high `periodicity.strength` | The motif offset slides along its own angle |
| `still` | low confidence, low density | Nothing moves. The honest default |

`still` is load-bearing. Without an explicit do-nothing option the model will always
pick *something*, and a page that fidgets for no reason is worse than a static one.

### Restraint is structural, not advisory

Three tiers, and the tier is what keeps this subtle:

- **`ambient`** — always-on, scroll-linked, tiny. Looping is permitted *only* here, and
  only with period ≥ 20s and amplitude ≤ 0.15. This is where the existing `mesh-drift`
  already lives.
- **`accent`** — fires once when an element enters the viewport. This is the default
  tier and where most captures should land.
- **`signature`** — the epic one. Larger amplitude, allowed to be the thing you
  remember about the page.

`signature` is gated three ways, because a model given a "go big" option will take it
every time:

1. `signatureRationale` is a required field — the model has to argue for it in writing.
2. `lib/patch.ts` hard-caps the page at **one** signature element. Beyond that,
   everything downgrades to `accent`.
3. Signature is downgraded automatically when `confidence < 0.7` or when measured
   `dynamicRange` is low — a flat, quiet photograph cannot produce a hyperactive page,
   regardless of what the model asks for.

### Mechanism: scroll-driven CSS, no JS

Native scroll-driven animations are the right tool. They run off the main thread, need
no scroll listeners or `IntersectionObserver`, and slot into the existing architecture
without a single new React render.

```css
/* Interpolating a custom property requires registering it. */
@property --sheen-x {
  syntax: '<percentage>';
  inherits: false;
  initial-value: -30%;
}

@keyframes shimmer { from { --sheen-x: -30%; } to { --sheen-x: 130%; } }

@supports (animation-timeline: view()) {
  :root[data-motion='shimmer'] .panel {
    animation: shimmer var(--motion-period) var(--motion-ease) both;
    animation-timeline: view();
    animation-range: entry 20% cover 80%;
  }
}
```

`applyTokens` gains:

```ts
root.dataset.motion     = motion.character;
root.dataset.motionTier = motion.tier;
set('--motion-amplitude', motion.amplitude);
set('--motion-period',    `${motion.period}ms`);
set('--motion-ease',      motion.easing);
```

Notes:

- `animation-timeline` ships in Chrome, Edge and Safari; Firefox is behind a flag. The
  `@supports` wrapper means unsupported browsers get a still page — correct
  progressive enhancement, zero fallback code.
- `prefers-reduced-motion` is already honored globally at `app/globals.css:112`, and
  that rule kills these too. Worth verifying with a test rather than assuming.
- Amplitude is the single scalar every keyframe reads, so one clamp in `patch.ts`
  bounds the intensity of all seven characters at once.

### It works without the AI too

`classifyMotion(analysis)` goes in `synthesize.ts` alongside `classifyFinish`, using the
signal table above as thresholds. The heuristic engine picks a motion character offline,
deterministically, today. The AI *refines* that choice rather than being the only thing
that can make it — same relationship it has to finish and geometry.

---

## 5. Layout as a token

Same pattern, and it fixes a limitation that has nothing to do with AI. Keep the
zero-re-render promise; extend `applyTokens` with an archetype and a few continuous
variables:

```ts
root.dataset.layout = layout.archetype;   // editorial | technical | gallery | ...
root.dataset.align  = layout.heroAlign;
set('--measure',      MEASURE[layout.measure]);   // 58ch | 68ch | 78ch
set('--feature-cols', layout.featureColumns);
set('--image-ratio',  layout.imageRatio);
```

CSS branches on it the way `data-finish` already does at `app/globals.css:338`:

```css
:root[data-layout='editorial'] .features { grid-template-columns: 1fr; }
:root[data-layout='gallery']   .features {
  grid-template-columns: repeat(var(--feature-cols), 1fr);
}
:root[data-align='center'] .hero { align-items: center; text-align: center; }
```

Section order via `order` on flex children, so even the page's sequence can respond
without touching JSX. Five archetypes is enough to make two captures feel like two
products; the cost is one data attribute and five variables.

Optional and cheap: **copy register**. `FEATURES` and `STATS` in `GeneratedSite.tsx` are
hardcoded strings about the engine itself. Let the model fill a fixed slot skeleton
(headline, lede, three feature titles) in the subject's register, with a hard rule that
it may not invent factual claims.

---

## 6. Guardrails

With no critic pass, every check is deterministic and lives in `lib/patch.ts`. That's a
better place for them anyway — it's testable, offline, and can't itself be wrong in a
novel way.

| Rule | Enforced by |
|---|---|
| Never emits CSS, class names or markup | Schema has no free-text style field |
| Never invents a colour | Palette is swatch **indices**, resolved locally |
| Cannot break contrast | Patch runs through existing `ensureContrast` / `makeLabelable` |
| Cannot leave sane ranges | Every numeric clamped before use |
| At most one `signature` element | Counter in `patch.ts`; excess downgrades to `accent` |
| Loops only when slow and small | `ambient` tier only, period ≥ 20s, amplitude ≤ 0.15 |
| Motion can't exceed the photo's energy | Amplitude ceiling scales with measured `dynamicRange` |
| Respects reduced motion | Existing global rule, plus a regression test |
| Cannot block the page | Heuristic theme paints first; patch applied or discarded |
| Reproducible | Reading cached by perceptual hash of the source buffer |

`lib/` stays dependency-free and pure. `lib/patch.ts` is testable with fixture JSON and
no network, so the existing 38-test suite grows rather than being compromised. Only
`lib/ai/client.ts` touches the wire.

One risk worth naming: models have persistent default aesthetics and will drift toward a
house style given any opening. The swatch-index constraint blocks that on colour; the
tier gating blocks it on motion; on layout the archetype is an enum of five.

---

## 7. Cost, latency, caching

One call per capture. Opus 5 at $5/$25 per MTok:

| | input | output | ≈ cost |
|---|---|---|---|
| The read (photo + numbers) | ~3k tok | ~700 tok | **~$0.033** |

An estimate — image token counts vary with resolution and should be re-baselined with
`messages.count_tokens` against the real buffers before anyone quotes them.

Levers:

- **Perceptual hash cache.** dHash the 256px buffer; identical or near-identical
  captures reuse the stored reading. Repeat captures cost nothing, and it restores
  determinism — the same photo reliably produces the same site, which the current engine
  guarantees by construction and which I'd rather not lose.
- **Prompt caching.** The system prompt and signal table are stable; `cache_control:
  {type:'ephemeral'}` on them. Opus 5's minimum cacheable prefix is 512 tokens, which
  that comfortably exceeds.
- **Effort.** Worth an `output_config: { effort }` sweep — `medium` may well be enough
  for a single structured read, and it's the main latency lever. Leave thinking on;
  disabling it on Opus 5 has known failure modes and low effort captures most of the
  saving anyway.

Latency: heuristic theme at ~0ms (unchanged), refinement landing at 2–4s as a `--morph`
transition. Worth surfacing on `CaptureStatus` as "reading…" → "settled" so the
progression reads as craft rather than lag.

---

## 8. Privacy

The current engine never sends a photograph anywhere. Losing that silently would be
wrong.

- Explicit opt-in, off by default, with a plain sentence about what leaves the device.
- Send the **512px analysis buffer**, never the 900px preview in `ThemeEngine.toPreview`.
- No storage beyond the in-memory phash cache; nothing persisted server-side.
- The client-only path stays fully functional and is never framed as degraded.

---

## 9. What I would measure

"Vastly improve" is unfalsifiable without a number.

1. **30-photo fixture set** covering the hard cases: near-monochrome, blown-out,
   subject-vs-background colour conflict, strong distractor colour, heavy motif, night
   shots, and — for motion specifically — wavy/specular, granular/harsh, and flat/quiet.
2. **Blind pairwise A/B** — heuristic-only vs AI-refined, same photo, order shuffled,
   scored on "which page looks more like this object". Target: AI wins ≥70%.
3. **Motion appropriateness**, scored separately. It's the axis most likely to be
   actively annoying when wrong, and a page can win on colour while losing on motion.
4. **Automated regression** — every AI output still clears the contrast floors and the
   motion clamps, on all 30. Any failure is a bug in `lib/patch.ts`, not a model problem.

Without (2) and (3) this is engineering theatre. It's also the cheapest part of the work.

---

## 10. Phasing

| Phase | Work | Ships |
|---|---|---|
| 1 | `classifyMotion()` in `synthesize.ts`, motion tokens, scroll-driven CSS | Motion working offline, deterministically, no AI at all |
| 2 | `lib/ai/schema.ts`, `lib/patch.ts`, fixture tests | Patch application with no network; proves the guards hold |
| 3 | `lib/ai/client.ts`, the read, phash cache, opt-in toggle | Semantic palette roles, motion, finish and voice refinement |
| 4 | Layout archetypes in `applyTokens` + `globals.css` | Two captures finally look like two products |
| 5 | Copy register, inspector `disagreements` panel | The demo lands |

Phase 1 first, deliberately. Motion is the biggest visible change in this proposal and
it doesn't need the model to exist — building it heuristically first means the mechanism
is proven and tested before the AI is allowed near it, and if the AI layer never ships
the engine is still meaningfully better.

---

## 11. Open questions

- **Signature threshold.** How often is "epic" the right answer — 1 in 10 captures, or 1
  in 50? That number sets the confidence gate, and I'd rather tune it from the fixture
  set than guess.
- **Layout archetype count.** Five is a guess. Fewer and captures still feel same-y;
  more and each one gets less polish.
- **Firefox.** Scroll-driven animation is flagged there, so Firefox gets a still page.
  Acceptable as progressive enhancement, or worth a small `IntersectionObserver`
  fallback for the `accent` tier only?
