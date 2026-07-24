import { afterEach, describe, expect, test } from 'bun:test';
import { Totp } from './index';
import { DEFAULT_BASE_URL, TotpClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function headerValue(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const auth = headerValue(init?.headers, 'Authorization');
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers: auth ? { authorization: auth } : {},
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
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

describe('TotpClient', () => {
  test('requires apiKey', () => {
    expect(() => new TotpClient({ apiKey: '' })).toThrow('Totp apiKey is required');
  });

  test('uses default base URL', () => {
    const client = new TotpClient({ apiKey: 'test-key' });
    expect(client).toBeInstanceOf(TotpClient);
    expect(DEFAULT_BASE_URL).toBe('https://api.totp.com/v1');
  });
});

describe('Totp API', () => {
  const config = { apiKey: 'totp-key', baseUrl: 'https://api.totp.com/v1' };

  test('listCodes GETs /codes with Bearer auth', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const totp = new Totp(config);
    await totp.listCodes();

    expect(recorded[0].url).toBe('https://api.totp.com/v1/codes');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer totp-key');
  });

  test('getCode GETs encoded /codes/{id}', async () => {
    const recorded = installFetch(() => ({ id: 'item-1' }));
    const totp = new Totp(config);
    await totp.getCode('item-1');

    expect(recorded[0].url).toBe('https://api.totp.com/v1/codes/item-1');
    expect(recorded[0].headers.authorization).toBe('Bearer totp-key');
  });

  test('createCode POSTs JSON body to /codes', async () => {
    const recorded = installFetch(() => ({ id: 'new-code' }));
    const totp = new Totp(config);
    await totp.createCode({ name: 'My App', issuer: 'Example' });

    expect(recorded[0].url).toBe('https://api.totp.com/v1/codes');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ name: 'My App', issuer: 'Example' }));
    expect(recorded[0].headers.authorization).toBe('Bearer totp-key');
  });

  test('listEvents GETs /events', async () => {
    const recorded = installFetch(() => ({ events: [] }));
    const totp = new Totp(config);
    await totp.listEvents({ limit: 10 });

    expect(recorded[0].url).toBe('https://api.totp.com/v1/events?limit=10');
    expect(recorded[0].method).toBe('GET');
  });

  test('search POSTs body to /search', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const totp = new Totp(config);
    await totp.search({ query: 'login', limit: 5 });

    expect(recorded[0].url).toBe('https://api.totp.com/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ query: 'login', limit: 5 }));
  });

  test('rawRequest passes through method, path, query, and body', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const totp = new Totp(config);
    await totp.rawRequest({
      method: 'PATCH',
      path: '/codes/custom',
      query: { dry_run: true },
      body: { enabled: false },
    });

    expect(recorded[0].url).toBe('https://api.totp.com/v1/codes/custom?dry_run=true');
    expect(recorded[0].method).toBe('PATCH');
    expect(recorded[0].body).toBe(JSON.stringify({ enabled: false }));
  });

  test('fromEnv reads TOTP_API_KEY and TOTP_BASE_URL', () => {
    process.env.TOTP_API_KEY = 'env-key';
    process.env.TOTP_BASE_URL = 'https://custom.example/v1';
    const totp = Totp.fromEnv();
    expect(totp).toBeInstanceOf(Totp);
    delete process.env.TOTP_API_KEY;
    delete process.env.TOTP_BASE_URL;
  });
});
