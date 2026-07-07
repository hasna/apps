import { afterEach, describe, expect, test } from 'bun:test';
import { SseTrigger } from './index';
import { DEFAULT_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers?: HeadersInit;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const json = handler(url, init);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? { ok: true });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SseTriggerClient', () => {
  test('listStreams sends Bearer auth to /streams', async () => {
    const recorded = installFetch(() => ({ streams: [] }));
    const client = new SseTrigger({ apiKey: 'sse-trigger-key' });
    await client.listStreams();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/streams`);
    expect(recorded[0].method).toBe('GET');
    expect(new Headers(recorded[0].headers).get('Authorization')).toBe('Bearer sse-trigger-key');
  });

  test('getStream encodes stream id in URL path', async () => {
    const recorded = installFetch(() => ({ id: 'item-1' }));
    const client = new SseTrigger({ apiKey: 'sse-trigger-key' });
    await client.getStream('item-1');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/streams/item-1`);
    expect(new Headers(recorded[0].headers).get('Authorization')).toBe('Bearer sse-trigger-key');
  });

  test('createStream POSTs JSON body to /streams', async () => {
    const recorded = installFetch(() => ({ id: 'new-stream' }));
    const client = new SseTrigger({ apiKey: 'sse-trigger-key' });
    await client.createStream({ name: 'workflow' });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/streams`);
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body ?? '{}')).toEqual({ name: 'workflow' });
  });

  test('uses custom base URL when configured', async () => {
    const recorded = installFetch(() => ({}));
    const client = new SseTrigger({ apiKey: 'key', baseUrl: 'https://custom.example/v2/' });
    await client.listEvents();
    expect(recorded[0].url).toBe('https://custom.example/v2/events');
  });

  test('requires API key', () => {
    expect(() => new SseTrigger({ apiKey: '' })).toThrow('API key is required');
  });
});
