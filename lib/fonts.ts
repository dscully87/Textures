/**
 * The typography library.
 *
 * Four voices chosen from edge geometry gave every photograph one of two fonts.
 * This is a curated set of pairings, each placed in mood space and tagged with
 * the layouts it belongs in; the synthesizer picks the nearest pairing that
 * suits the chosen layout, so a street poster never gets a wedding-invitation
 * serif and a still lake never gets a condensed shout.
 *
 * Every family here is declared in `app/layout.tsx` through next/font with
 * `preload: false`: self-hosted, and downloaded only when a capture actually
 * uses it. Pure data — no DOM, no network.
 */

import { LayoutArchetype } from './tokens';
import { MoodTarget } from './mood';

export type FontKey =
  | 'inter'
  | 'interTight'
  | 'spaceGrotesk'
  | 'jetbrainsMono'
  | 'fraunces'
  | 'instrumentSerif'
  | 'cormorant'
  | 'bodoni'
  | 'dmSerif'
  | 'dmSans'
  | 'fredoka'
  | 'nunito'
  | 'syne'
  | 'unbounded'
  | 'manrope'
  | 'archivo'
  | 'archivoBlack'
  | 'anton'
  | 'bungee'
  | 'permanentMarker';

export interface FontFamily {
  /** Google Fonts family name — also what the exported theme kit imports. */
  name: string;
  /** CSS variable next/font publishes the self-hosted family under. */
  cssVar: string;
  fallback: string;
  /** Google Fonts CSS2 axis spec for the exported kit, e.g. `wght@300..700`. */
  google: string;
}

const SANS = 'ui-sans-serif, system-ui, sans-serif';
const SERIF = 'ui-serif, Georgia, serif';
const MONO = 'ui-monospace, SFMono-Regular, monospace';

export const FONT_FAMILIES: Record<FontKey, FontFamily> = {
  inter: { name: 'Inter', cssVar: '--font-inter-src', fallback: SANS, google: 'wght@300..800' },
  interTight: { name: 'Inter Tight', cssVar: '--font-inter-tight-src', fallback: SANS, google: 'wght@400..900' },
  spaceGrotesk: { name: 'Space Grotesk', cssVar: '--font-grotesk-src', fallback: SANS, google: 'wght@300..700' },
  jetbrainsMono: { name: 'JetBrains Mono', cssVar: '--font-mono-src', fallback: MONO, google: 'wght@400..800' },
  fraunces: { name: 'Fraunces', cssVar: '--font-serif-src', fallback: SERIF, google: 'opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1' },
  instrumentSerif: { name: 'Instrument Serif', cssVar: '--font-instrument-src', fallback: SERIF, google: 'ital@0;1' },
  cormorant: { name: 'Cormorant Garamond', cssVar: '--font-cormorant-src', fallback: SERIF, google: 'ital,wght@0,300..700;1,300..700' },
  bodoni: { name: 'Bodoni Moda', cssVar: '--font-bodoni-src', fallback: SERIF, google: 'ital,opsz,wght@0,6..96,400..900;1,6..96,400..900' },
  dmSerif: { name: 'DM Serif Display', cssVar: '--font-dm-serif-src', fallback: SERIF, google: 'ital@0;1' },
  dmSans: { name: 'DM Sans', cssVar: '--font-dm-sans-src', fallback: SANS, google: 'opsz,wght@9..40,300..800' },
  fredoka: { name: 'Fredoka', cssVar: '--font-fredoka-src', fallback: 'ui-rounded, system-ui, sans-serif', google: 'wght@300..700' },
  nunito: { name: 'Nunito', cssVar: '--font-rounded-src', fallback: 'ui-rounded, system-ui, sans-serif', google: 'wght@300..900' },
  syne: { name: 'Syne', cssVar: '--font-syne-src', fallback: SANS, google: 'wght@400..800' },
  unbounded: { name: 'Unbounded', cssVar: '--font-unbounded-src', fallback: SANS, google: 'wght@300..900' },
  manrope: { name: 'Manrope', cssVar: '--font-manrope-src', fallback: SANS, google: 'wght@300..800' },
  archivo: { name: 'Archivo', cssVar: '--font-archivo-src', fallback: SANS, google: 'wdth,wght@62..125,300..900' },
  archivoBlack: { name: 'Archivo Black', cssVar: '--font-archivo-black-src', fallback: SANS, google: '' },
  anton: { name: 'Anton', cssVar: '--font-anton-src', fallback: 'Impact, ' + SANS, google: '' },
  bungee: { name: 'Bungee', cssVar: '--font-bungee-src', fallback: SANS, google: '' },
  permanentMarker: { name: 'Permanent Marker', cssVar: '--font-marker-src', fallback: 'cursive', google: '' },
};

/** A CSS font-family value that resolves to the self-hosted face. */
export function fontStack(key: FontKey): string {
  const f = FONT_FAMILIES[key];
  return `var(${f.cssVar}), ${f.fallback}`;
}

export interface FontPairing {
  id: string;
  /** One line on the register it strikes — read by the model and shown in the inspector. */
  description: string;
  heading: FontKey;
  body: FontKey;
  /** Stickers, eyebrows, labels, marquees — the "third voice". */
  accent: FontKey;
  headingWeight: number;
  bodyWeight: number;
  /** Heading letter-spacing in em. */
  tracking: number;
  leading: number;
  /** Multiplier on the display type scale. */
  scale: number;
  uppercase: boolean;
  /** Italic headings (and italic emphasis spans) — a serif's quietest register. */
  italic: boolean;
  /** Layouts this pairing belongs in. The first listed is its home layout. */
  layouts: LayoutArchetype[];
  mood: MoodTarget;
}

export const FONT_PAIRINGS: FontPairing[] = [
  {
    id: 'still-serif',
    description: 'hushed, airy editorial serif with italic accents; still water, fog, open sky',
    heading: 'instrumentSerif', body: 'inter', accent: 'instrumentSerif',
    headingWeight: 400, bodyWeight: 300, tracking: -0.01, leading: 1.75, scale: 1.12,
    uppercase: false, italic: true,
    layouts: ['serene', 'editorial', 'gallery'],
    mood: { energy: 0.12, warmth: 0.45, density: 0.2, polish: 0.85 },
  },
  {
    id: 'old-style',
    description: 'classical Garamond; stone, candlelight, history, craft',
    heading: 'cormorant', body: 'manrope', accent: 'cormorant',
    headingWeight: 500, bodyWeight: 400, tracking: -0.005, leading: 1.7, scale: 1.14,
    uppercase: false, italic: false,
    layouts: ['serene', 'editorial'],
    mood: { energy: 0.15, warmth: 0.6, order: 0.5, density: 0.45, polish: 0.55 },
  },
  {
    id: 'couture',
    description: 'high-contrast Didone; luxury, fashion, polished and precise',
    heading: 'bodoni', body: 'inter', accent: 'bodoni',
    headingWeight: 500, bodyWeight: 400, tracking: -0.02, leading: 1.65, scale: 1.1,
    uppercase: false, italic: true,
    layouts: ['serene', 'editorial', 'gallery'],
    mood: { energy: 0.35, order: 0.7, density: 0.3, polish: 0.9 },
  },
  {
    id: 'soft-serif',
    description: 'warm, soft-edged serif; food, wood, handmade, friendly print',
    heading: 'fraunces', body: 'inter', accent: 'fraunces',
    headingWeight: 600, bodyWeight: 400, tracking: -0.015, leading: 1.7, scale: 1.06,
    uppercase: false, italic: false,
    layouts: ['editorial', 'soft', 'gallery'],
    mood: { energy: 0.45, warmth: 0.8, order: 0.35, polish: 0.5 },
  },
  {
    id: 'display-serif',
    description: 'bold display serif; vivid, confident, gallery and magazine covers',
    heading: 'dmSerif', body: 'dmSans', accent: 'dmSans',
    headingWeight: 400, bodyWeight: 400, tracking: -0.02, leading: 1.65, scale: 1.1,
    uppercase: false, italic: false,
    layouts: ['editorial', 'gallery'],
    mood: { energy: 0.6, warmth: 0.7, order: 0.25, density: 0.6, polish: 0.35 },
  },
  {
    id: 'rounded',
    description: 'rounded and bubbly; sweets, toys, playful and glossy',
    heading: 'fredoka', body: 'nunito', accent: 'fredoka',
    headingWeight: 600, bodyWeight: 500, tracking: -0.01, leading: 1.7, scale: 1.02,
    uppercase: false, italic: false,
    layouts: ['soft'],
    mood: { energy: 0.5, warmth: 0.65, polish: 0.85 },
  },
  {
    id: 'expressive',
    description: 'wide, quirky grotesk; art, culture, contemporary and a little odd',
    heading: 'syne', body: 'manrope', accent: 'syne',
    headingWeight: 700, bodyWeight: 400, tracking: -0.03, leading: 1.6, scale: 1.04,
    uppercase: false, italic: false,
    layouts: ['gallery', 'soft', 'technical'],
    mood: { energy: 0.65, warmth: 0.4, order: 0.4, polish: 0.5 },
  },
  {
    id: 'swiss',
    description: 'tight neo-grotesk; neutral, precise, product and interface',
    heading: 'interTight', body: 'inter', accent: 'jetbrainsMono',
    headingWeight: 650, bodyWeight: 400, tracking: -0.035, leading: 1.6, scale: 1,
    uppercase: false, italic: false,
    layouts: ['technical', 'serene', 'editorial', 'brutalist'],
    mood: { energy: 0.4, order: 0.75, polish: 0.7 },
  },
  {
    id: 'grotesk',
    description: 'geometric grotesk with mono labels; engineering, hardware, industrial',
    heading: 'spaceGrotesk', body: 'inter', accent: 'jetbrainsMono',
    headingWeight: 600, bodyWeight: 400, tracking: -0.03, leading: 1.55, scale: 1,
    uppercase: false, italic: false,
    layouts: ['technical', 'brutalist'],
    mood: { energy: 0.55, warmth: 0.4, order: 0.6, density: 0.75, polish: 0.35 },
  },
  {
    id: 'terminal',
    description: 'monospace headlines; circuits, code, data, dense technical detail',
    heading: 'jetbrainsMono', body: 'inter', accent: 'jetbrainsMono',
    headingWeight: 700, bodyWeight: 400, tracking: -0.04, leading: 1.55, scale: 0.92,
    uppercase: false, italic: false,
    layouts: ['technical'],
    mood: { energy: 0.7, warmth: 0.45, density: 0.95, polish: 0.08 },
  },
  {
    id: 'wide',
    description: 'extended geometric sans; architectural, bold, confident and modern',
    heading: 'unbounded', body: 'manrope', accent: 'unbounded',
    headingWeight: 700, bodyWeight: 400, tracking: -0.03, leading: 1.6, scale: 0.9,
    uppercase: false, italic: false,
    layouts: ['brutalist', 'gallery', 'soft'],
    mood: { energy: 0.75, warmth: 0.5, order: 0.6, polish: 0.5 },
  },
  {
    id: 'slab-block',
    description: 'heavy uppercase block type; concrete, structure, brutalist weight',
    heading: 'archivoBlack', body: 'archivo', accent: 'jetbrainsMono',
    headingWeight: 400, bodyWeight: 400, tracking: -0.02, leading: 1.5, scale: 1.02,
    uppercase: true, italic: false,
    layouts: ['brutalist', 'street'],
    mood: { energy: 0.7, order: 0.9, density: 0.85, polish: 0.28 },
  },
  {
    id: 'poster',
    description: 'condensed uppercase poster type with marker accents; graffiti, street, protest, loud',
    heading: 'anton', body: 'archivo', accent: 'permanentMarker',
    headingWeight: 400, bodyWeight: 500, tracking: 0.005, leading: 1.5, scale: 1.3,
    uppercase: true, italic: false,
    layouts: ['street', 'brutalist'],
    mood: { energy: 0.9, warmth: 0.7, order: 0.15, density: 0.9, polish: 0.2 },
  },
  {
    id: 'signage',
    description: 'chunky signage caps; arcades, neon, pop, fun and loud',
    heading: 'bungee', body: 'dmSans', accent: 'bungee',
    headingWeight: 400, bodyWeight: 500, tracking: 0, leading: 1.6, scale: 0.9,
    uppercase: true, italic: false,
    layouts: ['street', 'soft'],
    mood: { energy: 0.85, warmth: 0.8, order: 0.3, density: 0.7, polish: 0.45 },
  },
];

export const PAIRING_BY_ID = new Map(FONT_PAIRINGS.map((p) => [p.id, p]));

/** The pairing shown before any capture. */
export const DEFAULT_PAIRING = PAIRING_BY_ID.get('swiss')!;

/** Google Fonts CSS2 URL covering every family a pairing uses — for the theme kit. */
export function googleFontsUrl(pairing: FontPairing): string {
  const keys = [...new Set([pairing.heading, pairing.body, pairing.accent])];
  const families = keys.map((k) => {
    const f = FONT_FAMILIES[k];
    const name = f.name.replace(/ /g, '+');
    return f.google ? `family=${name}:${f.google}` : `family=${name}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}
