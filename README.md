# Textures

A visual-first dynamic CSS and React engine. Point a camera at an object; the
site restyles itself from that object's color, material, geometry and motif.

The markup never changes. A capture rewrites ~30 CSS custom properties on
`<html>`, and because those property names *are* Tailwind v4's theme namespaces,
every `bg-primary`, `rounded-lg`, `font-heading` and `p-6` already in the DOM
retargets in the same frame. No component re-renders to restyle the page.

```
[ Camera / upload ] → [ Pixel analysis ] → [ Token synthesis ] → [ CSS variable injection ] → [ Live DOM ]
```

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 38 pipeline tests, no browser needed
npm run build
```

Camera capture needs a secure context. `localhost` counts as one; a LAN IP does
not, so on a phone you either need HTTPS or the upload path — which is always
available and is not a degraded mode.

## Architecture

| Path | Responsibility |
| --- | --- |
| `lib/color.ts` | Color space conversion, WCAG luminance and contrast, contrast repair |
| `lib/quantize.ts` | Median-cut quantization; dominant swatches with population and chroma stats |
| `lib/analyze.ts` | Sobel edges, orientation statistics, texture/specular metrics, motif autocorrelation |
| `lib/synthesize.ts` | The opinionated half: measurements → design tokens |
| `lib/patterns.ts` | Procedural tiling SVGs and fractal-noise grain, as data URIs |
| `lib/tokens.ts` | The token contract and `applyTokens`, the only bridge to the DOM |
| `lib/vision/labels.ts` | The closed label sets CLIP scores against |
| `lib/vision/classify.ts` | Zero-shot classification, in the browser |
| `lib/vision/phash.ts` | Difference hashing, so a repeated subject reuses its reading |
| `lib/ai/prompt.ts` | Builds the reasoning request from labels + measurements |
| `lib/ai/reading.ts` | The reading contract and its validator |
| `lib/ai/refine.ts` | Orchestrates classify → reason → patch, client-side |
| `lib/patch.ts` | Applies a reading to the tokens, and refuses what it shouldn't |
| `app/api/read/route.ts` | The only network hop. Holds the API key |
| `components/ThemeEngine.tsx` | Runs the pipeline, owns capture state |
| `components/CameraCapture.tsx` | `getUserMedia` with upload/drag-drop fallback |
| `components/GeneratedSite.tsx` | The generated surface — entirely static class names |
| `components/ThemeInspector.tsx` | Shows every measurement and decision |

`lib/` is dependency-free and environment-agnostic: the same code runs in the
browser during capture and under Node in tests. Nothing in `lib/analyze.ts`
knows what CSS is.

## What the photograph decides

**Palette.** Median-cut quantization over a 256px buffer yields swatches ranked
by chroma, mid-lightness and coverage. The winner becomes `primary`; the most
chromatic swatch at a genuinely different hue *with real coverage* becomes
`accent`. Neutrals inherit a trace of the subject's hue, so a wooden object
yields warm greys and a steel one yields cool greys. Overall brightness picks a
light or dark scheme.

**Readability is enforced, not hoped for.** `ink` and `inkMuted` are
lightness-corrected against the generated surface until they clear 7:1 and 4.5:1;
`accent` clears the 3:1 floor WCAG sets for non-text UI. Mid-luminance colors are
the trap — a hue near 18% relative luminance fails 4.5:1 against *both* black and
white, so when no label color can rescue a primary, the engine moves the primary
itself rather than shipping an unreadable button.

**Geometry → radii.** Edge-orientation entropy separates machined subjects
(energy concentrated in a few angular bins) from organic ones (energy spread
across every bin), with axis-alignment as a secondary signal. That score drives a
single radius unit from `0px` to `30px`, and every corner in the interface
follows.

**Material → surfaces.** Specular highlights are measured as small, bright,
*desaturated* regions — a bright yellow wall is not a highlight, a white glint
is, and the response deliberately falls off past a few percent coverage so a
blown-out frame does not read as glossy. Gloss also requires *smoothness*
between the highlights: coarse aggregate throws just as many blown-out pixels as
polished glass, so roughness carries a heavy veto. The resulting finish sets
backdrop blur, fill translucency, hairline alpha, shadow depth and grain.

**Motif → SVG.** Directional autocorrelation of the edge map finds repeats. It
scores *prominence* — peak minus the curve's mean — not raw correlation, because
a striped subject correlates near-perfectly at every lag along the stripe
direction: that means "nothing changes", not "something repeats". Diagonals must
beat the best axis direction by a clear margin before a motif is called diagonal,
since a diagonal shift aliases onto axis-aligned repeats.

**Visual weight → type and density.** Geometry picks the voice (technical,
neutral, editorial, friendly) and dynamic range modulates weight, tracking and
scale. Density rides on Tailwind's `--spacing` step, so one variable rescales
every padding, margin and gap on the page.

**Material → motion.** A wavy, specular surface shimmers; coarse high-contrast
grain glitches; a soft organic subject drifts; a machined one settles. Seven
characters, each scored from signals already measured — and `still` is a real
answer, taken whenever the frame carries no structure or no dynamic range,
because a page that moves for no reason is worse than one that holds still.

Restraint is structural rather than advisory. Motion runs on three tiers:
`ambient` (page-scale, the only tier permitted to loop, and never faster than
20s), `accent` (fires once on entry — the default), and `signature`
(section-scale and memorable, capped at one element per page). The loud tier
clears three gates: a written rationale, confidence above 0.7, and enough dynamic
range in the photograph itself. A flat, quiet frame cannot produce a hyperactive
page no matter what asks for it.

The mechanism is native scroll-driven CSS (`animation-timeline`), so motion is
one data attribute and four variables — nothing re-renders and nothing listens to
scroll. Firefox has not shipped scroll timelines, so it gets a still page via
`@supports`; `prefers-reduced-motion` already disables all of it.

**Composition → layout.** Five archetypes (`editorial`, `technical`, `gallery`,
`brutalist`, `soft`) plus line measure, feature column count and image ratio,
written as `data-layout` and three variables. Without this the markup could only
ever be recoloured, and two captures would produce the same product in different
paint.

## The AI layer (optional)

Off by default. With the toggle on, a capture takes one extra pass:

```
capture ─┬─ analyzeImage       (existing, on device) ─┐
         └─ CLIP zero-shot     (on device)            ├─▶ /api/read ─▶ model ─▶ reading
                                                      ┘   (text only)
```

**The photograph never leaves the browser.** CLIP scores it against closed label
sets locally, and only those labels — with confidences — plus the pixel
measurements are sent on. There is no image in the request body.

What the model contributes is judgment, not measurement: which measured swatch is
the *subject's* colour rather than the most saturated distractor, what proportion
each role should occupy, which motion character the surface implies, and which
layout archetype fits. It also returns `disagreements`, so where it overrides the
deterministic engine it has to say why.

What it is not allowed to do:

| Rule | Enforced by |
| --- | --- |
| Never invents a colour | Palette is swatch **indices**, resolved locally; a bad index falls back |
| Never breaks contrast | Reassigned palettes re-run `composePalette` and every contrast repair |
| Never exceeds sane ranges | Every numeric clamped in `lib/ai/reading.ts` and `lib/patch.ts` |
| Never gets `signature` for free | Rationale required, plus confidence and dynamic-range gates |
| Never loops fast | Looping is `ambient`-only, floor of 20s |
| Never blocks the page | Deterministic theme paints first; a patch lands later or not at all |
| Never breaks determinism | Readings cached by perceptual hash — same subject, same site |

Every failure mode — no key, provider down, timeout, malformed JSON, wrong shape —
resolves to the deterministic theme, which is a complete product on its own. That
is also why `npm test` needs no network: `lib/` is still pure, and the guards are
tested with fixtures.

### Configuration

```bash
cp .env.example .env.local   # then add your key
```

`DEEPSEEK_API_KEY` is read server-side in `app/api/read/route.ts`. On Vercel, set
it under **Settings → Environment Variables** and pull it locally with
`vercel env pull .env.local`.

**Never prefix it with `NEXT_PUBLIC_`.** That inlines the value into the client
bundle at build time, making it readable by every visitor — and once a key ships
that way, rotating it is the only remedy.

`DEEPSEEK_MODEL` and `DEEPSEEK_BASE_URL` are optional overrides.

> `npm audit` reports advisories in `onnxruntime-node` and `sharp`. Those are the
> Node halves of transformers.js; we only ever run the browser build, and both are
> listed in `serverExternalPackages` so they stay out of the server bundle.

## Polish techniques

- **Glassmorphism** — translucent fills, `backdrop-filter` blur, a low-opacity
  white hairline and layered shadows, all keyed to measured specularity.
- **Procedural grain** — an SVG `feTurbulence` overlay at 2–9% opacity, its base
  frequency scaled by roughness, so flat color never looks sterile.
- **Gradient mesh** — secondary and tertiary colors as multi-point radial
  gradients that drift slowly behind content.
- **Adaptive radii** — sharp subjects yield square interfaces, round subjects
  yield pill-shaped ones.

Every generated surface transitions on a shared clock (`--morph`), so a capture
reads as one coordinated change rather than a dozen independent flickers.
`prefers-reduced-motion` is honored.

## Notes

Write `backdrop-filter` unprefixed and let the build add the `-webkit-` form.
Authoring both by hand makes Lightning CSS collapse the pair and drop the
standard property — which silently disables glassmorphism in Chrome and Firefox.
