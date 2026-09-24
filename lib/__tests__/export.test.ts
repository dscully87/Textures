import { describe, expect, it } from 'vitest';
import { analyzeImage } from '../analyze';
import { designTokens, portableVariables, readme, slug, tailwindTheme, themeCss, themeKit } from '../export';
import { synthesize, defaultTokens } from '../synthesize';
import { PHOTOS, loadPhoto } from './photos';

const graffiti = synthesize(analyzeImage(loadPhoto('graffiti')));
const lake = synthesize(analyzeImage(loadPhoto('lake')));

describe('theme kit', () => {
  it('ships four files', () => {
    expect(themeKit(lake).map((f) => f.name)).toEqual(['theme.css', 'tailwind-theme.css', 'tokens.json', 'README.md']);
  });

  it('never references this app’s self-hosted font variables or blob URLs', () => {
    for (const name of PHOTOS) {
      const tokens = synthesize(analyzeImage(loadPhoto(name)));
      for (const file of themeKit(tokens)) {
        expect(file.content, `${name}/${file.name}`).not.toMatch(/--font-[a-z-]+-src/);
        expect(file.content, `${name}/${file.name}`).not.toContain('blob:');
      }
    }
  });

  it('names real font families and imports them from Google Fonts', () => {
    const css = themeCss(graffiti);
    expect(css.startsWith("@import url('https://fonts.googleapis.com/css2?")).toBe(true);
    expect(css).toContain("--font-heading: 'Anton'");
    const vars = new Map(portableVariables(graffiti));
    expect(vars.get('--font-accent')).toMatch(/^'Permanent Marker'/);
  });

  it('carries every palette colour', () => {
    const css = themeCss(lake);
    for (const hex of [lake.palette.primary, lake.palette.surface, lake.palette.ink, lake.palette.accent]) {
      expect(css).toContain(hex);
    }
  });

  it('puts Tailwind namespaces inside @theme and the rest on :root', () => {
    const css = tailwindTheme(lake);
    const theme = css.slice(css.indexOf('@theme {'), css.indexOf('}', css.indexOf('@theme {')));
    expect(theme).toContain(`--color-primary: ${lake.palette.primary}`);
    expect(theme).toContain('--font-heading:');
    expect(theme).toContain('--radius-lg:');
    expect(theme).not.toContain('--measure');
    expect(css).toContain("@import 'tailwindcss';");
  });

  it('writes W3C design tokens', () => {
    const doc = JSON.parse(designTokens(graffiti));
    expect(doc.color.primary).toEqual({ $type: 'color', $value: graffiti.palette.primary });
    expect(doc.font.heading.$value[0]).toBe('Anton');
    expect(doc.color.pop1.$value).toBe(graffiti.palette.pops[0].color);
    expect(doc.$extensions['textures.layout'].archetype).toBe('street');
  });

  it('documents the palette and its contrast in the README', () => {
    const text = readme(lake);
    expect(text).toContain(`# ${lake.copy.brand}`);
    expect(text).toContain(lake.palette.primary);
    expect(text).toMatch(/ink on surface \| \d+\.\d\d \| 7/);
  });

  it('exports the resting theme too', () => {
    expect(() => themeKit(defaultTokens())).not.toThrow();
  });

  it('slugs brand names for file names', () => {
    expect(slug('Hearth & Grain')).toBe('hearth-grain');
    expect(slug('WALLSPACE')).toBe('wallspace');
    expect(slug('Café Noir')).toBe('cafe-noir');
    expect(slug('!!!')).toBe('textures');
  });
});
