'use client';

/**
 * Six heroes, one per way a photograph can open a page.
 *
 * `bleed` gives the image the whole stage (a lake); `split` is a magazine
 * spread; `poster` is a paste-up wall of cut-out lines and stickers; `minimal`
 * floats the subject in a soft blob; `mosaic` tiles crops of it; `stack` is a
 * spec sheet or a slab of concrete type, depending on the archetype.
 */

import { SiteCopy } from '@/lib/copy';
import { DesignTokens, HeroVariant } from '@/lib/tokens';
import { Imagery } from '@/lib/imagery';
import { Actions, CROPS, Headline, Photo } from './parts';

interface HeroProps {
  variant: HeroVariant;
  copy: SiteCopy;
  tokens: DesignTokens;
  imagery: Imagery | null;
}

export function Hero({ variant, copy, tokens, imagery }: HeroProps) {
  const photo = imagery?.photo;

  switch (variant) {
    case 'bleed':
      return (
        <section className="hero hero-bleed">
          <div className="hero-media">
            <Photo src={photo} className="hero-photo" alt="" />
            <div className="hero-scrim" aria-hidden />
          </div>
          <div className="hero-copy reveal">
            <p className="eyebrow">{copy.eyebrow}</p>
            <Headline copy={copy} className="display hero-signature" />
            <p className="lede measure">{copy.lede}</p>
            <Actions copy={copy} />
          </div>
        </section>
      );

    case 'split':
      return (
        <section className="hero hero-split">
          <div className="hero-copy reveal">
            <p className="eyebrow eyebrow-rule">{copy.eyebrow}</p>
            <Headline copy={copy} className="display hero-signature" />
            <p className="lede measure">{copy.lede}</p>
            <Actions copy={copy} />
          </div>
          <figure className="hero-figure">
            <Photo src={photo} className="hero-photo" />
            <figcaption className="caption">Fig. 1 — {copy.brand}</figcaption>
          </figure>
        </section>
      );

    case 'poster': {
      const pops = tokens.palette.pops.length ? tokens.palette.pops : [];
      const words = copy.headline.replace(/[.!]$/, '').split(' ');
      return (
        <section className="hero hero-poster textured">
          <div className="poster-backdrop" aria-hidden>
            {imagery ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagery.duotone} alt="" className="photo" />
            ) : (
              <div className="photo photo-fallback" />
            )}
          </div>
          <p className="eyebrow sticker sticker-tilt-l">{copy.eyebrow}</p>
          <h1 className="headline display poster-lines hero-signature">
            {words.map((word, i) => (
              <span key={`${word}-${i}`} className={`poster-line poster-line-${i % 3}`}>
                {word}
              </span>
            ))}
          </h1>
          {copy.headlineAccent && <p className="poster-tag">{copy.headlineAccent}</p>}
          <div className="poster-foot reveal">
            <p className="lede poster-lede">{copy.lede}</p>
            <Actions copy={copy} />
          </div>
          {pops.slice(0, 3).map((_, i) => (
            <span key={i} className={`poster-sticker poster-sticker-${i}`} aria-hidden>
              {copy.tags[i] ?? ''}
            </span>
          ))}
          <span className="tape tape-a" aria-hidden />
          <span className="tape tape-b" aria-hidden />
        </section>
      );
    }

    case 'minimal':
      return (
        <section className="hero hero-minimal">
          <div className="blob-wrap" aria-hidden>
            <span className="orb orb-a" />
            <span className="orb orb-b" />
            <Photo src={photo} className="blob" />
          </div>
          <p className="eyebrow pill">{copy.eyebrow}</p>
          <Headline copy={copy} className="display hero-signature" />
          <p className="lede measure">{copy.lede}</p>
          <Actions copy={copy} />
        </section>
      );

    case 'mosaic':
      return (
        <section className="hero hero-mosaic">
          <div className="hero-copy reveal">
            <p className="eyebrow">{copy.eyebrow}</p>
            <Headline copy={copy} className="display hero-signature" />
            <p className="lede measure">{copy.lede}</p>
            <Actions copy={copy} />
          </div>
          <div className="mosaic" aria-hidden>
            {CROPS.slice(0, 4).map((pos, i) => (
              <Photo key={pos} src={photo} position={pos} className={`mosaic-cell mosaic-cell-${i}`} />
            ))}
          </div>
        </section>
      );

    case 'stack':
    default:
      return (
        <section className="hero hero-stack">
          <div className="stack-head">
            <p className="eyebrow">{copy.eyebrow}</p>
            <Headline copy={copy} className="display hero-signature" />
          </div>
          <div className="stack-grid">
            <figure className="stack-media">
              <Photo src={photo} className="hero-photo" />
              <figcaption className="caption">
                FIG_01 — {copy.brand.toUpperCase()}
              </figcaption>
            </figure>
            <div className="stack-side reveal">
              <p className="lede">{copy.lede}</p>
              <dl className="stack-metrics">
                {copy.metrics.map((m) => (
                  <div key={m.label}>
                    <dt>{m.label}</dt>
                    <dd>{m.value}</dd>
                  </div>
                ))}
              </dl>
              <Actions copy={copy} />
            </div>
          </div>
        </section>
      );
  }
}
