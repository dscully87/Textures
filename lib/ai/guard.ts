/**
 * Request guards for the model route.
 *
 * The route spends the owner's API key, so it has to refuse three things: calls
 * from other sites, more calls than a person could plausibly make, and payloads
 * that aren't what our own client sends. Pure and dependency-free, so each guard
 * is tested without a server.
 */

/** Largest image the route accepts, in decoded bytes. A 512px JPEG is ~40–120 KB. */
export const MAX_IMAGE_BYTES = 350_000;

/** Largest request body, in characters — the base64 image plus the measurements. */
export const MAX_BODY_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 20_000;

/**
 * Same-origin only. Browsers send `Origin` on cross-site POSTs and
 * `Sec-Fetch-Site` on every fetch; either one naming another site is refused.
 * A request with neither (curl, a server) is let through to the other guards —
 * those headers are a browser courtesy, not authentication, and the rate limit
 * is what actually bounds spend.
 */
export function isSameOrigin(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;

  const origin = headers.get('origin');
  if (!origin) return true;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The client's address as the platform reports it. */
export function clientKey(headers: Headers): string {
  return (
    headers.get('x-real-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * A sliding-window limiter held in memory.
 *
 * On a serverless platform each instance keeps its own window, so this bounds
 * spend per instance rather than globally — enough to stop a script hammering
 * one warm function, not a distributed attack. For a public deploy, add a
 * platform rate-limit rule in front of `/api/read` as well.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Record a hit; false if this key is over the limit. */
  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Keep the map from growing without bound on a long-lived instance.
    if (this.hits.size > 5000) {
      for (const [k, times] of this.hits) {
        if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }
}

/**
 * Accept only a base64 JPEG of plausible size. Returns the decoded byte length,
 * or null. Checked by magic number rather than by trusting a MIME field, since
 * the MIME type is ours to state to the provider.
 */
export function validateJpeg(image: unknown): number | null {
  if (typeof image !== 'string' || image.length === 0) return null;
  if (image.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return null;
  // FF D8 FF — every JPEG starts with an SOI marker followed by another marker.
  if (!image.startsWith('/9j/')) return null;
  const padding = image.endsWith('==') ? 2 : image.endsWith('=') ? 1 : 0;
  return (image.length * 3) / 4 - padding;
}
