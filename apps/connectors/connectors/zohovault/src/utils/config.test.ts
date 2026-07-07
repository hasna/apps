import { afterEach, describe, expect, test } from 'bun:test';
import { statSync } from 'fs';
import { join } from 'path';
import {
  clearConfig,
  clearOAuthTokens,
  getConfigDir,
  getToken,
  loadOAuthTokens,
  saveOAuthTokens,
  setToken,
} from './config';

describe('Zoho Vault config token storage', () => {
  afterEach(() => {
    delete process.env.ZOHOVAULT_TOKEN;
    delete process.env.CONNECTOR_TOKEN;
    delete process.env.CONNECTOR_API_KEY;
    clearConfig();
  });

  test('syncs OAuth access tokens to token aliases used by API commands', () => {
    saveOAuthTokens({
      accessToken: 'new-tok',
      refreshToken: 'ref-tok',
      expiresAt: Date.now() + 3600,
      tokenType: 'Bearer',
      scope: 'ZohoVault.secrets.ALL',
    });

    expect(getToken()).toBe('new-tok');
    expect(loadOAuthTokens()?.accessToken).toBe('new-tok');
  });

  test('logout clears OAuth tokens and stored token aliases', () => {
    setToken('manual');
    saveOAuthTokens({
      accessToken: 'oauth',
      refreshToken: 'ref',
      expiresAt: Date.now() + 3600,
    });

    clearOAuthTokens();

    expect(getToken()).toBeUndefined();
    expect(loadOAuthTokens()).toBeNull();
  });

  test('stores profile credentials with owner-only permissions', () => {
    saveOAuthTokens({
      accessToken: 'oauth',
      refreshToken: 'ref',
      expiresAt: Date.now() + 3600,
    });

    const configMode = statSync(getConfigDir()).mode & 0o777;
    const profilesMode = statSync(join(getConfigDir(), 'profiles')).mode & 0o777;
    const profileMode = statSync(join(getConfigDir(), 'profiles', 'default.json')).mode & 0o777;

    expect(configMode).toBe(0o700);
    expect(profilesMode).toBe(0o700);
    expect(profileMode).toBe(0o600);
  });
});
