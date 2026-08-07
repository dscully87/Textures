/**
 * The reasoning hop.
 *
 * This is the only part of the engine that talks to a network, and the only
 * reason the project has a server at all. It is deliberately thin: it takes
 * measurements and labels, asks DeepSeek to interpret them, validates whatever
 * comes back, and returns it. No image ever reaches this route — the photograph
 * stays on the device, because CLIP already ran there.
 *
 * Every failure path returns `{ reading: null }` with a 200. A missing key, a
 * provider outage, a timeout and a malformed response are all the same event to
 * the client: keep the deterministic theme, which is a complete product on its
 * own.
 */

import { parseReading } from '@/lib/ai/reading';

export const runtime = 'nodejs';
/** Nothing here is cacheable — every capture is a distinct request. */
export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';

/** Below the platform's own limit, so we fail before the function is killed. */
const TIMEOUT_MS = 20_000;

interface ReadRequest {
  system?: unknown;
  user?: unknown;
  swatchCount?: unknown;
}

function bad(reason: string, status = 200, detail?: string) {
  // 200 on purpose for the degradation cases: the client is not broken, it just
  // has no reading, and an error status would put a red herring in the console.
  // `reason` and `detail` are what make a misconfigured deploy diagnosable —
  // without them a wrong model id and a missing key look identical from outside.
  return Response.json({ reading: null, reason, detail }, { status });
}

/**
 * Configuration probe.
 *
 * The refinement path is designed to fail invisibly, which is right for a
 * visitor and useless for whoever just deployed it. This answers "is the key
 * actually wired up in this environment?" without calling the provider — no
 * cost, no rate limit, nothing to abuse — and without revealing the key itself.
 *
 *   curl https://<deployment>/api/read
 */
export function GET() {
  const key = process.env.DEEPSEEK_API_KEY;
  return Response.json({
    configured: Boolean(key),
    // Enough to confirm the right secret landed in the right environment, and
    // far too little to reconstruct it.
    keyLength: key ? key.length : 0,
    model: process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
    hint: key
      ? 'Key present. Capture something with refinement enabled; a failure will report its reason.'
      : 'No DEEPSEEK_API_KEY in this environment. Vercel → Settings → Environment Variables, then redeploy — env changes do not apply to existing deployments.',
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return bad('no-api-key');

  let body: ReadRequest;
  try {
    body = await request.json();
  } catch {
    return bad('malformed-request', 400);
  }

  const { system, user, swatchCount } = body;
  if (typeof system !== 'string' || typeof user !== 'string') {
    return bad('malformed-request', 400);
  }
  if (typeof swatchCount !== 'number' || !Number.isInteger(swatchCount) || swatchCount <= 0) {
    return bad('malformed-request', 400);
  }
  // The prompt is built client-side from bounded data; this is a backstop
  // against a caller that isn't ours rather than against our own payloads.
  if (system.length > 20_000 || user.length > 20_000) {
    return bad('payload-too-large', 413);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `${process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL,
          // JSON mode guarantees the response parses. It does not guarantee the
          // shape, which is why `parseReading` exists downstream.
          response_format: { type: 'json_object' },
          // The system half is byte-stable across captures so the provider's
          // context cache has a fixed prefix to match on.
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: 1600,
        }),
      },
    );

    if (!response.ok) {
      // A 4xx is a configuration mistake — wrong model id, bad key, no credit —
      // and the provider's own message names it precisely. Pass a truncated copy
      // through, because guessing between those three from a bare status code is
      // exactly the debugging session this is meant to prevent. 5xx is their
      // outage, not our misconfiguration, so it gets no detail.
      let detail: string | undefined;
      if (response.status >= 400 && response.status < 500) {
        detail = (await response.text().catch(() => '')).slice(0, 300) || undefined;
      }
      console.warn('[textures] provider returned', response.status, detail ?? '');
      return bad(`provider-${response.status}`, 200, detail);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return bad('empty-response');

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return bad('unparseable-json');
    }

    const reading = parseReading(raw, swatchCount);
    if (!reading) return bad('invalid-shape');

    return Response.json({
      reading,
      usage: payload?.usage ?? null,
      model: payload?.model ?? null,
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network-error';
    console.warn('[textures] read failed:', reason);
    return bad(reason);
  } finally {
    clearTimeout(timeout);
  }
}
