'use client';

/**
 * Features, interludes and closing sections — each in several shapes.
 *
 * The same three feature statements read as a quiet numbered list, a two-column
 * essay, image cards, stickers slapped on a wall, a bento grid or a spec sheet,
 * depending on what the photograph asked for.
 */

import { SiteCopy } from '@/lib/copy';
import { Imagery } from '@/lib/imagery';
import { CtaVariant, FeaturesVariant, InterludeVariant } from '@/lib/tokens';
import { CROPS, Photo, pad } from './parts';

export function Features({
  variant,
  copy,
  imagery,
}: {
  variant: FeaturesVariant;
  copy: SiteCopy;
  imagery: Imagery | null;
}) {
  const items = copy.features;

  switch (variant) {
    case 'list':
      return (
        <section className="section features features-list patterned">
          <ol>
            {items.map((f, i) => (
              <li key={f.title} className="reveal">
                <span className="index">{pad(i)}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ol>
        </section>
      );

    case 'columns':
      return (
        <section className="section features features-columns tinted patterned">
          {items.map((f) => (
            <article key={f.title} className="reveal">
              <h3>{f.title}</h3>
              <p className="dropcap">{f.body}</p>
            </article>
          ))}
        </section>
      );

    case 'cards':
      return (
        <section className="section features features-cards patterned">
          {items.map((f, i) => (
            <article key={f.title} className="card reveal">
              <Photo src={imagery?.photo} position={CROPS[i % CROPS.length]} className="card-photo" />
              <div className="card-body">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            </article>
          ))}
        </section>
      );

    case 'stickers':
      return (
        <section className="section features features-stickers textured patterned">
          {items.map((f, i) => (
            <article key={f.title} className={`sticker-card sticker-card-${i % 4} reveal`}>
              <span className="tape" aria-hidden />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </section>
      );

    case 'bento':
      return (
        <section className="section features features-bento patterned">
          {items.map((f, i) => (
            <article key={f.title} className={`bento-cell bento-cell-${i} reveal`}>
              <span className="index">{pad(i)}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
          <div className="bento-cell bento-photo" aria-hidden>
            <Photo src={imagery?.photo} position={CROPS[2]} />
          </div>
        </section>
      );

    case 'spec':
    default:
      return (
        <section className="section features features-spec patterned">
          <header className="spec-head">
            <span>ID</span>
            <span>Capability</span>
            <span>Detail</span>
          </header>
          {items.map((f, i) => (
            <article key={f.title} className="spec-row reveal">
              <span className="index">F-{pad(i)}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </section>
      );
  }
}

export function Interlude({
  variant,
  copy,
  imagery,
}: {
  variant: InterludeVariant;
  copy: SiteCopy;
  imagery: Imagery | null;
}) {
  switch (variant) {
    case 'quote':
      return (
        <section className="section interlude-quote">
          <blockquote className="reveal">
            <p>“{copy.quote.text}”</p>
            <footer>— {copy.quote.attribution}</footer>
          </blockquote>
        </section>
      );

    case 'marquee': {
      // Two copies of the run, so the loop seam falls off-screen.
      const run = [...copy.tags, ...copy.tags];
      return (
        <section className="interlude-marquee" aria-label={copy.tags.join(', ')}>
          <div className="marquee-track" aria-hidden>
            {[0, 1].map((copyIndex) => (
              <div key={copyIndex} className="marquee-run">
                {run.map((tag, i) => (
                  <span key={`${tag}-${i}`}>
                    {tag}
                    <i>✶</i>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>
      );
    }

    case 'metrics':
      return (
        <section className="section interlude-metrics tinted">
          {copy.metrics.map((m) => (
            <div key={m.label} className="reveal">
              <strong>{m.value}</strong>
              <span>{m.label}</span>
            </div>
          ))}
        </section>
      );

    case 'strip':
    default:
      return (
        <section className="interlude-strip textured" aria-hidden>
          {CROPS.slice(0, 5).map((pos) => (
            <Photo key={pos} src={imagery?.photo} position={pos} className="strip-cell" />
          ))}
        </section>
      );
  }
}

export function Closing({ variant, copy }: { variant: CtaVariant; copy: SiteCopy }) {
  const { closing } = copy;
  switch (variant) {
    case 'minimal':
      return (
        <section className="section closing-minimal">
          <h2>{closing.headline}</h2>
          <p className="lede">{closing.body}</p>
          <a className="text-link" href="#" onClick={(e) => e.preventDefault()}>
            {closing.action} <span aria-hidden>→</span>
          </a>
        </section>
      );

    case 'poster':
      return (
        <section className="section closing-poster textured">
          <h2>{closing.headline}</h2>
          <p>{closing.body}</p>
          <button type="button" className="btn btn-primary sticker-button">
            {closing.action}
          </button>
        </section>
      );

    case 'banner':
    default:
      return (
        <section className="section">
          <div className="closing-banner reveal">
            <div>
              <h2>{closing.headline}</h2>
              <p>{closing.body}</p>
            </div>
            <button type="button" className="btn btn-inverse">
              {closing.action}
            </button>
          </div>
        </section>
      );
  }
}

export function SiteNav({ copy }: { copy: SiteCopy }) {
  return (
    <nav className="site-nav" aria-label="Generated site">
      <span className="brand">{copy.brand}</span>
      <ul>
        {copy.nav.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button type="button" className="btn btn-primary btn-small">
        {copy.primaryAction}
      </button>
    </nav>
  );
}

export function SiteFooter({ copy }: { copy: SiteCopy }) {
  return (
    <footer className="site-footer">
      <span className="brand">{copy.brand}</span>
      <span className="footer-note">{copy.footer}</span>
      <ul>
        {copy.tags.slice(0, 4).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </footer>
  );
}
