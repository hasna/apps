import { afterEach, describe, expect, test } from 'bun:test';
import { UpstashClient, redactSensitive } from './client';
import { UpstashApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => {
    ok: boolean;
    status: number;
    statusText?: string;
    body?: unknown;
  },
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) headers[k] = v;
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body as string | undefined,
    });
    const result = handler(url, init, recorded);
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText ?? 'OK',
      async text() {
        if (result.body === undefined) return '';
        return typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('UpstashClient', () => {
  const mockConfig = {
    email: 'user@example.com',
    apiKey: 'test-api-key-12345',
  };

  describe('constructor', () => {
    test('throws error when email is missing', () => {
      expect(() => new UpstashClient({ email: '', apiKey: 'key' })).toThrow('Email is required');
    });

    test('throws error when apiKey is missing', () => {
      expect(() => new UpstashClient({ email: 'user@example.com', apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new UpstashClient(mockConfig);
      expect(client).toBeInstanceOf(UpstashClient);
    });
  });

  describe('request', () => {
    test('sends Basic auth header with base64(email:apiKey)', async () => {
      const expectedAuth = `Basic ${Buffer.from('user@example.com:test-api-key-12345').toString('base64')}`;
      const recorded = installFetch(() => ({ ok: true, status: 200, body: [] }));

      const client = new UpstashClient(mockConfig);
      await client.request('/redis/databases');

      expect(recorded).toHaveLength(1);
      expect(recorded[0].headers.Authorization).toBe(expectedAuth);
      expect(recorded[0].headers.Accept).toBe('application/json');
    });

    test('uses 15 second timeout signal', async () => {
      let capturedSignal: AbortSignal | null | undefined;
      globalThis.fetch = (async (_input, init) => {
        capturedSignal = init?.signal;
        return {
          ok: true,
          status: 200,
          async text() { return '[]'; },
        } as Response;
      }) as typeof fetch;

      const client = new UpstashClient(mockConfig);
      await client.request('/redis/databases');
      expect(capturedSignal).toBeDefined();
    });

    test('redacts password fields in successful responses', async () => {
      installFetch(() => ({
        ok: true,
        status: 200,
        body: {
          database_id: 'abc',
          database_name: 'mydb',
          password: 'super-secret',
        },
      }));

      const client = new UpstashClient(mockConfig);
      const result = await client.request<Record<string, unknown>>('/redis/database/abc');
      expect(result.password).toBe('[redacted]');
    });

    test('throws UpstashApiError with parsed error message on failure', async () => {
      installFetch(() => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        body: { error: 'Invalid credentials' },
      }));

      const client = new UpstashClient(mockConfig);
      try {
        await client.request('/redis/databases');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UpstashApiError);
        expect((err as UpstashApiError).message).toBe('Invalid credentials');
        expect((err as UpstashApiError).statusCode).toBe(401);
      }
    });

    test('POST sends JSON body with Content-Type header', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        body: { database_id: 'new', database_name: 'test' },
      }));

      const client = new UpstashClient(mockConfig);
      await client.request('/redis/database', {
        method: 'POST',
        body: { name: 'test', region: 'us-east-1', tls: true },
      });

      expect(recorded[0].url).toBe('https://api.upstash.com/v2/redis/database');
      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(recorded[0].body!)).toEqual({
        name: 'test',
        region: 'us-east-1',
        tls: true,
      });
    });
  });

  describe('redactSensitive', () => {
    test('redacts password at top level', () => {
      const result = redactSensitive({ password: 'secret', name: 'db' });
      expect(result.password).toBe('[redacted]');
      expect(result.name).toBe('db');
    });

    test('redacts nested password fields', () => {
      const result = redactSensitive({
        database: { password: 'secret', id: '1' },
      });
      expect((result.database as Record<string, unknown>).password).toBe('[redacted]');
    });

    test('redacts fields ending with _password', () => {
      const result = redactSensitive({ db_password: 'secret' });
      expect(result.db_password).toBe('[redacted]');
    });
  });
});
