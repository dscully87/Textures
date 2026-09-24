/**
 * Layout archetypes: what *shape* of website a photograph becomes.
 *
 * The first version rendered one template for every capture and could only
 * recolour it. Each archetype here is a different page — a different hero, a
 * different way of presenting features, a different interlude and close — and
 * sits at a point in mood space, so a calm, airy, refined frame lands on a
 * quiet full-bleed page while a loud, packed, raw one lands on a poster.
 *
 * Pure data.
 */

import { MoodTarget } from './mood';
import {
  CtaVariant,
  FeaturesVariant,
  HeroVariant,
  InterludeVariant,
  LayoutArchetype,
  SectionPlan,
} from './tokens';

export interface ArchetypeSpec {
  id: LayoutArchetype;
  mood: MoodTarget;
  sections: SectionPlan;
  heroAlign: 'left' | 'center';
  featureColumns: 2 | 3 | 4;
  imageRatio: string;
}

export const ARCHETYPES: ArchetypeSpec[] = [
  {
    // Still water, open sky: one image, a lot of air, a single quiet line.
    id: 'serene',
    mood: { energy: 0.12, order: 0.6, density: 0.2, polish: 0.8 },
    sections: { hero: 'bleed', features: 'list', interlude: 'quote', cta: 'minimal' },
    heroAlign: 'center',
    featureColumns: 3,
    imageRatio: '16 / 9',
  },
  {
    // Weathered, warm, crafted: a magazine spread.
    id: 'editorial',
    mood: { energy: 0.45, warmth: 0.75, order: 0.45, density: 0.5, polish: 0.5 },
    sections: { hero: 'split', features: 'columns', interlude: 'quote', cta: 'banner' },
    heroAlign: 'left',
    featureColumns: 2,
    imageRatio: '4 / 5',
  },
  {
    // A vivid organic subject that *is* the content: image-led.
    id: 'gallery',
    mood: { energy: 0.62, order: 0.2, density: 0.55, polish: 0.4 },
    sections: { hero: 'mosaic', features: 'cards', interlude: 'strip', cta: 'minimal' },
    heroAlign: 'left',
    featureColumns: 3,
    imageRatio: '1 / 1',
  },
  {
    // Fine, dense, engineered detail: specs, rules and readouts.
    id: 'technical',
    mood: { energy: 0.6, warmth: 0.45, order: 0.5, density: 0.92, polish: 0.12 },
    sections: { hero: 'stack', features: 'spec', interlude: 'metrics', cta: 'banner' },
    heroAlign: 'left',
    featureColumns: 4,
    imageRatio: '4 / 3',
  },
  {
    // Concrete and right angles: giant type, hard edges, no decoration.
    id: 'brutalist',
    mood: { energy: 0.7, order: 0.9, density: 0.85, polish: 0.25 },
    sections: { hero: 'stack', features: 'bento', interlude: 'marquee', cta: 'poster' },
    heroAlign: 'left',
    featureColumns: 3,
    imageRatio: '3 / 2',
  },
  {
    // Glossy, rounded, playful: pills, blobs and bounce.
    id: 'soft',
    mood: { energy: 0.45, warmth: 0.65, order: 0.1, density: 0.2, polish: 0.88 },
    sections: { hero: 'minimal', features: 'bento', interlude: 'strip', cta: 'banner' },
    heroAlign: 'center',
    featureColumns: 3,
    imageRatio: '1 / 1',
  },
  {
    // Spray paint and paste-ups: a poster wall, stickers, a ticker.
    id: 'street',
    mood: { energy: 0.9, warmth: 0.75, order: 0.1, density: 0.9, polish: 0.2 },
    sections: { hero: 'poster', features: 'stickers', interlude: 'marquee', cta: 'poster' },
    heroAlign: 'left',
    featureColumns: 3,
    imageRatio: '4 / 5',
  },
];

export const ARCHETYPE_BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));

export const HERO_VARIANTS: HeroVariant[] = ['bleed', 'split', 'poster', 'minimal', 'mosaic', 'stack'];
export const FEATURES_VARIANTS: FeaturesVariant[] = ['list', 'columns', 'cards', 'stickers', 'bento', 'spec'];
export const INTERLUDE_VARIANTS: InterludeVariant[] = ['quote', 'marquee', 'metrics', 'strip'];
export const CTA_VARIANTS: CtaVariant[] = ['banner', 'minimal', 'poster'];
export const LAYOUT_ARCHETYPES: LayoutArchetype[] = ARCHETYPES.map((a) => a.id);
