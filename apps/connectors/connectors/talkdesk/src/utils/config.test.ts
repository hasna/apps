import { describe, test, expect, afterEach } from 'bun:test';
import {
  getClientId,
  getClientSecret,
  getAccessToken,
  getBaseUrl,
  getAuthUrl,
  isAuthenticated,
  resolveConfig,
} from './config';

/**
 * These tests drive the environment-variable resolution paths only, so they
 * never touch the on-disk profile store.
 */
describe('config env resolution', () => {
  const keys = [
    'TALKDESK_CLIENT_ID',
    'TALKDESK_CLIENT_SECRET',
    'TALKDESK_ACCESS_TOKEN',
    'TALKDESK_BASE_URL',
    'TALKDESK_AUTH_URL',
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('reads credentials from environment variables', () => {
    process.env.TALKDESK_CLIENT_ID = 'env-id';
    process.env.TALKDESK_CLIENT_SECRET = 'env-secret';
    process.env.TALKDESK_BASE_URL = 'https://eu.talkdeskapp.com';
    process.env.TALKDESK_AUTH_URL = 'https://acct.talkdeskid.com/oauth/token';

    expect(getClientId()).toBe('env-id');
    expect(getClientSecret()).toBe('env-secret');
    expect(getBaseUrl()).toBe('https://eu.talkdeskapp.com');
    expect(getAuthUrl()).toBe('https://acct.talkdeskid.com/oauth/token');
  });

  test('isAuthenticated is true with an access token in the environment', () => {
    delete process.env.TALKDESK_CLIENT_ID;
    delete process.env.TALKDESK_CLIENT_SECRET;
    process.env.TALKDESK_ACCESS_TOKEN = 'env-token';
    expect(getAccessToken()).toBe('env-token');
    expect(isAuthenticated()).toBe(true);
  });

  test('isAuthenticated requires authUrl with client id and secret in the environment', () => {
    delete process.env.TALKDESK_ACCESS_TOKEN;
    process.env.TALKDESK_CLIENT_ID = 'env-id';
    process.env.TALKDESK_CLIENT_SECRET = 'env-secret';
    delete process.env.TALKDESK_AUTH_URL;
    expect(isAuthenticated()).toBe(false);
    process.env.TALKDESK_AUTH_URL = 'https://example.talkdeskid.com/oauth/token';
    expect(isAuthenticated()).toBe(true);
  });

  test('resolveConfig assembles a TalkdeskConfig from the environment', () => {
    process.env.TALKDESK_CLIENT_ID = 'env-id';
    process.env.TALKDESK_CLIENT_SECRET = 'env-secret';
    process.env.TALKDESK_BASE_URL = 'https://eu.talkdeskapp.com';
    delete process.env.TALKDESK_ACCESS_TOKEN;
    process.env.TALKDESK_AUTH_URL = 'https://example.talkdeskid.eu/oauth/token';

    const cfg = resolveConfig();
    expect(cfg.clientId).toBe('env-id');
    expect(cfg.clientSecret).toBe('env-secret');
    expect(cfg.baseUrl).toBe('https://eu.talkdeskapp.com');
    expect(cfg.authUrl).toBe('https://example.talkdeskid.eu/oauth/token');
  });
});
