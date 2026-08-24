import { afterEach, describe, expect, test } from 'bun:test';
import { StripeFinancialConnectionsClient } from './client';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('StripeFinancialConnectionsClient transport', () => {
  test('refuses to send without a configured base URL (no default endpoint)', () => {
    expect(() => new StripeFinancialConnectionsClient({ apiKey: 'test-key' })).toThrow(/baseUrl/);
  });

  test('sends the API key only to the configured base URL', async () => {
    const recorded: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      recorded.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() { return JSON.stringify({ ok: true }); },
        async json() { return { ok: true }; },
      } as Response;
    }) as typeof fetch;
    const client = new StripeFinancialConnectionsClient({ apiKey: 'test-key', baseUrl: 'https://configured.example.com/v1' });
    await client.request('/ping');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].startsWith('https://configured.example.com/v1/')).toBe(true);
    expect(recorded[0]).not.toContain('api.stripefinancialconnections.com');
  });
});
