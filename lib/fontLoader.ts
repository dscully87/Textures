/**
 * Load a pairing's faces before the page switches to them.
 *
 * Every family in the library is declared with `preload: false`, so nothing is
 * downloaded until a capture picks it. Switching `--font-heading` to a face the
 * browser hasn't fetched yet would flash the fallback mid-restyle; asking
 * `document.fonts` for it first — with a short cap so a slow network never
 * holds the capture hostage — keeps the swap to a single change.
 *
 * Browser-only.
 */

import { FONT_FAMILIES, PAIRING_BY_ID } from './fonts';
import { TypographyTokens } from './tokens';

/** next/font publishes hashed family names; the CSS variable is the source of truth. */
function resolvedFamily(cssVar: string): string | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  if (!value) return null;
  return value.split(',')[0].trim();
}

export async function loadPairing(typography: TypographyTokens, timeoutMs = 900): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const pairing = PAIRING_BY_ID.get(typography.pairing);
  if (!pairing) return;

  const requests: Array<Promise<unknown>> = [];
  const want = (key: keyof typeof FONT_FAMILIES, weight: number, italic = false) => {
    const family = resolvedFamily(FONT_FAMILIES[key].cssVar);
    if (family) requests.push(document.fonts.load(`${italic ? 'italic ' : ''}${weight} 1em ${family}`));
  };

  want(pairing.heading, pairing.headingWeight, pairing.italic);
  want(pairing.body, pairing.bodyWeight);
  want(pairing.body, 600);
  want(pairing.accent, 400);

  await Promise.race([
    Promise.allSettled(requests),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
