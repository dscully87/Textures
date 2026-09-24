'use client';

/**
 * Small shared pieces of the generated site.
 *
 * Everything here reads colour, type and radius from CSS variables, so a
 * restyle never needs these components to re-render; only a change of
 * *structure* (a different section variant) does.
 */

import { SiteCopy } from '@/lib/copy';

/**
 * The capture as an image, or a palette-coloured placeholder before there is
 * one. `position` picks a crop, so one photograph can fill several frames
 * without repeating itself.
 */
export function Photo({
  src,
  position = '50% 50%',
  className = '',
  alt = '',
}: {
  src?: string | null;
  position?: string;
  className?: string;
  alt?: string;
}) {
  if (!src) return <div className={`photo photo-fallback ${className}`} aria-hidden />;
  // Object URLs of unknown dimensions: next/image would add a round trip and a
  // layout guess for nothing, so a plain <img> is the right tool.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={`photo ${className}`} style={{ objectPosition: position }} />;
}

/** Headline with its emphasised tail set in the accent treatment. */
export function Headline({
  copy,
  as: Tag = 'h1',
  className = '',
}: {
  copy: SiteCopy;
  as?: 'h1' | 'h2';
  className?: string;
}) {
  return (
    <Tag className={`headline ${className}`}>
      {copy.headline}
      {copy.headlineAccent && (
        <>
          {' '}
          <em className="headline-accent">{copy.headlineAccent}</em>
        </>
      )}
    </Tag>
  );
}

export function Actions({ copy, className = '' }: { copy: SiteCopy; className?: string }) {
  return (
    <div className={`actions ${className}`}>
      <button type="button" className="btn btn-primary">
        {copy.primaryAction}
      </button>
      <button type="button" className="btn btn-ghost">
        {copy.secondaryAction}
      </button>
    </div>
  );
}

/** Crops spread across the frame, for mosaics, cards and strips. */
export const CROPS = ['30% 35%', '75% 25%', '55% 75%', '15% 80%', '85% 70%', '50% 50%'];

export const pad = (n: number) => String(n + 1).padStart(2, '0');
