import { describe, expect, test, mock } from 'bun:test';
import { SpongeClient, DEFAULT_BASE_URL, compact } from './client';
import { Sponge } from './index';
import { SpongeApiError } from '../types';

describe('SpongeClient', () => {
  test('requires an API key', () => {
    // @ts-expect-error intentionally missing apiKey
    expect(() => new SpongeClient({})).toThrow('API key is required');
  });

  test('builds URLs against the default base and appends query params', () => {
    const client = new SpongeClient({ apiKey: 'sk_test' });
    const url = client.buildUrl('/api/balances', { chain: 'base', onlyUsdc: true, skip: undefined });
    expect(url).toBe(`${DEFAULT_BASE_URL}/api/balances?chain=base&onlyUsdc=true`);
  });

  test('honors a custom base URL and strips trailing slashes', () => {
    const client = new SpongeClient({ apiKey: 'sk_test', baseUrl: 'https://example.test/' });
    expect(client.buildUrl('/api/agents/me')).toBe('https://example.test/api/agents/me');
  });

  test('masks the API key for display', () => {
    const client = new SpongeClient({ apiKey: 'test_key_ABCDEF123456' });
    const preview = client.getApiKeyPreview();
    expect(preview).toContain('...');
    expect(preview).not.toContain('ABCDEF1234');
  });

  test('sends bearer auth and optional version header, parses JSON', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchMock = mock(async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SpongeClient({ apiKey: 'sk_test', apiVersion: '0.2.2' });
    const result = await client.post('/api/agents/', { name: 'agent-1' });

    expect(result).toEqual({ ok: true });
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk_test');
    expect(headers['Sponge-Version']).toBe('0.2.2');
    expect(headers['Content-Type']).toBe('application/json');
    expect(captured!.init.body).toBe(JSON.stringify({ name: 'agent-1' }));
  });

  test('throws SpongeApiError with status and message on failure', async () => {
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ message: 'nope', code: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SpongeClient({ apiKey: 'sk_test' });
    try {
      await client.get('/api/agents/me');
      throw new Error('expected request to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(SpongeApiError);
      const apiErr = err as SpongeApiError;
      expect(apiErr.statusCode).toBe(401);
      expect(apiErr.code).toBe('unauthorized');
      expect(apiErr.message).toContain('nope');
    }
  });
});

describe('compact', () => {
  test('drops undefined values but keeps falsy ones', () => {
    expect(compact({ a: 1, b: undefined, c: false, d: '' })).toEqual({ a: 1, c: false, d: '' });
  });
});

describe('Sponge facade', () => {
  test('exposes all resource APIs', () => {
    const sponge = new Sponge({ apiKey: 'sk_test' });
    for (const key of ['agents', 'wallets', 'transfers', 'payments', 'trading', 'onramp', 'cards', 'keys', 'raw'] as const) {
      expect(sponge[key]).toBeDefined();
    }
  });

  test('fromEnv requires SPONGE_API_KEY', () => {
    const prev = process.env.SPONGE_API_KEY;
    delete process.env.SPONGE_API_KEY;
    expect(() => Sponge.fromEnv()).toThrow('SPONGE_API_KEY');
    if (prev !== undefined) process.env.SPONGE_API_KEY = prev;
  });
});
