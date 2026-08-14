import { afterEach, describe, expect, test } from 'bun:test';
import { Trybloom, TrybloomClient, DEFAULT_BASE_URL, encodePathSegment } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ ok: true });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TrybloomClient', () => {
  test('encodePathSegment encodes spaces in path IDs', () => {
    expect(encodePathSegment('brand 1')).toBe('brand%201');
    expect(encodePathSegment('gen 1')).toBe('gen%201');
  });

  test('rejects missing API key', () => {
    expect(() => new TrybloomClient({ apiKey: '' })).toThrow(/API key is required/i);
  });

  test('uses bearer auth for brand and generation endpoints', async () => {
    const recorded = installFetch();
    const client = new Trybloom({ apiKey: 'bloom-key' });

    await client.listBrands({ limit: 2 });
    await client.getBrand('brand 1');
    await client.createBrand({ name: 'Acme', palette: ['#111111'] });
    await client.createGeneration({ brandId: 'brand 1', prompt: 'launch image' });
    await client.getGeneration('gen 1');
    await client.editImage({ imageUrl: 'https://example.com/in.png', prompt: 'brighter' });
    await client.resizeImage({ imageUrl: 'https://example.com/in.png', width: 1200 });
    await client.uploadImage({ imageUrl: 'https://example.com/in.png' });

    expect(recorded.map((request) => [request.method, request.url])).toEqual([
      ['GET', `${DEFAULT_BASE_URL}/brands?limit=2`],
      ['GET', `${DEFAULT_BASE_URL}/brands/brand%201`],
      ['POST', `${DEFAULT_BASE_URL}/brands`],
      ['POST', `${DEFAULT_BASE_URL}/generations`],
      ['GET', `${DEFAULT_BASE_URL}/generations/gen%201`],
      ['POST', `${DEFAULT_BASE_URL}/images/edit`],
      ['POST', `${DEFAULT_BASE_URL}/images/resize`],
      ['POST', `${DEFAULT_BASE_URL}/images/upload`],
    ]);

    for (const request of recorded) {
      expect(request.headers.authorization).toBe('Bearer bloom-key');
    }

    expect(recorded[2].body).toEqual({ name: 'Acme', palette: ['#111111'] });
    expect(recorded[3].body).toEqual({ prompt: 'launch image' });
  });

  test('supports raw requests with custom base URL', async () => {
    const recorded = installFetch();
    const client = new Trybloom({
      apiKey: 'bloom-key',
      baseUrl: 'https://custom.example/api/v1',
    });

    await client.rawRequest({
      path: '/brands',
      method: 'POST',
      body: { name: 'Raw' },
    });

    expect(recorded[0]).toMatchObject({
      method: 'POST',
      url: 'https://custom.example/api/v1/brands',
      body: { name: 'Raw' },
    });
  });

  test('fromEnv requires TRYBLOOM_API_KEY', () => {
    const previous = process.env.TRYBLOOM_API_KEY;
    delete process.env.TRYBLOOM_API_KEY;
    expect(() => Trybloom.fromEnv()).toThrow(/TRYBLOOM_API_KEY/i);
    if (previous !== undefined) process.env.TRYBLOOM_API_KEY = previous;
  });
});
