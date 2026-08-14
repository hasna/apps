import { afterEach, describe, expect, test } from 'bun:test';
import { Streamable } from './index';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body?: unknown;
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  return JSON.parse(body);
}

function installFetchMock(response: unknown = { ok: true }): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    );
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: parseBody(init?.body),
    });
    return Response.json(response);
  }) as typeof fetch;
  return captured;
}

function expectReadOnlyRequest(request: CapturedRequest, path: string) {
  expect(request.url.origin).toBe('https://api.streamable.com');
  expect(request.url.pathname).toBe(path);
  expect(request.method).toBe('GET');
  expect(request.headers.get('Authorization')).toBeNull();
  expect(request.headers.get('Accept')).toBe('application/json');
  expect(request.headers.get('Content-Type')).toBeNull();
  expect(request.body).toBeUndefined();
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Streamable API client', () => {
  test('gets video metadata by shortcode', async () => {
    const captured = installFetchMock({ shortcode: 'hn8hq', title: 'Demo' });
    const api = new Streamable();

    await expect(api.getVideo(' hn8hq ')).resolves.toEqual({
      shortcode: 'hn8hq',
      title: 'Demo',
    });

    expect(captured).toHaveLength(1);
    expectReadOnlyRequest(captured[0]!, '/videos/hn8hq');
  });

  test('gets oEmbed data by video URL', async () => {
    const captured = installFetchMock({ html: '<iframe></iframe>', provider_name: 'Streamable' });
    const api = new Streamable();

    await expect(api.getOEmbed('https://streamable.com/hn8hq')).resolves.toEqual({
      html: '<iframe></iframe>',
      provider_name: 'Streamable',
    });

    expect(captured).toHaveLength(1);
    expectReadOnlyRequest(captured[0]!, '/oembed.json');
    expect(captured[0]!.url.searchParams.get('url')).toBe('https://streamable.com/hn8hq');
  });

  test('requires shortcode and url before network access', async () => {
    const captured = installFetchMock();
    const api = new Streamable();

    await expect(api.getVideo(' ')).rejects.toThrow('shortcode is required');
    await expect(api.getOEmbed('')).rejects.toThrow('url is required');
    expect(captured).toHaveLength(0);
  });

  test('non-2xx responses surface the error message', async () => {
    globalThis.fetch = (async () =>
      Response.json({ message: 'not found' }, { status: 404 })) as unknown as typeof fetch;

    await expect(new Streamable().getVideo('missing')).rejects.toThrow('not found');
  });
});
