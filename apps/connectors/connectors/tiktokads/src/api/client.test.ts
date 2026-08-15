import { describe, expect, test } from 'bun:test';
import { TikTokAdsClient } from './client';
import { TikTokAdsApiError } from '../types';

describe('TikTokAdsClient', () => {
  test('throws TikTokAdsApiError when API returns non-zero code', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ code: 40001, message: 'Invalid parameter', request_id: 'req-1', data: null }),
        { headers: { 'content-type': 'application/json' } },
      );

    const client = new TikTokAdsClient({ accessToken: 'test-token' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    try {
      await expect(client.get('/campaign/get/', { advertiser_id: '1' })).rejects.toBeInstanceOf(
        TikTokAdsApiError,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns data when API code is zero', async () => {
    const payload = { list: [{ campaign_id: '123', campaign_name: 'Test' }] };
    const fetchImpl = async () =>
      new Response(JSON.stringify({ code: 0, message: 'OK', data: payload }), {
        headers: { 'content-type': 'application/json' },
      });

    const client = new TikTokAdsClient({ accessToken: 'test-token' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    try {
      const result = await client.get('/campaign/get/', { advertiser_id: '1' });
      expect(result).toEqual(payload);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('requireAdvertiserId uses default from config', () => {
    const client = new TikTokAdsClient({ accessToken: 'tok', advertiserId: 'adv-1' });
    expect(client.requireAdvertiserId()).toBe('adv-1');
    expect(client.requireAdvertiserId('adv-2')).toBe('adv-2');
  });
});
