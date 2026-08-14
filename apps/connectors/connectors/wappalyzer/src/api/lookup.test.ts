import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { LookupApi } from './lookup';

describe('LookupApi', () => {
  let lookup: LookupApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    lookup = new LookupApi(new ConnectorClient({ apiKey: 'test-key', baseUrl: 'https://api.wappalyzer.com/v2' }));
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('requires at least one URL', async () => {
    await expect(lookup.lookup({ urls: [] })).rejects.toThrow('At least one URL is required');
  });

  test('rejects more than ten URLs', async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://example${i}.com`);
    await expect(lookup.lookup({ urls })).rejects.toThrow('Maximum 10 URLs per request');
  });

  test('builds comma-separated urls query param', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('[{"url":"https://example.com","technologies":[]}]'),
      } as Response)
    );

    const result = await lookup.lookup({
      urls: ['https://example.com', 'https://example.org'],
      recursive: false,
      live: true,
    });

    expect(result).toHaveLength(1);
    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('urls=https%3A%2F%2Fexample.com%2Chttps%3A%2F%2Fexample.org');
    expect(url).toContain('recursive=false');
    expect(url).toContain('live=true');
  });
});
