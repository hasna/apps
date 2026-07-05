import { afterEach, describe, expect, test } from 'bun:test';
import { TwitchClient } from './client';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: RecordedRequest[]) => unknown,
) {
  const recorded: RecordedRequest[] = [];
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
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return json ?? {};
      },
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

describe('TwitchClient', () => {
  test('requires client id and secret', () => {
    expect(() => new TwitchClient({ clientId: '', clientSecret: 's' })).toThrow(/Client ID/);
    expect(() => new TwitchClient({ clientId: 'id', clientSecret: '' })).toThrow(/Client Secret/);
  });

  test('sends Authorization Bearer and Client-Id headers on Helix requests', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('/oauth2/token')) {
        return { access_token: 'new-token', expires_in: 3600, scope: ['user:read:email'], token_type: 'bearer' };
      }
      if (url.includes('/helix/users')) {
        return { data: [{ id: '1', login: 'test', display_name: 'Test', type: '', broadcaster_type: '', description: '', profile_image_url: '', created_at: '' }] };
      }
      return {};
    });

    const client = new TwitchClient({
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: Date.now() - 1000,
    });

    await client.request('/users');
    const helixCall = recorded.find((r) => r.url.includes('/helix/users'))!;
    expect(helixCall.headers.Authorization).toBe('Bearer new-token');
    expect(helixCall.headers['Client-Id']).toBe('test-client-id');
  });

  test('parses Helix error envelope', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return { error: 'Unauthorized', status: 401, message: 'Invalid OAuth token' };
      },
      async text() {
        return JSON.stringify({ message: 'Invalid OAuth token' });
      },
    })) as unknown as typeof fetch;

    const client = new TwitchClient({
      clientId: 'id',
      clientSecret: 'secret',
      accessToken: 'bad-token',
      tokenExpiresAt: Date.now() + 3600000,
    });

    await expect(client.request('/users')).rejects.toThrow(/Invalid OAuth token/);
  });

  test('getAuthorizationUrl includes required OAuth params', () => {
    const url = TwitchClient.getAuthorizationUrl('cid', 'http://localhost:8889/callback', ['user:read:email'], 'state123');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('response_type=code');
    expect(url).toContain('state=state123');
    expect(url).toContain('user%3Aread%3Aemail');
  });

  test('exchangeCode posts authorization_code grant', async () => {
    const recorded = installFetch((url, init) => {
      if (url.includes('/oauth2/token')) {
        expect(init?.method).toBe('POST');
        const body = init?.body;
        const bodyText = typeof body === 'string' ? body : body?.toString() ?? '';
        expect(bodyText).toContain('grant_type=authorization_code');
        expect(bodyText).toContain('code=auth-code');
        return { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: ['user:read:email'], token_type: 'bearer' };
      }
      return {};
    });

    const result = await TwitchClient.exchangeCode('cid', 'secret', 'auth-code', 'http://localhost/callback');
    expect(result.access_token).toBe('at');
    expect(recorded.some((r) => r.url.includes('/oauth2/token'))).toBe(true);
  });
});
