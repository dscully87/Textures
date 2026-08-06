'use client';

/**
 * Capture surface: live camera where it is available, file upload everywhere.
 *
 * The uploader is not a degraded path — it is always mounted and always works.
 * getUserMedia fails for a long list of ordinary reasons (no camera, denied
 * permission, insecure origin, another app holding the device), and in every
 * one of those cases the user should still be one tap from a result.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngine } from './ThemeEngine';

type CameraState = 'idle' | 'starting' | 'live' | 'unavailable';

const FACING: Array<'environment' | 'user'> = ['environment', 'user'];

function describeCameraError(err: unknown): string {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission was declined. You can still upload a photo.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No camera found on this device. Upload a photo instead.';
      case 'NotReadableError':
        return 'The camera is already in use by another app.';
      default:
        return `Camera unavailable (${err.name}). Upload a photo instead.`;
    }
  }
  return 'Camera unavailable on this device. Upload a photo instead.';
}

export function CameraCapture() {
  const { ingest, ingestFile, status } = useEngine();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingIndex, setFacingIndex] = useState(0);
  const [dragging, setDragging] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(
    async (facing: 'environment' | 'user') => {
      // Secure-context check first: on plain http the API is simply absent, and
      // a generic "permission denied" would be a misleading thing to show.
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraState('unavailable');
        setCameraError(
          typeof window !== 'undefined' && !window.isSecureContext
            ? 'Camera access needs HTTPS (or localhost). Upload a photo instead.'
            : 'This browser does not expose a camera API. Upload a photo instead.',
        );
        return;
      }

      setCameraState('starting');
      setCameraError(null);
      stopCamera();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          // Unmounted while the permission prompt was open.
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        setCameraState('live');
      } catch (err) {
        setCameraState('unavailable');
        setCameraError(describeCameraError(err));
      }
    },
    [stopCamera],
  );

  useEffect(() => stopCamera, [stopCamera]);

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    await ingest(video);
  }, [ingest]);

  const flip = useCallback(() => {
    const next = (facingIndex + 1) % FACING.length;
    setFacingIndex(next);
    void startCamera(FACING[next]);
  }, [facingIndex, startCamera]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void ingestFile(file);
    },
    [ingestFile],
  );

  const busy = status === 'processing';

  return (
    <section
      className="panel patterned morph overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      aria-label="Capture"
    >
      {/* The viewfinder backdrop is token-driven so it sits inside the generated
          theme rather than punching a grey hole through a light one. */}
      <div className="morph relative aspect-[4/3] w-full overflow-hidden bg-surface-alt">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover transition-opacity duration-500 ${
            cameraState === 'live' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {cameraState !== 'live' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div
              className="morph flex size-14 items-center justify-center bg-primary/15 text-primary"
              style={{ borderRadius: 'var(--radius-lg)' }}
              aria-hidden
            >
              <CameraGlyph />
            </div>
            <p className="max-w-xs text-sm text-ink-muted">
              {cameraError ?? 'Point the camera at an object — the site becomes it.'}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void startCamera(FACING[facingIndex])}
              disabled={cameraState === 'starting'}
            >
              {cameraState === 'starting' ? 'Requesting camera…' : 'Enable camera'}
            </button>
          </div>
        )}

        {dragging && (
          <div className="absolute inset-0 flex items-center justify-center border-2 border-dashed border-accent bg-surface/70 text-sm font-medium text-accent">
            Drop the photo to synthesize
          </div>
        )}

        {busy && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-white/10">
            <div className="h-full w-1/3 animate-[scan_1s_ease-in-out_infinite] bg-accent" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 p-5">
        <button
          type="button"
          className="btn btn-primary flex-1"
          onClick={() => void shoot()}
          disabled={cameraState !== 'live' || busy}
        >
          {busy ? 'Synthesizing…' : 'Capture'}
        </button>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          Upload
        </button>

        {cameraState === 'live' && (
          <button type="button" className="btn btn-ghost" onClick={flip} aria-label="Switch camera">
            Flip
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          // `capture` asks a phone to open the camera app directly, which is the
          // most reliable capture path on mobile Safari.
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void ingestFile(file);
            // Reset so re-picking the same file fires change again.
            e.target.value = '';
          }}
        />
      </div>
    </section>
  );
}

function CameraGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.1-1.8A1 1 0 0 1 9.2 3.7h5.6a1 1 0 0 1 .9.5L16.8 6h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </svg>
  );
}
