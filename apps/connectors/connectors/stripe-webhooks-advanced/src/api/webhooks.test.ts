import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WebhooksApi } from './webhooks';
import { ConnectorClient } from './client';

describe('WebhooksApi', () => {
  let client: ConnectorClient;
  let webhooks: WebhooksApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new ConnectorClient({ apiKey: 'sk_test_key' });
    webhooks = new WebhooksApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockFetch = (response: unknown, status = 200) => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(response)),
      } as Response),
    );
  };

  test('list calls GET /webhook_endpoints', async () => {
    mockFetch({ object: 'list', data: [], has_more: false, url: '/v1/webhook_endpoints' });
    await webhooks.list({ limit: 5 });
    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/webhook_endpoints');
    expect(url).toContain('limit=5');
    expect(options.method).toBe('GET');
  });

  test('create posts to /webhook_endpoints', async () => {
    mockFetch({ id: 'we_1', object: 'webhook_endpoint' });
    await webhooks.create({ url: 'https://x.com', enabled_events: ['*'] });
    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/webhook_endpoints');
    expect(options.method).toBe('POST');
  });

  test('get calls GET /webhook_endpoints/:id', async () => {
    mockFetch({ id: 'we_123' });
    await webhooks.get('we_123');
    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/webhook_endpoints/we_123');
  });

  test('update posts to /webhook_endpoints/:id', async () => {
    mockFetch({ id: 'we_123', disabled: true });
    await webhooks.update('we_123', { disabled: true });
    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/webhook_endpoints/we_123');
    expect(options.method).toBe('POST');
  });

  test('del calls DELETE /webhook_endpoints/:id', async () => {
    mockFetch({ id: 'we_123', deleted: true });
    await webhooks.del('we_123');
    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/webhook_endpoints/we_123');
    expect(options.method).toBe('DELETE');
  });
});
