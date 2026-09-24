/**
 * Placeholder copy, written per layout archetype.
 *
 * The generated site used to talk about the engine that generated it — every
 * capture said "this page is wearing whatever you point at it". A page reads as
 * a product in its own right only when its words carry the same mood as its
 * type and colour, so each archetype gets a voice of its own. With the Gemini
 * layer switched on, the model writes copy for the actual subject and this is
 * the offline fallback.
 *
 * Pure data.
 */

import { LayoutArchetype } from './tokens';

export interface SiteCopy {
  brand: string;
  nav: string[];
  eyebrow: string;
  headline: string;
  /** Optional emphasised tail of the headline, set in the accent treatment. */
  headlineAccent: string;
  lede: string;
  primaryAction: string;
  secondaryAction: string;
  features: { title: string; body: string }[];
  quote: { text: string; attribution: string };
  /** Short words or phrases for tickers and sticker labels. */
  tags: string[];
  metrics: { value: string; label: string }[];
  closing: { headline: string; body: string; action: string };
  footer: string;
}

export const ARCHETYPE_COPY: Record<LayoutArchetype, SiteCopy> = {
  serene: {
    brand: 'Stillwater',
    nav: ['Journal', 'Retreats', 'About'],
    eyebrow: 'A slower kind of studio',
    headline: 'Room to think,',
    headlineAccent: 'and nothing else.',
    lede: 'We design quiet places — on paper, on screen and on the ground — for people who have had enough of noise.',
    primaryAction: 'Plan a visit',
    secondaryAction: 'Read the journal',
    features: [
      { title: 'Unhurried', body: 'Every project starts with a week of listening before a single line is drawn.' },
      { title: 'Considered', body: 'Fewer things, chosen carefully, made to last longer than the brief.' },
      { title: 'Open', body: 'Light, air and water shape the work as much as any client does.' },
    ],
    quote: { text: 'The most restful thing they made for us was the space they left empty.', attribution: 'A returning guest' },
    tags: ['calm', 'clear', 'open', 'slow'],
    metrics: [
      { value: '12', label: 'retreats a year' },
      { value: '4', label: 'people in the studio' },
      { value: '0', label: 'notifications' },
    ],
    closing: { headline: 'Come and see it in person.', body: 'Visits run from spring through to the first frost.', action: 'Book a visit' },
    footer: 'Made slowly, on purpose.',
  },
  editorial: {
    brand: 'Hearth & Grain',
    nav: ['Stories', 'Makers', 'Shop', 'Visit'],
    eyebrow: 'Issue 14 — The Material Issue',
    headline: 'Things made by hand',
    headlineAccent: 'still hold their warmth.',
    lede: 'A journal and small shop for crafts that age well: stone, clay, oak and linen, and the people patient enough to work them.',
    primaryAction: 'Read the issue',
    secondaryAction: 'Browse the shop',
    features: [
      { title: 'The long view', body: 'We profile makers who measure their work in decades, not seasons — and ask what they would do differently.' },
      { title: 'Honest materials', body: 'Nothing coated, nothing faked. If it is oak, it is oak all the way through, and it will show its years.' },
    ],
    quote: { text: 'A good object gets better every time someone uses it.', attribution: 'Stonemason, fourth generation' },
    tags: ['craft', 'stone', 'oak', 'clay', 'linen'],
    metrics: [
      { value: '48', label: 'makers profiled' },
      { value: '14', label: 'issues in print' },
      { value: '1', label: 'workshop, open Saturdays' },
    ],
    closing: { headline: 'Subscribe to the printed edition.', body: 'Four issues a year, posted in recycled card.', action: 'Subscribe' },
    footer: 'Printed on paper that will outlast us.',
  },
  gallery: {
    brand: 'Chromatic',
    nav: ['Collection', 'Artists', 'Visit'],
    eyebrow: 'Now showing',
    headline: 'Colour you can',
    headlineAccent: 'feel from across the room.',
    lede: 'A gallery for work that refuses to sit quietly on a wall — vivid, living and impossible to ignore.',
    primaryAction: 'See the collection',
    secondaryAction: 'Plan your visit',
    features: [
      { title: 'Vivid', body: 'Pieces chosen for colour first and argued about afterwards.' },
      { title: 'Alive', body: 'Organic forms, natural pigments and subjects that look back at you.' },
      { title: 'Up close', body: 'Every piece is hung low enough to see the brushwork.' },
    ],
    quote: { text: 'I came for twenty minutes and stayed until they turned the lights off.', attribution: 'Visitor book, March' },
    tags: ['vivid', 'wild', 'living', 'bold'],
    metrics: [
      { value: '120', label: 'works on show' },
      { value: '31', label: 'artists' },
      { value: '7', label: 'rooms' },
    ],
    closing: { headline: 'Open late on Thursdays.', body: 'Free entry after six, with music in the main hall.', action: 'Get tickets' },
    footer: 'Please do touch the colour. Not the paint.',
  },
  technical: {
    brand: 'Tracewire',
    nav: ['Platform', 'Docs', 'Pricing', 'Status'],
    eyebrow: 'v4.2 — now shipping',
    headline: 'Infrastructure with',
    headlineAccent: 'every connection accounted for.',
    lede: 'Observability for systems too dense to draw on a whiteboard. Every signal traced, every dependency mapped, every change on the record.',
    primaryAction: 'Start building',
    secondaryAction: 'Read the docs',
    features: [
      { title: 'Traced', body: 'Every request followed end to end across services, queues and regions.' },
      { title: 'Mapped', body: 'Dependencies drawn from live traffic, not from what the wiki claims.' },
      { title: 'Audited', body: 'Configuration changes versioned, signed and diffable.' },
      { title: 'Fast', body: 'Sub-second queries over a month of high-cardinality data.' },
    ],
    quote: { text: 'We found the bottleneck in eleven minutes. It had been there for two years.', attribution: 'Platform lead, logistics company' },
    tags: ['latency', 'traces', 'uptime', 'signals', 'diffs'],
    metrics: [
      { value: '99.99%', label: 'ingest availability' },
      { value: '<400ms', label: 'p95 query time' },
      { value: '2.1B', label: 'spans per day' },
    ],
    closing: { headline: 'Instrument your first service in five minutes.', body: 'Free up to ten million spans a month. No card required.', action: 'Create an account' },
    footer: 'All systems operational.',
  },
  brutalist: {
    brand: 'MONOLITH',
    nav: ['WORK', 'STUDIO', 'CONTACT'],
    eyebrow: 'Architecture / Structure / Form',
    headline: 'Built to stand',
    headlineAccent: 'for a hundred years.',
    lede: 'An architecture practice that believes in mass, honesty and the beauty of concrete left exactly as it was poured.',
    primaryAction: 'View projects',
    secondaryAction: 'Contact the studio',
    features: [
      { title: 'Mass', body: 'Buildings with weight — thermal, visual and civic.' },
      { title: 'Honesty', body: 'Structure on show. No cladding pretending to be something else.' },
      { title: 'Permanence', body: 'Designed for a century of use, not a decade of fashion.' },
    ],
    quote: { text: 'Form follows load.', attribution: 'Studio principle no. 1' },
    tags: ['CONCRETE', 'STEEL', 'GLASS', 'GRID', 'MASS'],
    metrics: [
      { value: '37', label: 'buildings standing' },
      { value: '1974', label: 'founded' },
      { value: '0', label: 'demolished' },
    ],
    closing: { headline: 'HAVE A SITE? TALK TO US.', body: 'Public, cultural and residential commissions.', action: 'START A PROJECT' },
    footer: 'Poured in place.',
  },
  soft: {
    brand: 'Sugarcube',
    nav: ['Flavours', 'Gifts', 'Find us'],
    eyebrow: 'Small-batch, big smiles',
    headline: 'Tiny treats,',
    headlineAccent: 'very serious joy.',
    lede: 'Hand-made sweets in colours that should not exist in nature — and flavours that absolutely should.',
    primaryAction: 'Pick a box',
    secondaryAction: 'Find a shop',
    features: [
      { title: 'Bright', body: 'Natural colours, turned all the way up.' },
      { title: 'Round', body: 'Everything is bite-sized, and nothing has sharp edges.' },
      { title: 'Shareable', body: 'Boxes built for passing around the whole table.' },
    ],
    quote: { text: 'My kids now rate every shop by how much it looks like this one.', attribution: 'Happy customer' },
    tags: ['sweet', 'bright', 'round', 'fizzy', 'fun'],
    metrics: [
      { value: '36', label: 'flavours' },
      { value: '9', label: 'colours' },
      { value: '∞', label: 'smiles' },
    ],
    closing: { headline: 'Build your own box.', body: 'Pick any twelve. We will tie the ribbon.', action: 'Start a box' },
    footer: 'Made with sugar and good intentions.',
  },
  street: {
    brand: 'WALLSPACE',
    nav: ['DROPS', 'ARTISTS', 'EVENTS'],
    eyebrow: 'Live from the underpass',
    headline: 'Loud by design.',
    headlineAccent: 'Never by accident.',
    lede: 'Murals, drops and block parties from the crews repainting the city — one wall at a time, all of it in the open.',
    primaryAction: 'Get the drop',
    secondaryAction: 'Meet the crews',
    features: [
      { title: 'Raw', body: 'Straight off the wall — no filters, no permission slips.' },
      { title: 'Loud', body: 'Colours picked to be seen from a moving train.' },
      { title: 'Local', body: 'Every piece painted within a mile of where you are standing.' },
    ],
    quote: { text: 'If the city is a canvas, we are just finishing the job.', attribution: 'Crew statement' },
    tags: ['SPRAY', 'PASTE-UP', 'TAG', 'THROW-UP', 'BLOCK PARTY', 'FRESH PAINT'],
    metrics: [
      { value: '212', label: 'walls painted' },
      { value: '40+', label: 'crews' },
      { value: '24/7', label: 'open air' },
    ],
    closing: { headline: 'Next jam: this Saturday.', body: 'Bring a crew, bring a can, bring a friend.', action: 'Put me on the list' },
    footer: 'Paint wet. Touch anyway.',
  },
};

/** Shown before any capture: the resting page explains the product itself. */
export const RESTING_COPY: SiteCopy = {
  brand: 'Textures',
  nav: ['How it works', 'Theme kit', 'About'],
  eyebrow: 'Waiting for a photograph',
  headline: 'Photograph anything.',
  headlineAccent: 'Get a website that feels like it.',
  lede: 'Colour, texture, type, layout and motion — all read from a single picture. A still lake and a graffiti wall become two completely different sites.',
  primaryAction: 'Take a photo',
  secondaryAction: 'Upload one',
  features: [
    { title: 'Mood, measured', body: 'Busyness, warmth, structure, density and polish are measured from the pixels and drive every decision.' },
    { title: 'Type that fits', body: 'A curated library of type pairings, from a quiet serif to a condensed poster face.' },
    { title: 'Real layouts', body: 'Seven page structures, not one template in seven colours.' },
  ],
  quote: { text: 'The page should feel like the picture before you can say why.', attribution: 'Design principle' },
  tags: ['colour', 'texture', 'type', 'layout', 'motion'],
  metrics: [
    { value: '5', label: 'mood axes' },
    { value: '14', label: 'type pairings' },
    { value: '7', label: 'layouts' },
  ],
  closing: { headline: 'Point the camera at something.', body: 'Or drop a photo anywhere on the capture panel.', action: 'Capture' },
  footer: 'Visual-first website engine.',
};
