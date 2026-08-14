import { afterEach, describe, expect, mock, test } from 'bun:test';
import { TwilioApiPlatform, TwilioApiPlatformClient, DEFAULT_BASE_URL } from './index';
import { TwilioApiPlatformApiError } from '../types';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

function installFetch(onRequest?: (url: string, init?: RequestInit) => unknown) {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured.push({ url, init });
    const payload = onRequest?.(url, init) ?? { ok: true };
    return Response.json(payload);
  }) as unknown as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TwilioApiPlatformClient', () => {
  test('requires api key', () => {
    expect(() => new TwilioApiPlatformClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('uses default base URL', () => {
    expect(DEFAULT_BASE_URL).toBe('https://api.twilioapiplatform.com/v1');
  });

  test('listItems sends Bearer auth to /items', async () => {
    const captured = installFetch();
    const client = new TwilioApiPlatformClient({ apiKey: 'twilio-api-platform-key' });
    await client.get('/items');

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://api.twilioapiplatform.com/v1/items');
    expect(new Headers(captured[0].init?.headers).get('Authorization')).toBe('Bearer twilio-api-platform-key');
  });

  test('getItem encodes item id in path', async () => {
    const captured = installFetch();
    const api = new TwilioApiPlatform({ apiKey: 'twilio-api-platform-key' });
    await api.getItem('item-1');

    expect(captured[0].url).toBe('https://api.twilioapiplatform.com/v1/items/item-1');
    expect(new Headers(captured[0].init?.headers).get('Authorization')).toBe('Bearer twilio-api-platform-key');
  });

  test('supports custom base URL override', async () => {
    const captured = installFetch();
    const client = new TwilioApiPlatformClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example/v2/',
    });
    await client.get('/events');

    expect(captured[0].url).toBe('https://custom.example/v2/events');
  });

  test('search posts JSON body to /search', async () => {
    const captured = installFetch();
    const api = new TwilioApiPlatform({ apiKey: 'key' });
    await api.search({ q: 'hello' });

    const request = captured[0];
    expect(request.url).toBe('https://api.twilioapiplatform.com/v1/search');
    expect(request.init?.method).toBe('POST');
    expect(request.init?.body).toBe(JSON.stringify({ q: 'hello' }));
  });

  test('throws TwilioApiPlatformApiError on failed response', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ message: 'Unauthorized' }, { status: 401 }),
    ) as unknown as typeof fetch;

    const client = new TwilioApiPlatformClient({ apiKey: 'bad-key' });
    await expect(client.get('/items')).rejects.toThrow(TwilioApiPlatformApiError);
  });
});
