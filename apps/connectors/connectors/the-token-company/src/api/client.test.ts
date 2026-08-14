import { afterEach, describe, expect, test } from 'bun:test';
import { TheTokenCompany } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown,
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    }
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body });
    const json = handler(url, init, recorded);
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

describe('The Token Company API transport', () => {
  test('compress POSTs to /compress with Bearer auth and compression body', async () => {
    const recorded = installFetch(() => ({
      output: 'compressed text',
      output_tokens: 5,
      original_input_tokens: 12,
    }));

    const client = new TheTokenCompany({ apiKey: 'ttc-test-key' });
    const result = await client.compress.compress({
      model: 'bear-2',
      input: 'Long prompt text',
      compression_settings: { aggressiveness: 0.2 },
    });

    expect(recorded[0].url).toBe('https://api.thetokencompany.com/v1/compress');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.authorization).toBe('Bearer ttc-test-key');
    expect(recorded[0].body).toEqual({
      model: 'bear-2',
      input: 'Long prompt text',
      compression_settings: { aggressiveness: 0.2 },
    });

    expect(result).toEqual({
      output: 'compressed text',
      output_tokens: 5,
      input_tokens: 12,
      tokens_saved: 7,
      compression_ratio: 2.4,
    });
  });

  test('maps raw API token stats to connector response fields', async () => {
    installFetch(() => ({
      output: 'compressed text',
      output_tokens: 4,
      original_input_tokens: 10,
    }));

    const client = new TheTokenCompany({ apiKey: 'ttc-test-key' });
    const result = await client.compress.compress({ input: 'Long prompt text' });

    expect(result).toEqual({
      output: 'compressed text',
      output_tokens: 4,
      input_tokens: 10,
      tokens_saved: 6,
      compression_ratio: 2.5,
    });
  });

  test('uses custom base URL from config', async () => {
    const recorded = installFetch(() => ({
      output: 'x',
      output_tokens: 1,
      input_tokens: 2,
      tokens_saved: 1,
      compression_ratio: 2,
    }));

    const client = new TheTokenCompany({
      apiKey: 'key',
      baseUrl: 'https://custom.example/v1/',
    });

    await client.compress.compress({ input: 'text' });

    expect(recorded[0].url).toBe('https://custom.example/v1/compress');
  });

  test('defaults model to bear-2 when omitted', async () => {
    const recorded = installFetch(() => ({
      output: 'x',
      output_tokens: 1,
      input_tokens: 2,
      tokens_saved: 1,
      compression_ratio: 2,
    }));

    const client = new TheTokenCompany({ apiKey: 'key' });
    await client.compress.compress({ input: 'text' });

    expect((recorded[0].body as Record<string, unknown>).model).toBe('bear-2');
  });

  test('rawRequest forwards method and path', async () => {
    const recorded = installFetch(() => ({ ok: true }));

    const client = new TheTokenCompany({ apiKey: 'key' });
    await client.rawRequest({ method: 'POST', path: '/compress', body: { input: 'hi' } });

    expect(recorded[0].url).toBe('https://api.thetokencompany.com/v1/compress');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toEqual({ input: 'hi' });
  });

  test('requires API key', () => {
    expect(() => new TheTokenCompany({ apiKey: '' })).toThrow('API key is required');
  });
});
