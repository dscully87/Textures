/**
 * The reasoning hop.
 *
 * The only part of the engine that talks to a network, and the only reason the
 * project has a server at all. It receives a 512px JPEG of the capture and a
 * small, validated set of measurements; builds the prompt itself; asks Gemini
 * for a structured reading; validates whatever comes back; and returns it.
 *
 * Every model-side failure returns `{ reading: null, reason }` with a 200: a
 * missing key, a provider outage, a timeout and a malformed response are all the
 * same event to the client — keep the deterministic theme, which is a complete
 * product on its own. Requests the route refuses (cross-site, over the rate
 * limit, malformed) get a 4xx.
 */

import { ApiError, GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT, buildUserPrompt, parseMeasurements, readingSchema } from '@/lib/ai/prompt';
import { parseReading } from '@/lib/ai/reading';
import { MAX_BODY_CHARS, RateLimiter, clientKey, isSameOrigin, validateJpeg } from '@/lib/ai/guard';

export const runtime = 'nodejs';
/** Nothing here is cacheable — every capture is a distinct request. */
export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Below the platform's own limit, so we fail before the function is killed. */
const TIMEOUT_MS = 25_000;

/**
 * Enough to reason about the subject before answering; small enough to keep a
 * capture to a few seconds. Gemini 2.5 Flash bills thinking as output tokens.
 */
const THINKING_BUDGET = 1024;

/** Twenty readings per ten minutes per address, per instance. */
const limiter = new RateLimiter(20, 10 * 60_000);

function bad(reason: string, status = 200, detail?: string) {
  // 200 on purpose for the degradation cases: the client is not broken, it just
  // has no reading. `reason` and `detail` are what make a misconfigured deploy
  // diagnosable — a wrong model id and a missing key look identical otherwise.
  return Response.json({ reading: null, reason, detail }, { status });
}

/**
 * Configuration probe: is the key wired up in this environment? Answers
 * without calling the provider — no cost, nothing to abuse — and without
 * revealing the key itself.
 *
 *   curl https://<deployment>/api/read
 */
export function GET() {
  const key = process.env.GEMINI_API_KEY;
  return Response.json({
    configured: Boolean(key),
    // Enough to confirm the right secret landed in the right environment, and
    // far too little to reconstruct it.
    keyLength: key ? key.length : 0,
    model: process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
    hint: key
      ? 'Key present. Capture something with AI refinement on; a failure will report its reason.'
      : 'No GEMINI_API_KEY in this environment. Add it (Vercel → Settings → Environment Variables) and redeploy — env changes do not apply to existing deployments.',
  });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request.headers)) return bad('forbidden-origin', 403);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return bad('no-api-key');

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_CHARS) return bad('payload-too-large', 413);

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return bad('payload-too-large', 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad('malformed-request', 400);
  }
  const { image, measurements: rawMeasurements } = (body ?? {}) as Record<string, unknown>;

  if (validateJpeg(image) === null) return bad('invalid-image', 400);
  const measurements = parseMeasurements(rawMeasurements);
  if (!measurements) return bad('malformed-request', 400);

  // Only well-formed requests count against the limit, so a broken client can
  // be fixed without waiting out a window.
  if (!limiter.take(clientKey(request.headers))) return bad('rate-limited', 429);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: image as string } },
            { text: buildUserPrompt(measurements) },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: readingSchema(measurements.swatches.length),
        thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        temperature: 0.6,
        maxOutputTokens: 8192,
        abortSignal: controller.signal,
      },
    });

    const content = response.text;
    if (!content) return bad('empty-response');

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return bad('unparseable-json');
    }

    const reading = parseReading(parsed, measurements.swatches.length);
    if (!reading) return bad('invalid-shape');

    return Response.json({ reading, usage: response.usageMetadata ?? null, model });
  } catch (err) {
    if (err instanceof ApiError) {
      // A 4xx is a configuration mistake — wrong model id, bad key, no billing —
      // and the provider's own message names it precisely. 5xx is their outage.
      const detail = err.status >= 400 && err.status < 500 ? err.message.slice(0, 300) : undefined;
      console.warn('[textures] provider returned', err.status, detail ?? '');
      return bad(`provider-${err.status}`, 200, detail);
    }
    const reason = controller.signal.aborted ? 'timeout' : 'network-error';
    console.warn('[textures] read failed:', reason, err instanceof Error ? err.message : '');
    return bad(reason);
  } finally {
    clearTimeout(timeout);
  }
}
