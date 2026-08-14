import { afterEach, describe, expect, test } from 'bun:test';
import { YousignClient } from './client';
import { YousignApiError, parseYousignErrorMessage } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => { ok: boolean; status: number; body: unknown },
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const result = handler(url, init);
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.ok ? 'OK' : 'Error',
      async text() {
        return JSON.stringify(result.body);
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('YousignClient', () => {
  test('uses production base URL by default', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: { data: [] } }));
    const client = new YousignClient({ apiKey: 'test-key' });
    await client.get('/signature_requests');
    expect(recorded[0].url).toStartWith('https://api.yousign.app/v3/signature_requests');
  });

  test('uses sandbox base URL when environment is sandbox', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: { data: [] } }));
    const client = new YousignClient({ apiKey: 'test-key', environment: 'sandbox' });
    await client.get('/signature_requests');
    expect(recorded[0].url).toStartWith('https://api-sandbox.yousign.app/v3/signature_requests');
  });

  test('sends Authorization Bearer header', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: {} }));
    const client = new YousignClient({ apiKey: 'secret-token-123' });
    await client.get('/users');
    expect(recorded[0].headers.authorization).toBe('Bearer secret-token-123');
  });

  test('throws YousignApiError with violation message', async () => {
    installFetch(() => ({
      ok: false,
      status: 422,
      body: { violations: [{ message: 'name is required' }] },
    }));
    const client = new YousignClient({ apiKey: 'test-key' });
    try {
      await client.post('/signature_requests', { delivery_mode: 'email' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(YousignApiError);
      expect((err as YousignApiError).message).toBe('name is required');
    }
  });

  test('parseYousignErrorMessage falls back through detail/title/message', () => {
    expect(parseYousignErrorMessage({ violations: [{ message: 'field error' }] }, 400)).toBe('field error');
    expect(parseYousignErrorMessage({ detail: 'bad request' }, 400)).toBe('bad request');
    expect(parseYousignErrorMessage({ title: 'Not Found' }, 404)).toBe('Not Found');
    expect(parseYousignErrorMessage({ message: 'generic' }, 500)).toBe('generic');
    expect(parseYousignErrorMessage({}, 503)).toBe('request failed (503)');
  });

  test('requires API key', () => {
    expect(() => new YousignClient({ apiKey: '' })).toThrow('Yousign API key is required');
  });
});
