import { afterEach, describe, expect, test } from 'bun:test';
import { Voygr } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
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
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
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

describe('Voygr API client', () => {
  test('signup POSTs to /signup without X-API-Key', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://dev.voygr.tech/signup');
      return { message: 'ok', api_key: 'new-key' };
    });
    const voygr = new Voygr();
    const result = await voygr.signup({ email: 'user@example.com', name: 'User' });
    expect(result.api_key).toBe('new-key');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['x-api-key']).toBeUndefined();
    const body = JSON.parse(recorded[0].body!);
    expect(body).toEqual({ email: 'user@example.com', name: 'User' });
  });

  test('recover POSTs to /recover without X-API-Key', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://dev.voygr.tech/recover');
      return { message: 'sent' };
    });
    const voygr = new Voygr();
    await voygr.recover({ email: 'user@example.com' });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['x-api-key']).toBeUndefined();
    expect(JSON.parse(recorded[0].body!)).toEqual({ email: 'user@example.com' });
  });

  test('checkBusinessStatus POSTs to /v1/business-status with X-API-Key', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://dev.voygr.tech/v1/business-status');
      return { status: 'valid' };
    });
    const voygr = new Voygr({ apiKey: 'test-key' });
    const result = await voygr.checkBusinessStatus({ name: 'Acme', address: '123 Main St' });
    expect(result.status).toBe('valid');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['x-api-key']).toBe('test-key');
    expect(JSON.parse(recorded[0].body!)).toEqual({ name: 'Acme', address: '123 Main St' });
  });

  test('getUsage GETs /v1/usage with X-API-Key', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://dev.voygr.tech/v1/usage');
      return { usage: 42, limit: 1000 };
    });
    const voygr = new Voygr({ apiKey: 'test-key' });
    const result = await voygr.getUsage();
    expect(result.usage).toBe(42);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers['x-api-key']).toBe('test-key');
  });

  test('custom baseUrl trims trailing slashes', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://custom.example/v1/usage');
      return { usage: 1 };
    });
    const voygr = new Voygr({ apiKey: 'k', baseUrl: 'https://custom.example/' });
    await voygr.getUsage();
    expect(recorded[0].url).toBe('https://custom.example/v1/usage');
  });

  test('authenticated request requires API key', async () => {
    const voygr = new Voygr();
    await expect(voygr.checkBusinessStatus({ name: 'A', address: 'B' })).rejects.toThrow(
      'VOYGR API key is required',
    );
  });

  test('nested API error payloads produce useful messages', async () => {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify({ detail: { error: 'API key required' } });
        },
      } as Response;
    }) as unknown as typeof fetch;

    const voygr = new Voygr({ apiKey: 'test-key' });
    await expect(voygr.getUsage()).rejects.toThrow('API key required');
  });

  test('timeouts throw the normalized timeout error', async () => {
    globalThis.fetch = (async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    const voygr = new Voygr({ apiKey: 'test-key' });
    await expect(
      voygr.getClient().request('/v1/usage', { retries: 0, timeout: 5 }),
    ).rejects.toThrow('Request timeout after 5ms');
  });
});
