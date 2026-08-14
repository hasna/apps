import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_BASE_URL, TextsidekickClient } from './client';
import { Sidekick } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return json ?? {};
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TextsidekickClient', () => {
  test('requires apiKey', () => {
    expect(() => new TextsidekickClient({ apiKey: '' })).toThrow('apiKey is required');
  });

  test('uses Bearer auth and default base URL for GET /documents', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new TextsidekickClient({ apiKey: 'test-key' });
    await client.request('/documents');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/documents`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer test-key');
  });

  test('supports custom base URL override', async () => {
    const recorded = installFetch(() => ({}));
    const client = new TextsidekickClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v1/',
    });
    await client.request('/workers');
    expect(recorded[0].url).toBe('https://custom.example.com/v1/workers');
  });

  test('POST /messages sends JSON body', async () => {
    const recorded = installFetch(() => ({ id: 'msg-1' }));
    const sidekick = new Sidekick({ apiKey: 'test-key' });
    await sidekick.sendMessage({ workerId: 'w1', body: 'Hello' });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/messages`);
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ workerId: 'w1', body: 'Hello' });
    expect(recorded[0].headers.authorization).toBe('Bearer test-key');
  });
});
