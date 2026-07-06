import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { TryPrismClient } from './client';
import { TryPrism } from './index';
import { TryPrismApiError } from '../types';

describe('TryPrismClient', () => {
  const mockConfig = {
    apiKey: 'prism-key',
    baseUrl: 'https://api.tryprism.com/v1',
  };

  let originalFetch: typeof global.fetch;
  let captured: Array<{ url: string; init?: RequestInit; body?: unknown }>;

  beforeEach(() => {
    captured = [];
    originalFetch = global.fetch;
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      let body: unknown;
      if (typeof init?.body === 'string') {
        body = JSON.parse(init.body);
      }
      captured.push({ url, init, body });
      return Response.json({ ok: true, connector: 'tryprism' });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    captured = [];
  });

  test('throws when apiKey is missing', () => {
    expect(() => new TryPrismClient({ apiKey: '' })).toThrow('TryPrism apiKey is required');
  });

  test('uses bearer credentials for search, candidate, and shortlist endpoints', async () => {
    const client = new TryPrism({
      apiKey: 'prism-key',
      baseUrl: 'https://api.tryprism.com/v1',
    });

    await client.listSearches({ limit: 4 });
    await client.getSearch('search 1');
    await client.createSearch({ title: 'Founding engineer', location: 'Remote' });
    await client.listCandidates({ searchId: 'search 1' });
    await client.getCandidate('cand 1');
    await client.submitCandidateFeedback('cand 1', { rating: 'strong_yes' });
    await client.listShortlists();
    await client.getShortlist('short 1');

    expect(captured.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', 'https://api.tryprism.com/v1/searches?limit=4'],
      ['GET', 'https://api.tryprism.com/v1/searches/search%201'],
      ['POST', 'https://api.tryprism.com/v1/searches'],
      ['GET', 'https://api.tryprism.com/v1/candidates?searchId=search+1'],
      ['GET', 'https://api.tryprism.com/v1/candidates/cand%201'],
      ['POST', 'https://api.tryprism.com/v1/candidates/cand%201/feedback'],
      ['GET', 'https://api.tryprism.com/v1/shortlists'],
      ['GET', 'https://api.tryprism.com/v1/shortlists/short%201'],
    ]);

    for (const request of captured) {
      expect(new Headers(request.init?.headers).get('Authorization')).toBe('Bearer prism-key');
    }

    expect(captured[2].body).toEqual({ title: 'Founding engineer', location: 'Remote' });
    expect(captured[5].body).toEqual({ rating: 'strong_yes' });
  });

  test('supports raw requests', async () => {
    const client = new TryPrism({ apiKey: 'prism-key' });
    await client.rawRequest({ path: '/searches', method: 'POST', body: { title: 'Raw' } });
    expect(captured[0].url).toBe('https://api.tryprism.com/v1/searches');
    expect(captured[0].init?.method).toBe('POST');
    expect(captured[0].body).toEqual({ title: 'Raw' });
  });

  test('throws TryPrismApiError on failed responses', async () => {
    global.fetch = mock(async () =>
      Response.json({ message: 'Unauthorized' }, { status: 401 }),
    ) as unknown as typeof fetch;

    const client = new TryPrismClient(mockConfig);
    await expect(client.get('/searches')).rejects.toThrow(TryPrismApiError);
  });
});
