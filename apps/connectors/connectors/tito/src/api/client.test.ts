import { describe, test, expect, afterEach } from 'bun:test';
import { TitoClient, encodePathSegment } from './client';

describe('TitoClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sends unquoted Token token= authorization header on hello', async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ account: { slug: 'demo' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new TitoClient({ apiToken: 'tito-token' });
    await client.get('/hello');

    expect(capturedHeaders).toEqual({
      Authorization: 'Token token=tito-token',
      Accept: 'application/json',
    });
  });

  test('encodePathSegment URL-encodes slugs', () => {
    expect(encodePathSegment('my event')).toBe('my%20event');
    expect(encodePathSegment('acme-corp')).toBe('acme-corp');
  });
});
