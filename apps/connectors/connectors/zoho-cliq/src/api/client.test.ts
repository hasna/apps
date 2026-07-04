import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoCliq, resolveZohoCliqBaseUrl, ZOHO_CLIQ_DC_BASES } from './index';
import { ZohoCliqApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers as Record<string, string>;
      for (const [key, value] of Object.entries(raw)) {
        headers[key.toLowerCase()] = value;
      }
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
    });
    const json = handler(url, init, recorded);
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

describe('resolveZohoCliqBaseUrl', () => {
  test('maps known data centers to v2 API base URLs', () => {
    expect(resolveZohoCliqBaseUrl('com')).toBe('https://cliq.zoho.com/api/v2');
    expect(resolveZohoCliqBaseUrl('eu')).toBe('https://cliq.zoho.eu/api/v2');
    expect(resolveZohoCliqBaseUrl('com.au')).toBe('https://cliq.zoho.com.au/api/v2');
    expect(Object.keys(ZOHO_CLIQ_DC_BASES)).toHaveLength(7);
  });

  test('rejects unknown data centers', () => {
    expect(() => resolveZohoCliqBaseUrl('invalid')).toThrow(ZohoCliqApiError);
  });

  test('honors explicit base URL override', () => {
    expect(resolveZohoCliqBaseUrl('com', 'https://custom.example/api/v2/')).toBe(
      'https://custom.example/api/v2'
    );
  });
});

describe('ZohoCliqClient transport', () => {
  test('users.me uses Zoho-oauthtoken auth and EU data center', async () => {
    const recorded = installFetch(() => ({ id: 'user-1', name: 'Test User' }));
    const cliq = new ZohoCliq({ token: 'test-token', dataCenter: 'eu' });
    const me = await cliq.users.me();

    expect(me).toEqual({ id: 'user-1', name: 'Test User' });
    expect(recorded[0].url).toBe('https://cliq.zoho.eu/api/v2/users/me');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Zoho-oauthtoken test-token');
  });

  test('sendToChannelByName POSTs message body to channelsbyname path', async () => {
    const recorded = installFetch(() => ({ message_id: 'm1' }));
    const cliq = new ZohoCliq({ token: 'tok', dataCenter: 'com' });
    await cliq.messages.sendToChannelByName('general', { text: 'hello team' });

    expect(recorded[0].url).toBe('https://cliq.zoho.com/api/v2/channelsbyname/general/message');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ text: 'hello team' });
  });

  test('channels.list forwards query params', async () => {
    const recorded = installFetch(() => ({ channels: [] }));
    const cliq = new ZohoCliq({ token: 'tok', dataCenter: 'com' });
    await cliq.channels.list({ limit: 5, offset: 10, type: 'team' });

    expect(recorded[0].url).toBe('https://cliq.zoho.com/api/v2/channels?limit=5&offset=10&type=team');
  });

  test('requires token', () => {
    expect(() => new ZohoCliq({ token: '' })).toThrow('Zoho Cliq token is required');
  });

  test('surfaces API errors from response body', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async text() {
          return JSON.stringify({ error: { message: 'Invalid OAuth token', code: 'OAUTH_SCOPE_MISMATCH' } });
        },
      }) as Response) as unknown as typeof fetch;

    const cliq = new ZohoCliq({ token: 'bad', dataCenter: 'com' });
    await expect(cliq.users.me()).rejects.toThrow('Invalid OAuth token');
  });
});
