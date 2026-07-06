import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
import { PropertiesApi } from './properties';
import { Connector } from './index';

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') return undefined;
  return JSON.parse(init.body);
}

describe('ConnectorClient', () => {
  test('requires api key', () => {
    expect(() => new ConnectorClient({})).toThrow('Travo API key is required');
  });

  test('creates client with valid config', () => {
    const client = new ConnectorClient({ apiKey: 'travo-key-1234567890' });
    expect(client).toBeDefined();
    expect(client.getApiKeyPreview()).toBe('travo-...7890');
  });

  test('builds search URL with query params', () => {
    const client = new ConnectorClient({ apiKey: 'travo-key' });
    const url = client.buildUrl('/properties/search', { assetType: 'rv_park', state: 'TX' });
    expect(url).toBe(`${DEFAULT_BASE_URL}/properties/search?assetType=rv_park&state=TX`);
  });

  test('encodes path segments', () => {
    expect(encodePathSegment('prop 1')).toBe('prop%201');
  });

  test('uses bearer authorization header', async () => {
    const client = new ConnectorClient({ apiKey: 'travo-key' });
    const captured: Array<{ url: string; init?: RequestInit }> = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: urlOf(input), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    await client.get('/properties/search', { q: 'retail' });

    expect(captured[0].url).toBe(`${DEFAULT_BASE_URL}/properties/search?q=retail`);
    expect(new Headers(captured[0].init?.headers).get('Authorization')).toBe('Bearer travo-key');

    globalThis.fetch = originalFetch;
  });

  test('throws before fetch when api key missing', () => {
    expect(() => new ConnectorClient({ apiKey: undefined })).toThrow('Travo API key is required');
  });
});

describe('PropertiesApi', () => {
  let captured: Array<{ method: string; url: string; init?: RequestInit; body?: unknown }> = [];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        method: init?.method ?? 'GET',
        url: urlOf(input),
        init,
        body: jsonBody(init),
      });
      return new Response(JSON.stringify({ ok: true, connector: 'travo' }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('uses bearer auth for property intelligence endpoints', async () => {
    const client = new ConnectorClient({ apiKey: 'travo-key' });
    const properties = new PropertiesApi(client);

    await properties.searchProperties({ assetType: 'rv_park', state: 'TX' });
    await properties.getProperty('prop 1');
    await properties.getComps('prop 1', { radius: 25 });
    await properties.getOwnership('prop 1');
    await properties.getZoning('prop 1');
    await properties.getFinancials('prop 1');
    await properties.enrichProperty('prop 1', { sources: ['web', 'phone'] });
    await properties.rawRequest({ path: '/properties/search', query: { q: 'retail' } });

    expect(captured.map((request) => [request.method, request.url])).toEqual([
      ['GET', `${DEFAULT_BASE_URL}/properties/search?assetType=rv_park&state=TX`],
      ['GET', `${DEFAULT_BASE_URL}/properties/prop%201`],
      ['GET', `${DEFAULT_BASE_URL}/properties/prop%201/comps?radius=25`],
      ['GET', `${DEFAULT_BASE_URL}/properties/prop%201/ownership`],
      ['GET', `${DEFAULT_BASE_URL}/properties/prop%201/zoning`],
      ['GET', `${DEFAULT_BASE_URL}/properties/prop%201/financials`],
      ['POST', `${DEFAULT_BASE_URL}/properties/prop%201/enrich`],
      ['GET', `${DEFAULT_BASE_URL}/properties/search?q=retail`],
    ]);

    for (const request of captured) {
      expect(new Headers(request.init?.headers).get('Authorization')).toBe('Bearer travo-key');
    }

    expect(captured[6].body).toEqual({ sources: ['web', 'phone'] });
  });
});

describe('Connector', () => {
  test('creates connector with valid config', () => {
    const connector = new Connector({ apiKey: 'travo-key' });
    expect(connector.properties).toBeDefined();
  });

  test('fromEnv throws without TRAVO_API_KEY', () => {
    const origKey = process.env.TRAVO_API_KEY;
    delete process.env.TRAVO_API_KEY;

    expect(() => Connector.fromEnv()).toThrow('TRAVO_API_KEY environment variable is required');

    if (origKey) process.env.TRAVO_API_KEY = origKey;
  });

  test('fromEnv creates connector with env var', () => {
    const origKey = process.env.TRAVO_API_KEY;
    process.env.TRAVO_API_KEY = 'travo-key-1234567890';

    const connector = Connector.fromEnv();
    expect(connector).toBeDefined();
    expect(connector.getApiKeyPreview()).toBe('travo-...7890');

    if (origKey) process.env.TRAVO_API_KEY = origKey;
    else delete process.env.TRAVO_API_KEY;
  });
});
