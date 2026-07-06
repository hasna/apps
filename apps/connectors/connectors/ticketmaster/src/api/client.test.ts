import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { ConnectorClient } from './client';

const realFetch = globalThis.fetch;

function installFetch(handler: (url: string) => unknown) {
  const recorded: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push(url);
    const json = handler(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Ticketmaster Discovery API client', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('Ticketmaster API key is required');
  });

  test('search events URL includes apikey and query params', async () => {
    const recorded = installFetch(() => ({
      _embedded: { events: [] },
      page: { totalElements: 0 },
    }));

    const connector = new Connector({ apiKey: 'test-key-123' });
    await connector.events.search({ countryCode: 'US', keyword: 'concert', size: 10 });

    expect(recorded.length).toBe(1);
    const url = new URL(recorded[0]);
    expect(url.origin + url.pathname).toBe('https://app.ticketmaster.com/discovery/v2/events.json');
    expect(url.searchParams.get('apikey')).toBe('test-key-123');
    expect(url.searchParams.get('countryCode')).toBe('US');
    expect(url.searchParams.get('keyword')).toBe('concert');
    expect(url.searchParams.get('size')).toBe('10');
  });

  test('get event encodes id in path', async () => {
    const recorded = installFetch(() => ({ id: 'abc/123', name: 'Test Event' }));

    const connector = new Connector({ apiKey: 'test-key-123' });
    await connector.events.get('abc/123');

    expect(recorded.length).toBe(1);
    const url = new URL(recorded[0]);
    expect(url.pathname).toBe('/discovery/v2/events/abc%2F123.json');
    expect(url.searchParams.get('apikey')).toBe('test-key-123');
  });

  test('search attractions URL includes apikey', async () => {
    const recorded = installFetch(() => ({ _embedded: { attractions: [] } }));

    const connector = new Connector({ apiKey: 'tm-key' });
    await connector.attractions.search({ keyword: 'artist' });

    const url = new URL(recorded[0]);
    expect(url.pathname).toBe('/discovery/v2/attractions.json');
    expect(url.searchParams.get('apikey')).toBe('tm-key');
    expect(url.searchParams.get('keyword')).toBe('artist');
  });

  test('get venue encodes id in path', async () => {
    const recorded = installFetch(() => ({ id: 'venue id', name: 'Arena' }));

    const connector = new Connector({ apiKey: 'tm-key' });
    await connector.venues.get('venue id');

    const url = new URL(recorded[0]);
    expect(url.pathname).toBe('/discovery/v2/venues/venue%20id.json');
    expect(url.searchParams.get('apikey')).toBe('tm-key');
  });
});
