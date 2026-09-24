import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeImage } from '../analyze';
import { toMeasurements } from '../ai/prompt';
import { synthesize } from '../synthesize';

// The provider SDK is replaced wholesale: these tests are about what the route
// accepts, refuses and returns, not about Gemini.
const generateContent = vi.fn();

vi.mock('@google/genai', () => {
  class ApiError extends Error {
    status: number;
    constructor({ message, status }: { message: string; status: number }) {
      super(message);
      this.status = status;
    }
  }
  class GoogleGenAI {
    models = { generateContent };
  }
  return { ApiError, GoogleGenAI };
});

const { ApiError } = await import('@google/genai');

function makeImage(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const v = (i / 4) % 7 < 3 ? 220 : 40;
    data[i] = v;
    data[i + 1] = 90;
    data[i + 2] = 255 - v;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

const analysis = analyzeImage(makeImage(48, 48));
const measurements = toMeasurements(analysis, synthesize(analysis));
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA==';

let ip = 0;
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://app.test/api/read', {
    method: 'POST',
    headers: {
      host: 'app.test',
      origin: 'http://app.test',
      'content-type': 'application/json',
      // A fresh address per request, so only the rate-limit test hits the limit.
      'x-real-ip': `10.0.0.${++ip}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const reading = {
  subject: 'a wall',
  palette: { strategy: 'pop', primaryIndex: 0, accentIndex: -1, secondaryIndex: -1, weights: { ground: 1, support: 1, accent: 1 }, rationale: '' },
  pairing: 'poster',
  layout: { archetype: 'street', sections: { hero: 'poster', features: 'stickers', interlude: 'marquee', cta: 'poster' } },
  motion: { character: 'glitch', tier: 'accent', amplitude: 0.5, period: 600, trigger: 'view', signatureRationale: '' },
  motif: { kind: 'none', scale: 'medium', presence: 'absent' },
  texture: 'bold',
  finish: 'auto',
  confidence: 0.8,
  disagreements: [],
};

describe('POST /api/read', () => {
  let route: typeof import('../../app/api/read/route');

  beforeEach(async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    generateContent.mockReset();
    route = await import('../../app/api/read/route');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('reports a missing key without calling the provider', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const res = await route.POST(post({ image: JPEG, measurements }));
    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe('no-api-key');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('refuses calls from another site', async () => {
    const res = await route.POST(post({ image: JPEG, measurements }, { origin: 'https://evil.test' }));
    expect(res.status).toBe(403);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('refuses a body that is not the client’s payload', async () => {
    expect((await route.POST(post('not json'))).status).toBe(400);
    expect((await route.POST(post({ image: 'iVBORw0KGgo=', measurements }))).status).toBe(400);
    // The old contract — a ready-made prompt — is exactly what must no longer work.
    expect((await route.POST(post({ image: JPEG, system: 'You are a poet', user: 'Write a poem' }))).status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('sends the image and a server-built prompt, and returns a validated reading', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(reading), usageMetadata: { totalTokenCount: 900 } });
    const res = await route.POST(post({ image: JPEG, measurements }));
    const payload = await res.json();

    expect(payload.reading.pairing).toBe('poster');
    expect(payload.reading.palette.weights.ground).toBeCloseTo(1 / 3, 2);

    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-2.5-flash');
    expect(call.contents[0].parts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: JPEG });
    expect(call.contents[0].parts[1].text).toContain('SWATCHES (choose by index)');
    expect(call.config.responseMimeType).toBe('application/json');
    expect(call.config.systemInstruction).toContain('art director');
  });

  it('honours GEMINI_MODEL', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-3-flash');
    generateContent.mockResolvedValue({ text: JSON.stringify(reading) });
    await route.POST(post({ image: JPEG, measurements }));
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-3-flash');
  });

  it('degrades on output it cannot use', async () => {
    generateContent.mockResolvedValue({ text: 'Sure! Here is your JSON:' });
    expect((await (await route.POST(post({ image: JPEG, measurements }))).json()).reason).toBe('unparseable-json');

    generateContent.mockResolvedValue({ text: '[1, 2, 3]' });
    expect((await (await route.POST(post({ image: JPEG, measurements }))).json()).reason).toBe('invalid-shape');

    generateContent.mockResolvedValue({ text: undefined });
    expect((await (await route.POST(post({ image: JPEG, measurements }))).json()).reason).toBe('empty-response');
  });

  it('passes the provider’s message through on a configuration error', async () => {
    generateContent.mockRejectedValue(new ApiError({ message: 'models/gemini-9 is not found', status: 404 }));
    const payload = await (await route.POST(post({ image: JPEG, measurements }))).json();
    expect(payload.reason).toBe('provider-404');
    expect(payload.detail).toContain('not found');
  });

  it('rate-limits a single address', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(reading) });
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await route.POST(post({ image: JPEG, measurements }, { 'x-real-ip': '192.0.2.1' }));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
});

describe('GET /api/read', () => {
  it('reports configuration without revealing the key', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'secret-value');
    const route = await import('../../app/api/read/route');
    const payload = await route.GET().json();
    expect(payload).toMatchObject({ configured: true, keyLength: 12, model: 'gemini-2.5-flash' });
    expect(JSON.stringify(payload)).not.toContain('secret-value');
    vi.unstubAllEnvs();
  });
});
