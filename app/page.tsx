import { CameraCapture } from '@/components/CameraCapture';
import { GeneratedSite } from '@/components/GeneratedSite';
import { ThemeEngine } from '@/components/ThemeEngine';
import { ThemeInspector } from '@/components/ThemeInspector';
import { CaptureStatus } from '@/components/CaptureStatus';

export default function Home() {
  return (
    <ThemeEngine>
      {/* Decorative layers sit outside the flow: the mesh behind everything, the
          grain above everything. Both are driven purely by CSS variables. */}
      <div className="mesh" aria-hidden />
      <div className="grain" aria-hidden />

      <main className="relative mx-auto flex w-full max-w-[112rem] flex-col gap-8 px-4 py-8 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl">Textures</h1>
            <p className="mt-1 max-w-xl text-sm text-ink-muted">
              Photograph anything. Its colour, texture, mood and structure become a website — type,
              layout, palette and motion included — that you can export as a theme kit.
            </p>
          </div>
          <CaptureStatus />
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <CameraCapture />
            <ThemeInspector />
          </div>

          {/* overflow-clip, not overflow-hidden: a hidden-overflow box is a scroll
              container, and the site's scroll-driven motion would bind to it — a
              box that never scrolls — and sit at its end state, never playing. */}
          <div className="panel morph overflow-clip">
            <GeneratedSite />
          </div>
        </div>
      </main>
    </ThemeEngine>
  );
}
