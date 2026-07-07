import { afterEach, describe, expect, test } from 'bun:test';
import { Veriphone, VeriphoneClient } from './index';
import { VeriphoneApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => { ok: boolean; status: number; json: unknown },
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = init?.headers as Record<string, string> | undefined;
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const { ok, status, json } = handler(url, init, recorded);
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      async text() {
        return JSON.stringify(json);
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('VeriphoneClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.veriphone.io/v2',
  };

  test('constructor throws when apiKey is missing', () => {
    expect(() => new VeriphoneClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('GET /verify sends Bearer header and query params', async () => {
    const recorded = installFetch(() => ({
      ok: true,
      status: 200,
      json: {
        status: 'success',
        phone: '+4915123577723',
        phone_valid: true,
        carrier: 'T-Mobile',
        e164: '+4915123577723',
      },
    }));

    const client = new VeriphoneClient(mockConfig);
    const result = await client.get('/verify', { phone: '+4915123577723', default_country: 'DE' });

    expect(result).toMatchObject({ phone_valid: true, carrier: 'T-Mobile' });
    expect(recorded[0].url).toBe('https://api.veriphone.io/v2/verify?phone=%2B4915123577723&default_country=DE');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers?.Authorization).toBe('Bearer test-api-key-12345');
  });

  test('POST /verify sends JSON body with Bearer header', async () => {
    const recorded = installFetch(() => ({
      ok: true,
      status: 200,
      json: { status: 'success', phone: '+14155552671', phone_valid: true },
    }));

    const client = new VeriphoneClient(mockConfig);
    await client.post('/verify', { phone: '+14155552671', default_country: 'US' });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(recorded[0].body!)).toEqual({ phone: '+14155552671', default_country: 'US' });
  });

  test('parses 401 Unauthorized error', async () => {
    installFetch(() => ({
      ok: false,
      status: 401,
      json: {
        status: 'error',
        code: 401,
        type: 'Unauthorized',
        message: 'Invalid or missing API key',
      },
    }));

    const client = new VeriphoneClient(mockConfig);
    await expect(client.get('/verify', { phone: '+1234' })).rejects.toMatchObject({
      name: 'VeriphoneApiError',
      statusCode: 401,
      message: 'Invalid or missing API key',
    });
  });

  test('parses 400 BadRequest error', async () => {
    installFetch(() => ({
      ok: false,
      status: 400,
      json: {
        status: 'error',
        code: 400,
        type: 'BadRequest',
        message: 'Invalid or missing input parameter',
      },
    }));

    const client = new VeriphoneClient(mockConfig);
    try {
      await client.get('/verify', { phone: '' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(VeriphoneApiError);
      const apiErr = err as VeriphoneApiError;
      expect(apiErr.statusCode).toBe(400);
      expect(apiErr.code).toBe(400);
      expect(apiErr.type).toBe('BadRequest');
    }
  });

  test('getApiKeyPreview masks long keys', () => {
    const client = new VeriphoneClient(mockConfig);
    expect(client.getApiKeyPreview()).toBe('test-a...2345');
  });
});

describe('Veriphone', () => {
  test('verifyPhone and verifyPhonePost delegate to client', async () => {
    const recorded = installFetch(() => ({
      ok: true,
      status: 200,
      json: { status: 'success', phone: '+123', phone_valid: true },
    }));

    const api = new Veriphone({ apiKey: 'key1234567890' });

    await api.verifyPhone({ phone: '+123', defaultCountry: 'US' });
    expect(recorded[0].url).toContain('default_country=US');

    await api.verifyPhonePost({ phone: '+456' });
    expect(recorded[1].method).toBe('POST');
  });
});
