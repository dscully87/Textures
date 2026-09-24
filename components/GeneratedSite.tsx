'use client';

/**
 * The generated site.
 *
 * Every class name here is static. Nothing in this file knows what the
 * photograph contained — it only uses the token utilities (`bg-primary`,
 * `rounded-lg`, `font-heading`, `p-6`, `shadow-elevated`), each of which
 * resolves through a CSS variable the engine rewrites on capture. That is the
 * point of the architecture: the markup is written once, and the photograph
 * decides what it looks like.
 */

import { useEngine } from './ThemeEngine';

const FEATURES = [
  {
    title: 'Sampled, not guessed',
    body: 'Dominant colors come from median-cut quantization over the actual pixels, ranked by coverage and chroma — not from a fixed preset that happens to be nearby.',
  },
  {
    title: 'Material-aware surfaces',
    body: 'Specular highlights, roughness and dynamic range decide whether panels render as frosted glass, brushed metal, matte card or coarse stone.',
  },
  {
    title: 'Geometry sets the radii',
    body: 'Edge orientation statistics separate machined objects from organic ones, and every corner in the interface follows the subject.',
  },
];

const STATS = [
  { value: '30', label: 'CSS variables rewritten per capture' },
  { value: '1', label: 'frame to restyle the document' },
  { value: '0', label: 'components re-rendered to do it' },
];

export function GeneratedSite() {
  const { tokens, capture, status } = useEngine();
  const { palette, meta, typography, surface, pattern } = tokens;

  return (
    <div className="morph flex flex-col">
      {/* ---------------------------------------------------------------- Hero */}
      <section className="section patterned relative px-6">
        <div className="hero mx-auto flex max-w-5xl flex-col items-start gap-6">
          <span className="morph inline-flex items-center gap-2 rounded-full border border-line bg-surface-alt/60 px-4 py-1.5 text-xs font-medium tracking-wide text-ink-muted">
            <span
              className="size-1.5 rounded-full bg-accent"
              style={{ boxShadow: '0 0 12px var(--color-accent)' }}
              aria-hidden
            />
            {status === 'ready' ? 'Theme synthesized from your capture' : 'Neutral resting theme'}
          </span>

          <h1 className="hero-signature display font-heading max-w-3xl">
            This page is wearing
            <span className="text-primary"> whatever you point at it</span>.
          </h1>

          <p className="lede measure">{meta.description}</p>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary">
              Explore the palette
            </button>
            <button type="button" className="btn btn-ghost">
              Read the pipeline
            </button>
          </div>

          <dl className="mt-6 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
            {STATS.map((stat) => (
              <div key={stat.label} className="panel morph p-5">
                <dt className="font-heading text-3xl text-primary">{stat.value}</dt>
                <dd className="mt-1 text-sm text-ink-muted">{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------------ Features */}
      <section className="section px-6">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-heading text-3xl sm:text-4xl">What the photograph decides</h2>
          <div className="features mt-8">
            {FEATURES.map((feature, i) => (
              <article key={feature.title} className="panel patterned morph flex flex-col gap-3 p-6">
                <span
                  className="morph flex size-9 items-center justify-center bg-primary text-sm font-semibold text-on-primary"
                  style={{ borderRadius: 'var(--radius-md)' }}
                >
                  {i + 1}
                </span>
                <h3 className="font-heading text-xl">{feature.title}</h3>
                <p className="measure text-sm leading-body text-ink-muted">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- Source & materials */}
      <section className="section px-6">
        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-[1.1fr_1fr]">
          <figure className="panel morph overflow-hidden">
            {capture ? (
              // The capture is a client-side data URL of unknown dimensions, so
              // next/image would add a network round trip and a layout guess for
              // nothing. A plain <img> is the correct tool here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={capture.src}
                alt="The captured source frame this theme was generated from"
                className="capture-figure"
              />
            ) : (
              <div className="capture-figure flex items-center justify-center bg-surface-alt/50 text-sm text-ink-muted">
                No capture yet
              </div>
            )}
            <figcaption className="flex items-center justify-between gap-3 p-4">
              <span className="metric text-ink-muted">
                {capture
                  ? `${capture.width}×${capture.height} source`
                  : 'Capture something to begin'}
              </span>
              <span className="metric text-ink-muted">
                confidence {Math.round(meta.confidence * 100)}%
              </span>
            </figcaption>
          </figure>

          <div className="flex flex-col gap-5">
            <div className="panel morph flex flex-col gap-4 p-6">
              <h3 className="font-heading text-xl">Material</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['finish', surface.finish],
                  ['geometry', meta.geometry],
                  ['type voice', typography.voice],
                  ['motif', pattern.kind],
                ].map(([k, v]) => (
                  <div key={k} className="morph rounded-md bg-ink/[0.05] p-3">
                    <div className="metric text-ink-muted">{k}</div>
                    <div className="mt-0.5 text-sm font-medium capitalize">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel morph flex flex-col gap-4 p-6">
              <h3 className="font-heading text-xl">Palette in use</h3>
              <div className="flex gap-2">
                {/* Keyed by role: two roles can resolve to the same hex. */}
                {(['primary', 'accent', 'secondary', 'surfaceAlt'] as const).map((role) => (
                  <div
                    key={role}
                    className="swatch morph h-16 flex-1"
                    style={{ backgroundColor: palette[role] }}
                    title={`${role} ${palette[role]}`}
                  />
                ))}
              </div>
              <p className="text-sm text-ink-muted">
                Text colors are lightness-corrected against the generated surface until they clear
                WCAG AA, so a low-contrast photograph still produces a readable site.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- CTA */}
      <section className="section px-6">
        <div className="mx-auto max-w-5xl">
          <div className="panel patterned morph flex flex-col items-start gap-5 p-10">
            <h2 className="font-heading max-w-2xl text-3xl sm:text-4xl">
              Point it at something else. The whole site follows.
            </h2>
            <p className="lede max-w-xl">
              Photograph a rusted bolt, a citrus peel, a pane of frosted glass. Each one lands as a
              different set of variables — and the same markup renders as a different product.
            </p>
            <button type="button" className="btn btn-primary">
              Capture again
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-line px-6 py-10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <span className="font-heading text-lg">Textures</span>
          <span className="metric text-ink-muted">
            visual-first dynamic CSS &amp; React engine
          </span>
        </div>
      </footer>
    </div>
  );
}
