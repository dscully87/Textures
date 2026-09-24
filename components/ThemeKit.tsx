'use client';

/**
 * Take the theme home: a zip of CSS, a Tailwind theme, design tokens and a
 * README, or just the CSS on the clipboard.
 */

import { useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import { slug, themeCss, themeKit } from '@/lib/export';
import { useEngine } from './ThemeEngine';

export function ThemeKitActions() {
  const { tokens } = useEngine();
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  const download = () => {
    const name = `${slug(tokens.copy.brand)}-theme`;
    const zip = zipSync(
      Object.fromEntries(themeKit(tokens).map((f) => [`${name}/${f.name}`, strToU8(f.content)])),
    );
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.zip`;
    link.click();
    // The click has handed the URL to the download; release it after.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(themeCss(tokens));
      setCopied('done');
    } catch {
      // Clipboard access is refused on insecure origins and in some embeds.
      setCopied('failed');
    }
    setTimeout(() => setCopied('idle'), 2000);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary" onClick={download}>
        Download theme kit
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => void copy()} aria-live="polite">
        {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy blocked' : 'Copy CSS'}
      </button>
    </div>
  );
}
