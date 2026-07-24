import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { EventsApi } from './events';

describe('EventsApi', () => {
  let client: ConnectorClient;
  let events: EventsApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new ConnectorClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.sucuriapiplatform.com/v1',
    });
    events = new EventsApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('list() calls GET /events', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"events":[]}'),
      } as Response)
    );

    await events.list({ itemId: 'item-1' });

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('/events');
    expect(url).toContain('itemId=item-1');
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer test-key');
  });
});
