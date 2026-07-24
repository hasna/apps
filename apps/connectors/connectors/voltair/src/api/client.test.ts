import { afterEach, describe, expect, mock, test } from 'bun:test';
import { encodePathSegment, VoltairClient } from './client';
import { Voltair } from './index';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

function installFetchMock(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('encodePathSegment', () => {
  test('encodes spaces in project and run IDs', () => {
    expect(encodePathSegment('proj 1')).toBe('proj%201');
    expect(encodePathSegment('run 1')).toBe('run%201');
  });
});

describe('VoltairClient', () => {
  test('sends Bearer authorization and encodes path segments', async () => {
    const captured = installFetchMock();
    const client = new VoltairClient({ apiKey: 'voltair-key' });

    await client.get('/projects', { limit: 5 });
    await client.get(`/projects/${encodePathSegment('proj 1')}`);
    await client.post(`/projects/${encodePathSegment('proj 1')}/runs`, { prompt: 'optimize this route' });
    await client.get(`/projects/${encodePathSegment('proj 1')}/runs/${encodePathSegment('run 1')}`);

    expect(captured.map((r) => [r.method, r.url])).toEqual([
      ['GET', 'https://api.voltair.ai/v1/projects?limit=5'],
      ['GET', 'https://api.voltair.ai/v1/projects/proj%201'],
      ['POST', 'https://api.voltair.ai/v1/projects/proj%201/runs'],
      ['GET', 'https://api.voltair.ai/v1/projects/proj%201/runs/run%201'],
    ]);

    for (const request of captured) {
      expect(request.headers.get('Authorization')).toBe('Bearer voltair-key');
    }

    expect(JSON.parse(captured[2].body!)).toEqual({ prompt: 'optimize this route' });
  });

  test('supports custom base URL override', async () => {
    const captured = installFetchMock();
    const client = new VoltairClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example/v2/',
    });
    await client.get('/projects');
    expect(captured[0].url).toBe('https://custom.example/v2/projects');
  });

  test('requires API key', () => {
    expect(() => new VoltairClient({ apiKey: '' })).toThrow(/required/i);
  });
});

describe('Voltair facade', () => {
  test('rawRequest uses configured base URL and path', async () => {
    const captured = installFetchMock();
    const voltair = new Voltair({ apiKey: 'voltair-key' });

    await voltair.rawRequest({
      path: '/custom/endpoint',
      method: 'POST',
      body: { enabled: true },
    });

    expect(captured[0].url).toBe('https://api.voltair.ai/v1/custom/endpoint');
    expect(captured[0].method).toBe('POST');
    expect(JSON.parse(captured[0].body!)).toEqual({ enabled: true });
  });
});
