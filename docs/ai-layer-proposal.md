# Proposal: an AI layer for Textures

**Status:** proposal, nothing implemented yet.
**Target model:** `claude-opus-5` (vision + structured outputs), with `claude-sonnet-5` on the cheap passes.

---

## 1. What is actually wrong with the current draft

The engine is open-loop. Pixels go in, statistics come out, deterministic rules turn
those statistics into ~30 CSS variables, and **nothing ever looks at the result**. The
pipeline has no idea whether the page it produced resembles the thing you pointed the
camera at. That is the whole gap, and it explains the symptom in the brief: colour
lands, everything else is approximate.

Four concrete consequences, each traceable to a specific place in the code:

**No semantics.** `lib/analyze.ts` knows roughness is 0.61 and orthogonality is 0.44.
It does not know it is looking at a rusted bolt rather than a slice of sourdough. Those
two subjects can land within noise of each other on every measured axis and still imply
completely different interfaces. Every classifier downstream —
`classifyGeometry`, `classifyFinish`, `classifyVoice`, `classifyPattern` — is guessing
at meaning from proxies.

**Role assignment is naive.** `buildPalette` sorts swatches by `vividness()` and takes
`ranked[0]` as primary (`lib/synthesize.ts:127`). A red inspection sticker on a grey
machine wins that sort. The photograph's *subject* and the photograph's *most saturated
region* are frequently different things, and only one of them should drive the brand
colour. There is also no notion of proportion — nothing decides that the rust orange
should be a 5% accent rather than the button fill.

**Layout cannot respond at all.** `components/GeneratedSite.tsx` is deliberately static,
which is the right call for colour and radius — but it means the hero is always
left-aligned, the stats are always three cards, the features are always
`md:grid-cols-3`, the image is always `aspect-[4/3]`, and the sections are always in the
same order. Two captures produce the same product recoloured. The brief says the *web
layout* should match; today it structurally cannot.

**Confidence is a fudge.** `lib/synthesize.ts:557` computes confidence from edge density
and colourfulness — a proxy for "was there stuff in the frame", not for "did we
understand it". The inspector reports a number that means very little.

---

## 2. The core idea

Add a model that (a) **reads the photograph semantically** and (b) **looks at the
rendered page and compares it back to the photograph**. Everything else in this
proposal follows from those two moves.

The second one is the important one and the one nobody builds. A render-and-critique
loop is the difference between "the engine emitted plausible tokens" and "the page
looks like the object".

```
                  ┌──────────────────────── instant, offline, unchanged ─────────────┐
  capture ──────▶ │ extractPixels → analyzeImage → synthesize → applyTokens          │──▶ painted
                  └──────────────────────────────────────────────────────────────────┘
                          │                                            ▲
                          │ analysis numbers + 512px buffer            │ TokenPatch
                          ▼                                            │
                  ┌─────────────────┐    ┌──────────────┐    ┌─────────┴─────────┐
                  │ PASS 1  read    │───▶│  validate +  │───▶│  PASS 2  critique │
                  │ the subject     │    │  clamp +     │    │  render vs source │
                  └─────────────────┘    │  contrast    │    └───────────────────┘
                                         │  guards      │              ▲  │
                                         └──────────────┘              └──┘
                                                                     ≤2 rounds
```

The heuristic path stays exactly as it is and paints in one frame, as it does today.
The AI layer is strictly **additive refinement** that morphs in over `--morph` when it
lands. If the network is slow, the key is missing, the model refuses, or the user opted
out, the site is precisely what it is now. That constraint is non-negotiable — it
protects the demo, the tests, and the offline story.

---

## 3. Pass 1 — read the subject

**Input:** the 512px analysis buffer as a base64 JPEG, plus the `ImageAnalysis` numbers
already computed, plus the ranked swatch list *with indices*.

**Output:** a strict JSON `SceneReading`. Structured outputs (`output_config.format`
with a JSON schema) means this is schema-guaranteed, not parsed-and-prayed-over.

```ts
// lib/ai/schema.ts — the contract. Pure, no network, unit-testable.
const SceneReading = z.object({
  subject:  z.string(),              // "rusted hex bolt, close crop"
  material: z.enum(['metal','stone','wood','textile','glass','plastic',
                    'organic','paper','liquid','composite']),
  context:  z.enum(['industrial','natural','domestic','clinical',
                    'editorial','luxury','utilitarian','archival']),

  // Colour: the model ASSIGNS ROLES, it does not invent hexes.
  palette: z.object({
    primaryIndex:   z.number().int(),   // index into analysis.swatches
    accentIndex:    z.number().int().nullable(),
    neutralIndex:   z.number().int().nullable(),
    // 60/30/10 — proportion is the thing statistics can't give us
    weights: z.object({ ground: z.number(), support: z.number(), accent: z.number() }),
    rationale: z.string(),
  }),

  layout: z.object({
    archetype: z.enum(['editorial','technical','gallery','brutalist','soft']),
    heroAlign: z.enum(['left','center']),
    density:   z.enum(['tight','normal','airy']),
    measure:   z.enum(['narrow','normal','wide']),   // body copy line length
    featureColumns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    imageRatio: z.enum(['1/1','4/3','3/2','16/9']),
  }),

  motif: z.object({
    kind: z.enum(['none','stripes','grid','dots','chevron','weave','scatter']),
    scale: z.enum(['fine','medium','coarse']),
    presence: z.enum(['absent','whisper','present']),
  }),

  voice: z.enum(['technical','neutral','editorial','friendly']),
  finishOverride: z.enum(['glossy','metallic','matte','rough','soft']).nullable(),

  confidence: z.number(),            // an honest one, for the inspector
  disagreements: z.array(z.string()), // where it overrode the heuristics, and why
});
```

Two design decisions worth defending:

**Colour by index, never by hex.** The model picks *which measured swatch* plays each
role. It cannot hallucinate a colour that is not in the photograph. This preserves the
"sampled, not guessed" property the README claims and — importantly — protects the one
part of the current output the brief says already works. The model contributes judgment
about *role and proportion*, which is exactly what median-cut cannot provide.

**`disagreements` is a first-class output.** The inspector already exists
(`components/ThemeInspector.tsx`) and its job is to make the engine legible. Showing
"heuristics called this `sharp`; the model called it `organic` because the subject is a
weathered stone bollard" turns the AI from a black box into the most interesting panel
on the page.

---

## 4. Pass 2 — the critic loop

This is the part the brief is really asking for.

1. Apply the Pass 1 patch, let the DOM settle one frame.
2. Screenshot the generated surface. Client-side: `html2canvas` over the
   `<GeneratedSite>` root. Server-side (better fidelity, needed for `backdrop-filter`
   and the grain overlay): Playwright — already available in this environment at
   `/opt/pw-browsers/chromium`.
3. Send **both images** — source photograph and rendered page — with a rubric.
4. The model scores and returns a bounded `TokenPatch`.
5. Apply, re-render, re-score. Stop at score ≥ 8/10 or after 2 rounds, whichever first.

The rubric is the product. Draft:

> You are shown a photograph and a screenshot of a web page generated from it. Score
> 1–10 on each axis and give one concrete correction per axis scoring below 8.
>
> 1. **Material agreement** — do the page's surfaces read as the same substance?
> 2. **Colour proportion** — does the page's colour distribution match the
>    photograph's, or has an incidental colour been over-promoted?
> 3. **Structural agreement** — does the page's density, rhythm and alignment echo how
>    the subject is constructed?
> 4. **Legibility** — is every piece of text comfortably readable on its background?
> 5. **Coherence** — does it look designed, or assembled from a photograph?
>
> Return only adjustments expressible in the token schema. Do not invent colours.

Two things this catches that statistics cannot, and which I would expect to show up on
the first ten test photos:

- Mesh gradients and grain stacking into mud on a dark, low-chroma capture. Every
  individual token is within range; the composite is wrong. Only looking at it finds it.
- An accent that clears 3:1 contrast (so `ensureContrast` is satisfied) but is
  perceptually invisible against the mesh behind it, because contrast was checked
  against `surface` and the mesh sits on top.

---

## 5. Layout as a token

The layout gap needs a mechanism, not just a model. The proposal keeps the current
architecture's core promise — **class names never change, nothing re-renders** — and
extends `applyTokens` to write a layout archetype plus a handful of continuous variables.

```ts
// additions to applyTokens()
root.dataset.layout = layout.archetype;      // editorial | technical | gallery | ...
root.dataset.align  = layout.heroAlign;
set('--measure',      MEASURE[layout.measure]);       // 58ch | 68ch | 78ch
set('--feature-cols', layout.featureColumns);
set('--image-ratio',  layout.imageRatio);
set('--section-gap',  ...);
```

CSS does the rest, the same way `data-finish` already drives material overrides at
`app/globals.css:338`:

```css
:root[data-layout='editorial'] .features { grid-template-columns: 1fr; }
:root[data-layout='editorial'] .hero     { --hero-order: 2; }
:root[data-layout='gallery']   .features { grid-template-columns:
                                             repeat(var(--feature-cols), 1fr); }
:root[data-align='center']     .hero     { align-items: center; text-align: center; }
```

Section order via `order` on flex children, so even the page's sequence can respond
without touching the JSX. Five archetypes is enough to make two captures feel like two
products, and it costs one data attribute plus six variables — it does not compromise
the zero-re-render architecture at all.

Optional second layer, cheap and high-impact: **copy register**. `FEATURES` and `STATS`
in `GeneratedSite.tsx` are hardcoded strings about the engine itself. Let the model fill
a fixed slot skeleton (headline, lede, three feature titles) in the subject's register,
with a hard rule that it may not invent factual claims. A page about a rusted bolt that
also *reads* industrial is a step change in how the demo lands.

---

## 6. Guardrails — what the AI is not allowed to do

This is what keeps the AI layer from being a downgrade.

| Rule | Enforced by |
|---|---|
| Never emits CSS, class names or markup | Schema has no free-text style field |
| Never invents a colour | Palette is swatch **indices**, resolved locally |
| Cannot break contrast | Patch runs through existing `ensureContrast` / `makeLabelable` |
| Cannot leave sane ranges | Every numeric is clamped in `lib/patch.ts` before use |
| Cannot block the page | Heuristic theme paints first; patch is applied or discarded |
| Cannot make the site unreproducible | Reading cached by perceptual hash of the source buffer |

`lib/` stays dependency-free and pure. The new `lib/patch.ts` — validate, clamp, apply,
re-run guards — is testable with fixture JSON and no network, so the existing 38-test
suite grows rather than being compromised. Only `lib/ai/client.ts` touches the wire.

One risk deserves its own line: models have persistent default aesthetics and will drift
toward a house style (warm cream, serif display, terracotta accent) given any opening.
The swatch-index constraint blocks it on colour; on layout, the mitigation is that the
archetype is an enum of five and the critic scores *agreement with the photograph*, not
"is this a nice page".

---

## 7. Cost, latency, caching

Per capture, Opus 5 at $5/$25 per MTok, with Pass 1 plus one critic round:

| | input | output | ≈ cost |
|---|---|---|---|
| Pass 1 (photo + numbers) | ~3k tok | ~600 tok | $0.030 |
| Pass 2 (photo + screenshot) | ~5k tok | ~400 tok | $0.035 |
| **Total** | | | **~$0.07** |

Estimates — image token counts vary with resolution and should be re-baselined with
`messages.count_tokens` against the real buffers before anyone quotes them.

Levers:

- **Perceptual hash cache.** dHash the 256px analysis buffer; identical/near-identical
  captures reuse the stored `SceneReading`. Makes repeat captures free *and* restores
  determinism — the same photo reliably produces the same site, which the current
  engine guarantees by construction and I would not want to lose.
- **Prompt caching.** The rubric and system prompt are stable; `cache_control:
  {type:'ephemeral'}` on them. Opus 5's minimum cacheable prefix is 512 tokens, which
  the rubric comfortably exceeds, so this actually caches.
- **Model tiering.** Opus 5 for Pass 1 (the judgment that matters). Sonnet 5 for critic
  rounds — it has high-res vision and is a third of the price. Haiku 4.5 as a budget
  tier if this ever runs at volume.
- **Effort.** `output_config: { effort: 'low' }` on the critic pass; it is a scoring
  task, not a reasoning-heavy one. Leave thinking on — disabling it on Opus 5 has known
  failure modes and low effort gets most of the latency saving anyway.

Latency budget: heuristic theme at ~0ms (unchanged), Pass 1 landing at 2–4s, critic
settling by 6–10s. Each arrives as a `--morph` transition, so the page visibly
*refines* rather than stalling. That progression is worth showing in the UI — a
"reading…" → "verifying…" → "settled" indicator on the capture status component makes
the latency read as craft rather than lag.

---

## 8. Privacy

The current engine never sends a photograph anywhere; that is a real property and
losing it silently would be wrong. Requirements:

- Explicit opt-in toggle, off by default, with a plain sentence about what leaves the
  device.
- Send the **512px analysis buffer**, never the 900px preview in
  `ThemeEngine.toPreview`.
- No storage beyond the in-memory phash cache; nothing persisted server-side.
- The client-only path stays fully functional and is never framed as degraded — same
  posture the README already takes with the camera/upload fallback.

---

## 9. What I would measure

"Vastly improve" is unfalsifiable without a number. Minimum viable eval:

1. **30-photo fixture set** covering the hard cases: near-monochrome, blown-out,
   subject-vs-background colour conflict, strong distractor colour, heavy motif,
   night shots.
2. **Blind pairwise A/B** — heuristic-only vs AI-refined, same photo, order shuffled,
   scored by humans on "which page looks more like this object". Target: AI wins ≥70%.
3. **Automated regression** — every AI output must still clear the contrast floors, on
   all 30. Any failure is a bug in `lib/patch.ts`, not a model problem.
4. **Critic self-score before/after**, tracked over time as a cheap proxy.

Without (2) this is engineering theatre. It is also the cheapest part of the work.

---

## 10. Phasing

| Phase | Work | Ships |
|---|---|---|
| 1 | `lib/ai/schema.ts`, `lib/patch.ts`, fixture tests | Patch application with no network; proves guards hold |
| 2 | `lib/ai/client.ts`, Pass 1, phash cache, opt-in toggle | Semantic palette roles + finish/voice overrides |
| 3 | Layout tokens in `applyTokens` + `globals.css` archetypes | Two captures finally look like two products |
| 4 | Screenshot + critic loop | The actual closed loop |
| 5 | Copy register, inspector `disagreements` panel | The demo lands |

Phases 1 and 3 are worth doing regardless of whether the AI layer ships — Phase 3 in
particular fixes a structural limitation that has nothing to do with AI, and it makes
the AI layer's output far more visible when it does arrive.

---

## 11. Open questions

- **Screenshot fidelity.** `html2canvas` does not render `backdrop-filter` or the SVG
  grain overlay correctly — precisely the material cues the critic needs to judge. Are
  we willing to add a server-side Playwright render, or does the critic score a
  degraded screenshot and lose material sensitivity?
- **How much drift is acceptable?** If the critic can move the primary colour, the same
  photograph may produce a slightly different site across cache misses. The phash cache
  hides this in practice; do we also want a "lock" that pins the tokens after the first
  settle?
- **Layout archetype count.** Five is a guess. Fewer means captures still feel same-y;
  more means CSS surface area grows fast and each archetype gets less polish.
