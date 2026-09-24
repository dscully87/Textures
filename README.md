# Textures

Photograph anything and get a website that feels like it. A still lake becomes a
quiet, full-bleed page in a hushed serif and a palette of water blues; a graffiti
wall becomes a paste-up poster in condensed capitals, stickers and a tilted
ticker. Colour, texture, typography, layout, motion and copy are all read from the
one picture, and the result exports as a theme kit for your own site.

```
[ Camera / upload ] → [ Pixel analysis ] → [ Mood ] → [ Decisions ] → [ Tokens ] → [ Live page + theme kit ]
                                                  ↑
                             optional: Gemini reads the photo itself
```

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # pipeline, calibration, AI-layer and route tests; no browser, no network
npm run build
```

Camera capture needs a secure context. `localhost` counts as one; a LAN IP does
not, so on a phone you either need HTTPS or the upload path — which is always
available and offers both the photo library and the camera.

## How a photograph becomes a site

**Measure.** `lib/analyze.ts` downsizes the frame to 256px (in halving steps, so a
4000px phone photo and a 500px one measure the same) and records edges, texture,
repeats, how colour is distributed (hue families, warmth) and where things are
(negative space, horizontal banding, centre weight). `lib/quantize.ts` extracts
swatches with their real coverage.

**Mood.** `lib/mood.ts` condenses those numbers into five axes — energy (calm ↔
loud), warmth, order (organic ↔ structured), density (airy ↔ packed) and polish
(raw ↔ refined) — calibrated so real photographs spread across them. Every design
decision reads the same five numbers, which keeps the decisions coherent and puts
different subjects far apart.

**Decide.** `lib/synthesize.ts` picks, by distance in mood space:

| Decision | Options | Where |
| --- | --- | --- |
| Layout | serene, editorial, gallery, technical, brutalist, soft, street — each a different hero, feature layout, interlude and close | `lib/layouts.ts` |
| Type | 14 pairings over 20 self-hosted families, constrained to those that suit the layout | `lib/fonts.ts` |
| Colour | tonal, accent, pop or moody, all through the same contrast repairs | `lib/synthesize.ts` |
| Motion | still, drift, shimmer, bloom, settle, glitch, weave | `lib/synthesize.ts` |
| Copy | written per layout, in that layout's voice | `lib/copy.ts` |

**Texture.** `lib/imagery.ts` turns the photograph into material: a duotone in
the palette's colours for poster heroes, and a seamless tile cut from the frame's
most textured region and mirror-tiled behind sections — so concrete reads as
concrete and water as water.

**Render.** Colour, type, radius, spacing, grain, texture and motion reach the DOM
as CSS custom properties and data attributes (`lib/tokens.ts`), so they restyle in
one frame. Structure — which sections the page is built from — is a React choice
(`components/GeneratedSite.tsx`, `components/site/`), styled per layout in
`app/site.css`.

**Readability is enforced, not hoped for.** Body text clears 7:1 against the
surface and 4.5:1 against the alternate surface, muted text 4.5:1 on both, the
accent 3:1 (it colours large display type and UI), and every label on a coloured
block 4.5:1. A mid-luminance colour that fails against both black and white moves
itself rather than shipping an unreadable button.

### Calibration

`fixtures/photos/` holds ten real photographs (lake, graffiti, building, circuit
board, fruit, sweets, cathedral, aqueduct, painting, mandrill) and
`lib/__tests__/calibration.test.ts` holds the engine to them: the lake and the
graffiti wall must differ on every categorical decision, and the ten must spread
across at least six type pairings, five layouts, four motions, three finishes and
both schemes. `CALIBRATION_REPORT=1 npm test` prints the table.

## The AI layer (optional)

Off by default. With the toggle on, each capture also asks Google's Gemini to
read the photograph:

```
capture ─┬─ analysis + deterministic theme (on device) ── painted immediately
         └─ 512px JPEG + measurements ─▶ /api/read ─▶ Gemini ─▶ reading ─▶ patch ─▶ morph
```

**The photograph leaves the device** when this is on — a 512px JPEG goes to the
Gemini API. The toggle says so.

What the model contributes is judgment the pixels can't supply: what the subject
is, which of the engine's layouts, pairings and colour strategies express it,
which measured swatch carries the subject's identity, its own reading of the
mood (blended 50/50 with the measurement), and copy written for a plausible
brand the photograph could be the hero image of. It returns `disagreements`, so
where it overrides the engine it has to say why; the inspector shows them.

What it is not allowed to do:

| Rule | Enforced by |
| --- | --- |
| Never invents a colour | Palette roles are swatch **indices**, resolved locally |
| Never breaks contrast | Readings become the same `Decisions` the engine makes and go through the same `assemble()` |
| Never exceeds sane ranges | Every number clamped and every string capped in `lib/ai/reading.ts` |
| Never gets `signature` motion for free | Written rationale, confidence ≥ 0.7 and real dynamic range (`lib/patch.ts`) |
| Never loops fast | Looping is `ambient`-only, 20s floor |
| Never blocks the page | The deterministic theme paints first; the reading lands later or not at all |
| Never breaks determinism | Readings cached by perceptual hash — same subject, same site |

The route is not a proxy. The browser sends an image and a structured payload
of numbers, hex colours and enum values; `parseMeasurements` rejects anything
else, and the prompt is written on the server. Requests must also be
same-origin, a real JPEG under 350 KB, and within a per-address rate limit
(20 per 10 minutes, per server instance — add a platform rate-limit rule in
front of `/api/read` for a public deploy).

### Configuration

```bash
cp .env.example .env.local   # then add your key
```

| Variable | |
| --- | --- |
| `GEMINI_API_KEY` | Server-side only. Create one at https://aistudio.google.com/apikey. |
| `GEMINI_MODEL` | Optional; defaults to `gemini-2.5-flash`. Any Gemini model that takes images and structured JSON output works. |

**Never prefix either with `NEXT_PUBLIC_`.** That inlines the value into the
client bundle, readable by every visitor.

If the photographs people capture are private, use a key from a project with
billing enabled: Google may use free-tier inputs to improve its products. A
reading is about 3k input tokens (instructions ~1.4k, response schema ~1.3k,
image ~260, measurements ~250) and up to ~2k output tokens including a
1k-token thinking budget — around half a cent per capture at Gemini 2.5 Flash
list prices; check Google's pricing page for current rates. Repeat captures of
the same subject are served from the perceptual-hash cache and cost nothing.

### Verifying a deploy

`GET /api/read` answers without calling the provider:

```bash
curl https://<your-deployment>/api/read
# { "configured": true, "keyLength": 39, "model": "gemini-2.5-flash", ... }
```

`configured: false` after adding the variable almost always means the deploy
predates it — Vercel applies environment changes to new builds only. With the
toggle on, a failed reading prints its reason under the status line and passes
through the provider's own message on a 4xx, so a wrong model id and an invalid
key are distinguishable.

## Theme kit

"Download theme kit" in the inspector zips:

| File | |
| --- | --- |
| `theme.css` | Every token as a custom property, plus a small starter layer |
| `tailwind-theme.css` | A Tailwind v4 `@theme` block — `bg-primary`, `font-heading`, `rounded-lg` follow the kit |
| `tokens.json` | W3C design tokens, with mood, layout and motion as extensions |
| `README.md` | The reading, the palette and its contrast ratios |

Fonts are exported as Google Fonts family names with a matching `@import`.

## Motion and accessibility

Motion is native scroll-driven CSS (`animation-timeline`), gated behind
`prefers-reduced-motion: no-preference` — shortening `animation-duration` does
not stop a scroll-driven animation, so the gate is what honours the setting.
Wrappers use `overflow: clip` rather than `hidden`: a hidden-overflow box is a
scroll container, and `view()` timelines bound to a box that never scrolls sit
at their end state and never play. Browsers without scroll timelines get a still
page.

## Architecture

| Path | Responsibility |
| --- | --- |
| `lib/analyze.ts` | Edges, texture, repeats, colour distribution, composition; resolution-independent downscaling |
| `lib/quantize.ts` | Swatches with real coverage and chroma |
| `lib/mood.ts` | The five mood axes and nearest-option selection |
| `lib/synthesize.ts` | `decide()` and `assemble()`: mood → layout, type, palette, surface, motion |
| `lib/layouts.ts`, `lib/fonts.ts`, `lib/copy.ts` | The option libraries |
| `lib/imagery.ts` | Duotone and texture tile from the photograph |
| `lib/tokens.ts` | The token contract and `applyTokens` |
| `lib/export.ts` | The theme kit |
| `lib/ai/prompt.ts` | Measurement payload, its validator, the prompt and the response schema |
| `lib/ai/reading.ts` | The reading contract and its validator |
| `lib/ai/guard.ts` | Same-origin, rate-limit and image checks |
| `lib/ai/refine.ts` | Client-side orchestration and caching |
| `lib/patch.ts` | Reading → decisions, with the motion gates |
| `app/api/read/route.ts` | The only network hop; holds the API key |
| `components/ThemeEngine.tsx` | Runs the pipeline, loads fonts, renders imagery |
| `components/GeneratedSite.tsx`, `components/site/` | The generated site's sections |
| `components/ThemeInspector.tsx` | Every measurement, decision and AI reading |

## Notes

Write `backdrop-filter` unprefixed and let the build add the `-webkit-` form.
Authoring both by hand makes Lightning CSS collapse the pair and drop the
standard property — which silently disables glassmorphism in Chrome and Firefox.
