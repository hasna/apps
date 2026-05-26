import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { GmailClient } from './api/client';
import { Gmail } from './api/index';
import type { GmailTokens } from './api/index';
import * as auth from './utils/auth';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFetchResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function futureExpiry(msFromNow = 3600_000) {
  return Date.now() + msFromNow;
}

function pastExpiry(msAgo = 1000) {
  return Date.now() - msAgo;
}

// ─── GmailClient + tokenProvider ────────────────────────────────────────────

describe('GmailClient tokenProvider', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('uses injected tokenProvider instead of getValidAccessToken', async () => {
    const injectedToken = 'injected-access-token-xyz';
    const tokenProvider = mock(async () => injectedToken);

    const client = new GmailClient({ tokenProvider });

    // Intercept fetch to capture Authorization header
    const captured = { auth: '' };
    global.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      captured.auth = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
      return makeFetchResponse({ emailAddress: 'test@example.com', messagesTotal: 0, threadsTotal: 0, historyId: '1' });
    }) as unknown as typeof global.fetch;

    await client.request('/users/me/profile');

    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(captured.auth).toBe(`Bearer ${injectedToken}`);
  });

  test('default behavior (no options) calls getValidAccessToken path', async () => {
    const accessToken = 'default-auth-token';
    const getValidAccessTokenSpy = spyOn(auth, 'getValidAccessToken').mockResolvedValue(accessToken);
    const client = new GmailClient();

    const captured = { auth: '' };
    global.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      captured.auth = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
      return makeFetchResponse({ emailAddress: 'test@example.com', messagesTotal: 0, threadsTotal: 0, historyId: '1' });
    }) as unknown as typeof global.fetch;

    await client.request('/users/me/profile');

    expect(getValidAccessTokenSpy).toHaveBeenCalledTimes(1);
    expect(captured.auth).toBe(`Bearer ${accessToken}`);
    getValidAccessTokenSpy.mockRestore();
  });
});

// ─── Gmail.createWithTokens ──────────────────────────────────────────────────

describe('Gmail.createWithTokens', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const baseTokens: GmailTokens = {
    accessToken: 'access-token-initial',
    refreshToken: 'refresh-token-xyz',
    clientId: 'client-id-abc',
    clientSecret: 'client-secret-def',
    expiresAt: futureExpiry(),
  };

  test('uses accessToken when not expired', async () => {
    const tokens: GmailTokens = { ...baseTokens, expiresAt: futureExpiry() };
    const onRefresh = mock((_t: GmailTokens) => {});

    const gmail = Gmail.createWithTokens(tokens, onRefresh);

    const captured = { auth: '' };
    global.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      captured.auth = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
      return makeFetchResponse({ emailAddress: 'user@example.com', messagesTotal: 0, threadsTotal: 0, historyId: '1' });
    }) as unknown as typeof global.fetch;

    await gmail.profile.get();

    expect(onRefresh).not.toHaveBeenCalled();
    expect(captured.auth).toBe(`Bearer ${tokens.accessToken}`);
  });

  test('calls onRefresh with new tokens when accessToken is expired', async () => {
    const tokens: GmailTokens = { ...baseTokens, expiresAt: pastExpiry() };
    const receivedTokens: GmailTokens[] = [];
    const onRefresh = mock((t: GmailTokens) => { receivedTokens.push(t); });

    const gmail = Gmail.createWithTokens(tokens, onRefresh);

    const newAccessToken = 'access-token-refreshed';
    let callCount = 0;

    global.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      callCount++;

      // First call: token refresh endpoint
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return makeFetchResponse({
          access_token: newAccessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'https://mail.google.com/',
        });
      }

      // Second call: actual API call — capture Authorization header
      return makeFetchResponse({
        emailAddress: 'user@example.com',
        messagesTotal: 0,
        threadsTotal: 0,
        historyId: '1',
      });
    }) as unknown as typeof global.fetch;

    await gmail.profile.get();

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(receivedTokens[0].accessToken).toBe(newAccessToken);
    expect(receivedTokens[0].refreshToken).toBe(tokens.refreshToken);
    expect(receivedTokens[0].clientId).toBe(tokens.clientId);
    expect(receivedTokens[0].clientSecret).toBe(tokens.clientSecret);
    expect(receivedTokens[0].expiresAt).toBeGreaterThan(Date.now());
  });

  test('onRefresh is optional — no error when omitted', async () => {
    const tokens: GmailTokens = { ...baseTokens, expiresAt: pastExpiry() };
    const gmail = Gmail.createWithTokens(tokens); // no onRefresh

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return makeFetchResponse({
          access_token: 'new-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: '',
        });
      }
      return makeFetchResponse({
        emailAddress: 'user@example.com',
        messagesTotal: 0,
        threadsTotal: 0,
        historyId: '1',
      });
    }) as unknown as typeof global.fetch;

    await expect(gmail.profile.get()).resolves.toBeDefined();
  });

  test('refreshed token is reused on subsequent calls without re-refreshing', async () => {
    const tokens: GmailTokens = { ...baseTokens, expiresAt: pastExpiry() };
    const onRefresh = mock((_t: GmailTokens) => {});

    const gmail = Gmail.createWithTokens(tokens, onRefresh);

    let refreshCallCount = 0;
    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        refreshCallCount++;
        return makeFetchResponse({
          access_token: 'refreshed-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: '',
        });
      }
      return makeFetchResponse({
        emailAddress: 'user@example.com',
        messagesTotal: 0,
        threadsTotal: 0,
        historyId: '1',
      });
    }) as unknown as typeof global.fetch;

    // Two consecutive calls — should only refresh once
    await gmail.profile.get();
    await gmail.profile.get();

    expect(refreshCallCount).toBe(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test('token without expiresAt is always refreshed', async () => {
    // When expiresAt is undefined, token should always be considered expired
    const tokens: GmailTokens = {
      ...baseTokens,
      expiresAt: undefined,
    };
    const onRefresh = mock((_t: GmailTokens) => {});

    const gmail = Gmail.createWithTokens(tokens, onRefresh);

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return makeFetchResponse({
          access_token: 'refreshed-no-expiry',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: '',
        });
      }
      return makeFetchResponse({
        emailAddress: 'user@example.com',
        messagesTotal: 0,
        threadsTotal: 0,
        historyId: '1',
      });
    }) as unknown as typeof global.fetch;

    await gmail.profile.get();

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
