import { afterEach, expect, test } from 'bun:test';
import { getAuthUrl, getRedirectPort, startCallbackServer } from './auth';

const originalClientId = process.env.SPOTIFY_ADS_CLIENT_ID;

afterEach(() => {
  if (originalClientId === undefined) {
    delete process.env.SPOTIFY_ADS_CLIENT_ID;
  } else {
    process.env.SPOTIFY_ADS_CLIENT_ID = originalClientId;
  }
});

async function fetchWhenReady(url: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await fetch(url);
    } catch (err) {
      lastError = err;
      await Bun.sleep(10);
    }
  }

  throw lastError;
}

test('OAuth URL includes fresh state and callback rejects invalid state', async () => {
  process.env.SPOTIFY_ADS_CLIENT_ID = 'test-client-id';

  const firstUrl = new URL(getAuthUrl());
  const secondUrl = new URL(getAuthUrl());
  const state = secondUrl.searchParams.get('state');

  expect(firstUrl.searchParams.get('state')).toBeTruthy();
  expect(state).toBeTruthy();
  expect(state).not.toBe(firstUrl.searchParams.get('state'));

  const callbackResult = startCallbackServer();
  const response = await fetchWhenReady(
    `http://127.0.0.1:${getRedirectPort()}/callback?code=test-code&state=wrong-state`
  );

  expect(response.status).toBe(400);
  await expect(callbackResult).resolves.toEqual({ success: false, error: 'Invalid OAuth state' });
});
