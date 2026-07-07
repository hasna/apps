import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { EventsApi } from './events';
import { ConnectorClient } from './client';

describe('EventsApi', () => {
  let client: ConnectorClient;
  let events: EventsApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new ConnectorClient({ apiKey: 'sk_test_key' });
    events = new EventsApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockFetch = (response: unknown) => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(response)),
      } as Response),
    );
  };

  test('list calls GET /events with filters', async () => {
    mockFetch({ object: 'list', data: [], has_more: false, url: '/v1/events' });
    await events.list({ limit: 10, type: 'invoice.paid' });
    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/events');
    expect(url).toContain('type=invoice.paid');
    expect(url).toContain('limit=10');
  });

  test('get calls GET /events/:id', async () => {
    mockFetch({ id: 'evt_123', object: 'event' });
    await events.get('evt_123');
    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/events/evt_123');
  });

  test('search maps query to type filter', async () => {
    mockFetch({ object: 'list', data: [], has_more: false, url: '/v1/events' });
    await events.search({ query: 'charge.succeeded', limit: 5 });
    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('type=charge.succeeded');
    expect(url).toContain('limit=5');
  });
});
