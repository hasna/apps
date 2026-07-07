import { afterEach, describe, expect, test } from 'bun:test';
import { WakatimeClient } from './client';
import { WakatimeApiError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (req: RecordedRequest) => { ok?: boolean; status?: number; body?: unknown },
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) {
        headers[key] = value;
      }
    } else if (rawHeaders) {
      Object.assign(headers, rawHeaders);
    }

    const req: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(req);

    const result = handler(req);
    const status = result.status ?? (result.ok === false ? 400 : 200);
    const ok = result.ok ?? (status >= 200 && status < 300);
    const body = result.body ?? { ok: true };

    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(body);
      },
    } as Response;
  }) as typeof fetch;

  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('WakatimeClient', () => {
  test('uses Bearer auth for waka_tok_* tokens', async () => {
    const recorded = installFetch(() => ({ body: { data: [] } }));
    const client = new WakatimeClient({ apiKey: 'waka_tok_abc123' });
    await client.get('/users/current');

    expect(recorded[0].headers.Authorization).toBe('Bearer waka_tok_abc123');
    expect(recorded[0].url).toBe('https://wakatime.com/api/v1/users/current');
  });

  test('uses Basic auth for plain API keys', async () => {
    const recorded = installFetch(() => ({ body: { data: [] } }));
    const client = new WakatimeClient({ apiKey: 'plain-key' });
    await client.get('/meta');

    expect(recorded[0].headers.Authorization).toBe(`Basic ${Buffer.from('plain-key').toString('base64')}`);
  });

  test('encodes query parameters and path segments', async () => {
    const recorded = installFetch(() => ({ body: { data: [] } }));
    const client = new WakatimeClient({ apiKey: 'waka_tok_test' });
    await client.get('/users/current/stats/last_7_days', {
      project: 'my project',
      timeout: 30,
    });

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/api/v1/users/current/stats/last_7_days');
    expect(url.searchParams.get('project')).toBe('my project');
    expect(url.searchParams.get('timeout')).toBe('30');
  });

  test('throws WakatimeApiError on non-OK responses', async () => {
    installFetch(() => ({
      ok: false,
      status: 401,
      body: { error: 'Invalid API key' },
    }));

    const client = new WakatimeClient({ apiKey: 'bad-key' });
    try {
      await client.get('/users/current');
      throw new Error('expected request to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(WakatimeApiError);
      expect((err as WakatimeApiError).statusCode).toBe(401);
      expect((err as WakatimeApiError).message).toBe('Invalid API key');
    }
  });

  test('requires API key at construction', () => {
    expect(() => new WakatimeClient({ apiKey: '' })).toThrow('WakaTime API key is required');
  });
});
