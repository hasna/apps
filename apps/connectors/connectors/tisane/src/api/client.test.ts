import { afterEach, describe, expect, test } from 'bun:test';
import { TisaneClient } from './client';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body,
    };
    recorded.push(entry);
    const json = handler(entry);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TisaneClient', () => {
  test('requires api key', () => {
    expect(() => new TisaneClient({ apiKey: '' })).toThrow('Tisane API key is required');
  });

  test('POST /parse sends Ocp-Apim-Subscription-Key and JSON body', async () => {
    const recorded = installFetch(() => ({ language: 'en', sentiment: 0.2 }));
    const client = new TisaneClient({ apiKey: 'test-subscription-key' });
    const result = await client.post('/parse', { content: 'hello world', language: 'en' });

    expect(result).toEqual({ language: 'en', sentiment: 0.2 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.tisane.ai/parse');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['ocp-apim-subscription-key']).toBe('test-subscription-key');
    expect(recorded[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(recorded[0].body!)).toEqual({ content: 'hello world', language: 'en' });
  });

  test('GET /languages uses subscription key header', async () => {
    const recorded = installFetch(() => ({ languages: ['en', 'es'] }));
    const client = new TisaneClient({ apiKey: 'lang-key' });
    const result = await client.get('/languages');

    expect(result).toEqual({ languages: ['en', 'es'] });
    expect(recorded[0].url).toBe('https://api.tisane.ai/languages');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers['ocp-apim-subscription-key']).toBe('lang-key');
    expect(recorded[0].body).toBeUndefined();
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch(() => ({}));
    const client = new TisaneClient({ apiKey: 'key', baseUrl: 'https://custom.example/' });
    await client.post('/detectLanguage', { content: 'bonjour' });

    expect(recorded[0].url).toBe('https://custom.example/detectLanguage');
  });
});
