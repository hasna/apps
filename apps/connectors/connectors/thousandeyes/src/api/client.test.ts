import { afterEach, describe, expect, test } from 'bun:test';
import { ThousandEyesClient } from './client';
import { ThousandEyesApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) || {}),
    );
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

describe('ThousandEyesClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-1234567890',
    baseUrl: 'https://api.thousandeyes.com/v1',
  };

  test('throws error when apiKey is missing', () => {
    expect(() => new ThousandEyesClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('get() sends Bearer authorization and hits /v1/tests', async () => {
    const recorded = installFetch(() => ({ tests: [] }));
    const client = new ThousandEyesClient(mockConfig);
    const result = await client.get('/tests');

    expect(result).toEqual({ tests: [] });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.thousandeyes.com/v1/tests');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization).toBe('Bearer test-api-key-1234567890');
  });

  test('getTest path encodes test id', async () => {
    const recorded = installFetch(() => ({ testId: '123' }));
    const client = new ThousandEyesClient(mockConfig);
    await client.get('/tests/123');

    expect(recorded[0].url).toBe('https://api.thousandeyes.com/v1/tests/123');
  });

  test('post() sends JSON body for createTest', async () => {
    const recorded = installFetch(() => ({ testId: 'new' }));
    const client = new ThousandEyesClient(mockConfig);
    await client.post('/tests', { testName: 'HTTP test', type: 'http-server' });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ testName: 'HTTP test', type: 'http-server' }));
    expect(recorded[0].headers['Content-Type']).toBe('application/json');
  });

  test('throws ThousandEyesApiError on non-OK response', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify({ message: 'Invalid token' });
        },
      }) as Response) as unknown as typeof fetch;

    const client = new ThousandEyesClient(mockConfig);
    await expect(client.get('/tests')).rejects.toThrow(ThousandEyesApiError);
    await expect(client.get('/tests')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid token',
    });
  });

  test('getApiKeyPreview masks long keys', () => {
    const client = new ThousandEyesClient(mockConfig);
    expect(client.getApiKeyPreview()).toBe('test-a...7890');
  });
});
