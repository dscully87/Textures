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
import { synthesize } from '../synthesize';
import { DesignTokens } from '../tokens';
import { PHOTOS, PhotoName, loadPhoto } from './photos';

/** The categorical decisions a visitor would actually notice. */
function signature(tokens: DesignTokens) {
  return {
    font: tokens.typography.voice,
    layout: tokens.layout.archetype,
    finish: tokens.surface.finish,
    motion: tokens.motion.character,
    scheme: tokens.meta.sourceIsDark ? 'dark' : 'light',
    geometry: tokens.meta.geometry,
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

  // Known failure, recorded before the fix: every one of these photos currently
  // lands on the same one or two fonts, layouts and motion characters.
  it.fails('renders a lake and a graffiti wall as different products', () => {
    const lake = signature(themeOf('lake'));
    const graffiti = signature(themeOf('graffiti'));
    const differing = (Object.keys(lake) as (keyof typeof lake)[]).filter(
      (k) => lake[k] !== graffiti[k],
    );
    expect(lake.font).not.toBe(graffiti.font);
    expect(lake.layout).not.toBe(graffiti.layout);
    expect(differing.length).toBeGreaterThanOrEqual(4);
  });

  it.fails('spreads ten varied photographs across the design space', () => {
    const sigs = PHOTOS.map((name) => signature(themeOf(name)));
    expect(distinct(sigs.map((s) => s.font))).toBeGreaterThanOrEqual(5);
    expect(distinct(sigs.map((s) => s.layout))).toBeGreaterThanOrEqual(4);
    expect(distinct(sigs.map((s) => s.motion))).toBeGreaterThanOrEqual(4);
    expect(distinct(sigs.map((s) => s.finish))).toBeGreaterThanOrEqual(3);
  });
});
