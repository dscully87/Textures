/**
 * Calibration against real photographs.
 *
 * The point of the product is that different subjects yield different sites.
 * These tests hold the engine to that on actual photos rather than synthetic
 * fixtures: a calm lake and a graffiti wall must not come out as the same
 * product in different paint, and ten varied photographs must spread across
 * the design space instead of collapsing onto one corner of it.
 *
 * Set CALIBRATION_REPORT=1 to print the full measurement/decision table.
 */

import { describe, expect, it } from 'vitest';
import { analyzeImage } from '../analyze';
import { contrastHex } from '../color';
import { synthesize } from '../synthesize';
import { DesignTokens } from '../tokens';
import { PHOTOS, PhotoName, loadPhoto } from './photos';

/** The categorical decisions a visitor would actually notice. */
function signature(tokens: DesignTokens) {
  return {
    font: tokens.typography.pairing,
    layout: tokens.layout.archetype,
    colour: tokens.palette.strategy,
    finish: tokens.surface.finish,
    motion: tokens.motion.character,
    scheme: tokens.meta.sourceIsDark ? 'dark' : 'light',
  };
}

const themes = new Map<PhotoName, DesignTokens>();
function themeOf(name: PhotoName): DesignTokens {
  let t = themes.get(name);
  if (!t) {
    t = synthesize(analyzeImage(loadPhoto(name)));
    themes.set(name, t);
  }
  return t;
}

const distinct = (values: string[]) => new Set(values).size;

describe('calibration on real photographs', () => {
  if (process.env.CALIBRATION_REPORT) {
    it('report', () => {
      console.table(
        PHOTOS.map((name) => ({ name, ...signature(themeOf(name)), primary: themeOf(name).palette.primary, surface: themeOf(name).palette.surface })),
      );
    });
  }

  // Before the mood vector, all ten of these photographs landed on two fonts,
  // two layouts and a single motion character, and the lake and the graffiti
  // wall differed only in paint.
  it('renders a lake and a graffiti wall as different products', () => {
    const lake = signature(themeOf('lake'));
    const graffiti = signature(themeOf('graffiti'));
    for (const key of Object.keys(lake) as (keyof typeof lake)[]) {
      expect(lake[key], key).not.toBe(graffiti[key]);
    }
  });

  it('reads the lake as calm and the graffiti as loud', () => {
    const lake = themeOf('lake').mood;
    const graffiti = themeOf('graffiti').mood;
    expect(lake.energy).toBeLessThan(0.3);
    expect(graffiti.energy).toBeGreaterThan(0.7);
    expect(lake.density).toBeLessThan(graffiti.density - 0.4);
    expect(lake.polish).toBeGreaterThan(graffiti.polish + 0.3);
  });

  it('spreads ten varied photographs across the design space', () => {
    const sigs = PHOTOS.map((name) => signature(themeOf(name)));
    expect(distinct(sigs.map((s) => s.font))).toBeGreaterThanOrEqual(6);
    expect(distinct(sigs.map((s) => s.layout))).toBeGreaterThanOrEqual(5);
    expect(distinct(sigs.map((s) => s.colour))).toBeGreaterThanOrEqual(3);
    expect(distinct(sigs.map((s) => s.motion))).toBeGreaterThanOrEqual(4);
    expect(distinct(sigs.map((s) => s.finish))).toBeGreaterThanOrEqual(3);
    expect(distinct(sigs.map((s) => s.scheme))).toBe(2);
  });

  it('keeps every photograph readable', () => {
    for (const name of PHOTOS) {
      const { palette } = themeOf(name);
      expect(contrastHex(palette.ink, palette.surface), name).toBeGreaterThanOrEqual(7);
      expect(contrastHex(palette.inkMuted, palette.surface), name).toBeGreaterThanOrEqual(4.5);
      expect(contrastHex(palette.onPrimary, palette.primary), name).toBeGreaterThanOrEqual(4.5);
      expect(contrastHex(palette.accent, palette.surface), name).toBeGreaterThanOrEqual(3);
      for (const pop of palette.pops) {
        expect(contrastHex(pop.on, pop.color), name).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
