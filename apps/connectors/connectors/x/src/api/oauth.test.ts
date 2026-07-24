import { afterEach, describe, expect, test } from 'bun:test';
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
  type OAuth2Config,
} from './oauth';

/**
 * Regression tests for https://github.com/hasna/connectors/issues/1
 *
 * X rejects `Authorization: Basic <client_id:client_secret>` on
 * POST /2/oauth2/token when the app is registered as a *public* client:
 *   {"error":"unauthorized_client",
 *    "error_description":"Missing valid authorization header"}
 *
 * The connector therefore must always authenticate the client with POST body
 * parameters (`client_id`, plus `client_secret` when one is configured) and
 * must never fall back to an Authorization header on the token/revoke
 * endpoints.
 */

interface CapturedRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: URLSearchParams;
}

const realFetch = globalThis.fetch;

/**
 * Normalise every shape `RequestInit.headers` can take (plain object, entry
 * array, `Headers` instance) into a lower-cased record. Going through
 * `new Headers(...)` matters: if the implementation ever switched to a
 * `Headers` object, a naive `Object.entries()` would yield `[]` and the
 * "no Authorization header" assertions below would pass vacuously.
 */
function normaliseHeaders(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init?.headers) return out;
  new Headers(init.headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function captureTokenRequest(): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = normaliseHeaders(init);

    calls.push({
      url: String(input),
      method: init?.method,
      headers,
      body: new URLSearchParams(String(init?.body ?? '')),
    });

    return new Response(
      JSON.stringify({
        access_token: 'ACCESS_TOKEN',
        refresh_token: 'NEW_REFRESH_TOKEN',
        expires_in: 7200,
        scope: 'tweet.read tweet.write offline.access',
        token_type: 'bearer',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  return { calls };
}

const PUBLIC_CLIENT: OAuth2Config = {
  clientId: 'PUBLIC_CLIENT_ID',
  redirectUri: 'http://localhost:8888/callback',
};

const CONFIDENTIAL_CLIENT: OAuth2Config = {
  clientId: 'CONFIDENTIAL_CLIENT_ID',
  clientSecret: 'CONFIDENTIAL_CLIENT_SECRET',
  redirectUri: 'http://localhost:8888/callback',
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('OAuth 2.0 token requests - public client (issue #1)', () => {
  test('exchangeCodeForTokens sends client_id in the body and no auth header', async () => {
    const { calls } = captureTokenRequest();

    const tokens = await exchangeCodeForTokens(
      PUBLIC_CLIENT,
      'AUTH_CODE',
      'CODE_VERIFIER'
    );

    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.url).toBe('https://api.twitter.com/2/oauth2/token');
    expect(req.method).toBe('POST');
    expect(req.headers['authorization']).toBeUndefined();
    expect(req.headers['content-type']).toBe(
      'application/x-www-form-urlencoded'
    );
    expect(req.body.get('client_id')).toBe('PUBLIC_CLIENT_ID');
    expect(req.body.get('client_secret')).toBeNull();
    expect(req.body.get('grant_type')).toBe('authorization_code');
    expect(req.body.get('code')).toBe('AUTH_CODE');
    expect(req.body.get('code_verifier')).toBe('CODE_VERIFIER');
    expect(req.body.get('redirect_uri')).toBe(
      'http://localhost:8888/callback'
    );

    expect(tokens.accessToken).toBe('ACCESS_TOKEN');
    expect(tokens.refreshToken).toBe('NEW_REFRESH_TOKEN');
  });

  test('refreshAccessToken sends client_id in the body and no auth header', async () => {
    const { calls } = captureTokenRequest();

    await refreshAccessToken(PUBLIC_CLIENT, 'OLD_REFRESH_TOKEN');

    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.url).toBe('https://api.twitter.com/2/oauth2/token');
    expect(req.headers['authorization']).toBeUndefined();
    expect(req.body.get('grant_type')).toBe('refresh_token');
    expect(req.body.get('refresh_token')).toBe('OLD_REFRESH_TOKEN');
    expect(req.body.get('client_id')).toBe('PUBLIC_CLIENT_ID');
    expect(req.body.get('client_secret')).toBeNull();
  });

  test('revokeToken sends client_id in the body and no auth header', async () => {
    const { calls } = captureTokenRequest();

    await revokeToken(PUBLIC_CLIENT, 'SOME_ACCESS_TOKEN', 'access_token');

    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.url).toBe('https://api.twitter.com/2/oauth2/revoke');
    expect(req.headers['authorization']).toBeUndefined();
    expect(req.body.get('token')).toBe('SOME_ACCESS_TOKEN');
    expect(req.body.get('token_type_hint')).toBe('access_token');
    expect(req.body.get('client_id')).toBe('PUBLIC_CLIENT_ID');
  });
});

describe('OAuth 2.0 token requests - configured client secret (issue #1)', () => {
  // This is the exact trigger of issue #1: a client_secret is present in the
  // connector config (env var or ~/.hasna/connectors/connect-x/credentials.json)
  // while the X app itself is registered as a public client. Sending Basic auth
  // in that situation is what produced "Missing valid authorization header".
  test('never falls back to Basic auth when a client secret is configured', async () => {
    const { calls } = captureTokenRequest();

    await exchangeCodeForTokens(
      CONFIDENTIAL_CLIENT,
      'AUTH_CODE',
      'CODE_VERIFIER'
    );
    await refreshAccessToken(CONFIDENTIAL_CLIENT, 'OLD_REFRESH_TOKEN');
    await revokeToken(CONFIDENTIAL_CLIENT, 'SOME_ACCESS_TOKEN');

    expect(calls).toHaveLength(3);
    for (const req of calls) {
      expect(req.headers['authorization']).toBeUndefined();
      expect(req.body.get('client_id')).toBe('CONFIDENTIAL_CLIENT_ID');
    }
  });

  test('still authenticates the client via client_secret_post', async () => {
    const { calls } = captureTokenRequest();

    await exchangeCodeForTokens(
      CONFIDENTIAL_CLIENT,
      'AUTH_CODE',
      'CODE_VERIFIER'
    );

    expect(calls[0]!.body.get('client_secret')).toBe(
      'CONFIDENTIAL_CLIENT_SECRET'
    );
  });
});

describe('OAuth 2.0 token requests - error surfacing', () => {
  test('exchangeCodeForTokens surfaces the X error payload', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: 'unauthorized_client',
          error_description: 'Missing valid authorization header',
        }),
        { status: 400 }
      )) as typeof fetch;

    await expect(
      exchangeCodeForTokens(PUBLIC_CLIENT, 'AUTH_CODE', 'CODE_VERIFIER')
    ).rejects.toThrow(/Token exchange failed:.*unauthorized_client/s);
  });
});
