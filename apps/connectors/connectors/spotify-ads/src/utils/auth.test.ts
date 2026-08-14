import { afterEach, expect, test } from 'bun:test';
import { getAuthUrl, validateOAuthState } from './auth';

const originalClientId = process.env.SPOTIFY_ADS_CLIENT_ID;

afterEach(() => {
  if (originalClientId === undefined) {
    delete process.env.SPOTIFY_ADS_CLIENT_ID;
  } else {
    process.env.SPOTIFY_ADS_CLIENT_ID = originalClientId;
  }
});

test('OAuth URL includes fresh state and validates callback state', () => {
  process.env.SPOTIFY_ADS_CLIENT_ID = 'test-client-id';

  const firstUrl = new URL(getAuthUrl());
  const secondUrl = new URL(getAuthUrl());
  const state = secondUrl.searchParams.get('state');

  expect(firstUrl.searchParams.get('state')).toBeTruthy();
  expect(state).toBeTruthy();
  expect(state).not.toBe(firstUrl.searchParams.get('state'));
  expect(validateOAuthState(null)).toBe(false);
  expect(validateOAuthState('wrong-state')).toBe(false);
  expect(validateOAuthState(state)).toBe(true);
});
