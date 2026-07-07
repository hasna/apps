import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TicketSourceClient } from './client';

type MockFetch = ReturnType<typeof mock<(...args: Parameters<typeof fetch>) => Promise<Response>>>;

function installMockFetch(implementation: (...args: Parameters<typeof fetch>) => Promise<Response>): MockFetch {
  const mockedFetch = mock(implementation);
  global.fetch = mockedFetch as unknown as typeof fetch;
  return mockedFetch;
}

describe('TicketSourceClient', () => {
  const mockConfig = {
    apiKey: 'ticketsource-key',
    baseUrl: 'https://api.ticketsource.io',
  };

  describe('constructor', () => {
    test('throws error when api key is missing', () => {
      expect(() => new TicketSourceClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new TicketSourceClient(mockConfig);
      expect(client).toBeInstanceOf(TicketSourceClient);
    });
  });

  describe('listEvents', () => {
    let client: TicketSourceClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new TicketSourceClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('makes GET request with Bearer auth to /events', async () => {
      const mockResponse = { events: [] };
      const mockedFetch = installMockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
          json: () => Promise.resolve(mockResponse),
        } as Response)
      );

      const result = await client.listEvents();

      expect(result).toEqual(mockResponse);
      expect(mockedFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockedFetch.mock.calls[0];
      expect(url).toBe('https://api.ticketsource.io/events');
      expect(options?.method).toBe('GET');
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer ticketsource-key');
      expect((options?.headers as Record<string, string>).Accept).toBe('application/json');
    });

    test('passes query parameters', async () => {
      const mockedFetch = installMockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{}'),
          json: () => Promise.resolve({}),
        } as Response)
      );

      await client.listEvents({ page: 2, limit: 10 });

      const [url] = mockedFetch.mock.calls[0];
      expect(url).toBe('https://api.ticketsource.io/events?page=2&limit=10');
    });
  });

  describe('getEvent', () => {
    let client: TicketSourceClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new TicketSourceClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('encodes event id in path', async () => {
      const mockedFetch = installMockFetch(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{}'),
          json: () => Promise.resolve({}),
        } as Response)
      );

      await client.getEvent('event/123');

      const [url] = mockedFetch.mock.calls[0];
      expect(url).toBe('https://api.ticketsource.io/events/event%2F123');
    });
  });
});
