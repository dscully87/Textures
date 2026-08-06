import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter, JetBrains_Mono, Nunito, Space_Grotesk } from 'next/font/google';
import './globals.css';

/*
 * Four display voices plus a mono, loaded once and switched between by CSS
 * variable. The synthesizer picks a voice from the subject's geometry, so all
 * five need to be resident before the first capture — swapping a font family
 * after analysis would otherwise cost a network round trip in the middle of the
 * restyle.
 */
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans-src',
  display: 'swap',
});

const grotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-grotesk-src',
  display: 'swap',
});

const serif = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif-src',
  display: 'swap',
  axes: ['SOFT', 'WONK'],
});

const rounded = Nunito({
  subsets: ['latin'],
  variable: '--font-rounded-src',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-src',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Textures — a website that becomes what you photograph',
  description:
    'Point a camera at an object and the interface restyles itself from its color, material, geometry and motif — a visual-first dynamic CSS and React engine.',
};

export const viewport: Viewport = {
  themeColor: '#0b0c10',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${grotesk.variable} ${serif.variable} ${rounded.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
