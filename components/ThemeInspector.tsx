'use client';

/**
 * Instrumentation panel.
 *
 * A generative system that cannot explain itself is indistinguishable from a
 * random one. This panel shows the raw measurements, the roles the synthesizer
 * assigned, and the contrast ratios of the result — so a palette that looks
 * wrong can be traced back to the number that caused it.
 */

import { useEngine } from './ThemeEngine';
import { describeMood, paletteContrast } from '@/lib/synthesize';
import { MOOD_AXES } from '@/lib/mood';
import { Palette } from '@/lib/tokens';

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="metric w-28 shrink-0 text-ink-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="metric w-9 shrink-0 text-right tabular-nums text-ink-muted">{pct}</span>
    </div>
  );
}

type ColourRole = 'primary' | 'accent' | 'secondary' | 'surface' | 'surfaceAlt' | 'ink' | 'inkMuted' | 'border';

const ROLE_ORDER: Array<ColourRole & keyof Palette> = [
  'primary',
  'accent',
  'secondary',
  'surface',
  'surfaceAlt',
  'ink',
  'inkMuted',
  'border',
];

const MOOD_LABEL: Record<string, [string, string]> = {
  energy: ['calm', 'loud'],
  warmth: ['cool', 'warm'],
  order: ['organic', 'structured'],
  density: ['airy', 'packed'],
  polish: ['raw', 'refined'],
};

const ROLE_LABEL: Record<string, string> = {
  primary: 'primary',
  accent: 'accent',
  secondary: 'secondary',
  surface: 'surface',
  surfaceAlt: 'surface-alt',
  ink: 'ink',
  inkMuted: 'ink-muted',
  border: 'line',
};

export function ThemeInspector() {
  const { tokens, analysis, capture } = useEngine();
  const contrast = paletteContrast(tokens.palette);

  return (
    <aside className="panel morph flex flex-col gap-6 p-6" aria-label="Theme inspector">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg">Synthesis report</h2>
          <p className="mt-1 text-sm text-ink-muted">{tokens.meta.description}</p>
        </div>
        {capture && (
          <span className="metric shrink-0 rounded-full bg-accent/15 px-3 py-1 text-accent">
            {capture.elapsedMs.toFixed(0)}ms
          </span>
        )}
      </header>

      <section>
        <h3 className="metric mb-3 uppercase tracking-[0.14em] text-ink-muted">
          Mood — {describeMood(tokens.mood)}
        </h3>
        <div className="flex flex-col gap-2">
          {MOOD_AXES.map((axis) => (
            <div key={axis} className="flex items-center gap-3">
              <span className="metric w-16 shrink-0 text-ink-muted">{MOOD_LABEL[axis][0]}</span>
              <div className="relative h-1.5 flex-1 rounded-full bg-ink/10">
                <span
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-[left] duration-700 ease-out"
                  style={{ left: `${Math.round(tokens.mood[axis] * 100)}%` }}
                />
              </div>
              <span className="metric w-20 shrink-0 text-right text-ink-muted">{MOOD_LABEL[axis][1]}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="metric mb-3 uppercase tracking-[0.14em] text-ink-muted">
          Palette — {tokens.palette.strategy}
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {ROLE_ORDER.map((role) => (
            <div key={role} className="flex flex-col gap-1.5">
              <div
                className="swatch morph h-12 w-full"
                style={{ backgroundColor: tokens.palette[role] }}
                title={`${ROLE_LABEL[role]} — ${tokens.palette[role]}`}
              />
              <span className="metric truncate text-ink-muted">{ROLE_LABEL[role]}</span>
              <span className="metric truncate text-ink/70">{tokens.palette[role]}</span>
            </div>
          ))}
        </div>
        {tokens.palette.pops.length > 0 && (
          <div className="mt-3 flex gap-2">
            {tokens.palette.pops.map((pop, i) => (
              <span
                key={i}
                className="metric flex h-8 flex-1 items-center justify-center rounded-md"
                style={{ backgroundColor: pop.color, color: pop.on }}
                title={pop.color}
              >
                pop {i + 1}
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="metric mb-3 uppercase tracking-[0.14em] text-ink-muted">
          Contrast (WCAG AA needs 4.5)
        </h3>
        <dl className="grid grid-cols-3 gap-3">
          {[
            ['ink / surface', contrast.inkOnSurface, 7],
            ['muted / surface', contrast.mutedOnSurface, 4.5],
            ['label / primary', contrast.onPrimary, 4.5],
          ].map(([label, ratio, target]) => (
            <div key={label as string} className="rounded-md bg-ink/[0.04] p-3">
              <dt className="metric text-ink-muted">{label}</dt>
              <dd className="mt-1 flex items-baseline gap-1.5">
                <span className="metric text-base text-ink">{(ratio as number).toFixed(2)}</span>
                <span
                  className={`metric ${
                    (ratio as number) >= (target as number) ? 'text-accent' : 'text-primary'
                  }`}
                >
                  {(ratio as number) >= (target as number) ? 'pass' : 'low'}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {analysis && (
        <section>
          <h3 className="metric mb-3 uppercase tracking-[0.14em] text-ink-muted">Measurements</h3>
          <div className="flex flex-col gap-2">
            <Bar label="edge density" value={analysis.edges.density / 0.2} />
            <Bar label="orthogonality" value={analysis.edges.orthogonality} />
            <Bar label="orient. entropy" value={analysis.edges.orientationEntropy} />
            <Bar label="roughness" value={analysis.texture.roughness} />
            <Bar label="specularity" value={analysis.texture.specularity} />
            <Bar label="dynamic range" value={analysis.texture.dynamicRange} />
            <Bar label="colorfulness" value={analysis.colorfulness} />
            <Bar label="periodicity" value={analysis.periodicity.strength} />
            <Bar label="negative space" value={analysis.composition.calm} />
            <Bar label="banding" value={analysis.composition.banding} />
            <Bar label="hue families" value={analysis.colour.hueCount / 4} />
          </div>
        </section>
      )}

      <section>
        <h3 className="metric mb-3 uppercase tracking-[0.14em] text-ink-muted">Decisions</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            ['layout', tokens.layout.archetype],
            ['type', tokens.typography.label],
            ['sections', `${tokens.layout.sections.hero} · ${tokens.layout.sections.features}`],
            ['motion', `${tokens.motion.character} (${tokens.motion.tier})`],
            ['geometry', tokens.meta.geometry],
            ['radius unit', `${tokens.radius.unit}px`],
            ['finish', tokens.surface.finish],
            ['backdrop blur', `${tokens.surface.blur}px`],
            ['heading weight', String(tokens.typography.headingWeight)],
            ['tracking', `${tokens.typography.tracking}em`],
            ['space unit', `${tokens.space.unit}×`],
            ['motif', tokens.pattern.kind],
            ['motif pitch', tokens.pattern.kind === 'none' ? '—' : `${tokens.pattern.period}px`],
            ['grain', tokens.surface.grain.toFixed(3)],
            ['photo texture', tokens.texture.tileOpacity.toFixed(2)],
            ['confidence', `${Math.round(tokens.meta.confidence * 100)}%`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-2 border-b border-line/60 pb-1.5">
              <dt className="metric text-ink-muted">{label}</dt>
              <dd className="metric text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  );
}
