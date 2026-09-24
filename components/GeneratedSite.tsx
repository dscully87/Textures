'use client';

/**
 * The generated site.
 *
 * Styling is still entirely token-driven: colour, type, radius, spacing, grain,
 * texture and motion arrive as CSS variables and data attributes on <html>,
 * so a restyle lands in one frame without React. What changed is *structure*.
 * The first version rendered one fixed template, so every photograph produced
 * the same product in different paint; here `layout.sections` chooses which
 * hero, feature layout, interlude and close the page is built from, and the
 * archetype's CSS (`data-layout`) shapes them.
 */

import { useEngine } from './ThemeEngine';
import { Hero } from './site/Hero';
import { Closing, Features, Interlude, SiteFooter, SiteNav } from './site/Sections';

export function GeneratedSite() {
  const { tokens, imagery } = useEngine();
  const { copy, layout } = tokens;
  const { sections } = layout;

  return (
    <div className="site morph">
      <SiteNav copy={copy} />
      <Hero variant={sections.hero} copy={copy} tokens={tokens} imagery={imagery} />
      <Features variant={sections.features} copy={copy} imagery={imagery} />
      <Interlude variant={sections.interlude} copy={copy} imagery={imagery} />
      <Closing variant={sections.cta} copy={copy} />
      <SiteFooter copy={copy} />
    </div>
  );
}
