import { describe, it, expect, mock } from 'bun:test';
import { WordfenceApiPlatformClient, DEFAULT_BASE_URL } from './client';
import { WordfenceApiPlatform } from './index';

describe('WordfenceApiPlatformClient', () => {
  it('requires apiKey', () => {
    expect(() => new WordfenceApiPlatformClient({ apiKey: '' })).toThrow('apiKey is required');
  });

  it('defaults base URL to Intelligence v3', () => {
    const client = new WordfenceApiPlatformClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  it('sends Bearer authorization and builds vulnerability feed path', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: string, options: RequestInit) => {
      capturedUrl = _url;
      capturedHeaders = options.headers as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify({ 'abc123': { title: 'Test', published: '2024-01-01' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    const client = new WordfenceApiPlatformClient({ apiKey: 'wf-test-key' });
    await client.request('/vulnerabilities/production');

    expect(capturedUrl).toBe('https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production');
    expect(capturedHeaders.Authorization).toBe('Bearer wf-test-key');

    globalThis.fetch = originalFetch;
  });

  it('supports custom base URL override', async () => {
    const client = new WordfenceApiPlatformClient({
      apiKey: 'wf-test-key',
      baseUrl: 'https://example.test/api/v1/',
    });
    expect(client.getBaseUrl()).toBe('https://example.test/api/v1');
  });
});

describe('WordfenceApiPlatform', () => {
  it('getItem returns a vulnerability from the feed', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            vuln1: { title: 'Plugin XSS', published: '2024-05-01', cve: 'CVE-2024-0001' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;

    const api = new WordfenceApiPlatform({ apiKey: 'wf-test-key' });
    const item = await api.getItem({ itemId: 'vuln1' });
    expect(item.title).toBe('Plugin XSS');
    expect(item.id).toBe('vuln1');

    globalThis.fetch = originalFetch;
  });

  it('search filters vulnerabilities by query', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            a: { title: 'Contact Form 7 issue', software: [{ slug: 'contact-form-7' }] },
            b: { title: 'Unrelated theme issue', software: [{ slug: 'some-theme' }] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;

    const api = new WordfenceApiPlatform({ apiKey: 'wf-test-key' });
    const results = await api.search({ query: 'contact form', limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toContain('Contact Form 7');

    globalThis.fetch = originalFetch;
  });

  it('createItem rejects read-only feed writes', async () => {
    const api = new WordfenceApiPlatform({ apiKey: 'wf-test-key' });
    await expect(api.createItem()).rejects.toThrow('read-only');
  });
});
