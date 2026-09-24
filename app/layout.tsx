import type { Metadata, Viewport } from 'next';
import {
  Anton,
  Archivo,
  Archivo_Black,
  Bodoni_Moda,
  Bungee,
  Cormorant_Garamond,
  DM_Sans,
  DM_Serif_Display,
  Fraunces,
  Fredoka,
  Instrument_Serif,
  Inter,
  Inter_Tight,
  JetBrains_Mono,
  Manrope,
  Nunito,
  Permanent_Marker,
  Space_Grotesk,
  Syne,
  Unbounded,
} from 'next/font/google';
import './globals.css';
import './site.css';

/*
 * The typography library (`lib/fonts.ts`), self-hosted through next/font.
 *
 * Only the resting page's faces are preloaded. Every other family is declared
 * with `preload: false`: its @font-face exists, but the browser downloads it
 * only when a capture actually selects it, and `lib/fontLoader.ts` fetches it
 * just before the switch so the restyle never flashes a fallback. Twenty
 * families cost the first paint nothing.
 *
 * The CSS variable names must match `FONT_FAMILIES[key].cssVar`.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter-src', display: 'swap' });
const interTight = Inter_Tight({ subsets: ['latin'], variable: '--font-inter-tight-src', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-src', display: 'swap' });

const grotesk = Space_Grotesk({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-grotesk-src' });
const fraunces = Fraunces({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-serif-src', axes: ['SOFT', 'WONK'] });
const instrument = Instrument_Serif({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-instrument-src', weight: '400', style: ['normal', 'italic'] });
const cormorant = Cormorant_Garamond({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-cormorant-src', style: ['normal', 'italic'] });
const bodoni = Bodoni_Moda({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-bodoni-src', style: ['normal', 'italic'] });
const dmSerif = DM_Serif_Display({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-dm-serif-src', weight: '400', style: ['normal', 'italic'] });
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-dm-sans-src' });
const fredoka = Fredoka({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-fredoka-src' });
const nunito = Nunito({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-rounded-src' });
const syne = Syne({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-syne-src' });
const unbounded = Unbounded({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-unbounded-src' });
const manrope = Manrope({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-manrope-src' });
const archivo = Archivo({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-archivo-src', axes: ['wdth'] });
const archivoBlack = Archivo_Black({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-archivo-black-src', weight: '400' });
const anton = Anton({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-anton-src', weight: '400' });
const bungee = Bungee({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-bungee-src', weight: '400' });
const marker = Permanent_Marker({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-marker-src', weight: '400' });

const fontVariables = [
  inter,
  interTight,
  mono,
  grotesk,
  fraunces,
  instrument,
  cormorant,
  bodoni,
  dmSerif,
  dmSans,
  fredoka,
  nunito,
  syne,
  unbounded,
  manrope,
  archivo,
  archivoBlack,
  anton,
  bungee,
  marker,
]
  .map((f) => f.variable)
  .join(' ');

export const metadata: Metadata = {
  title: 'Textures — a website that becomes what you photograph',
  description:
    'Photograph anything and get a website that feels like it — colour, texture, typography, layout and motion read from a single picture.',
};

export const viewport: Viewport = {
  themeColor: '#0b0c10',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
