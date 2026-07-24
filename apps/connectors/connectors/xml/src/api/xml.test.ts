import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { DEFAULT_BASE_URL, XmlClient } from './client';
import { Xml } from './index';

const originalFetch = globalThis.fetch;
let captured: Array<{ url: string; init?: RequestInit }> = [];

describe('XmlClient', () => {
  beforeEach(() => {
    captured = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requires apiKey', () => {
    expect(() => new XmlClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('builds default base URL', () => {
    const client = new XmlClient({ apiKey: 'xml-key' });
    expect(client.buildUrl('/documents')).toBe(`${DEFAULT_BASE_URL}/documents`);
  });

  test('supports custom base URL', () => {
    const client = new XmlClient({ apiKey: 'xml-key', baseUrl: 'https://custom.example/v2/' });
    expect(client.buildUrl('/documents')).toBe('https://custom.example/v2/documents');
  });

  test('sends Bearer authorization header', async () => {
    const client = new XmlClient({ apiKey: 'xml-key' });
    await client.get('/documents');
    expect(new Headers(captured[0].init?.headers).get('Authorization')).toBe('Bearer xml-key');
  });
});

describe('Xml API', () => {
  beforeEach(() => {
    captured = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('listDocuments hits /documents', async () => {
    const xml = new Xml({ apiKey: 'xml-key' });
    await xml.listDocuments();
    expect(captured[0].url).toBe('https://api.xml.com/v1/documents');
  });

  test('getDocument encodes document ID in path', async () => {
    const xml = new Xml({ apiKey: 'xml-key' });
    await xml.getDocument('item-1');
    expect(captured[0].url).toBe('https://api.xml.com/v1/documents/item-1');
  });

  test('bearer auth on list and get', async () => {
    const xml = new Xml({ apiKey: 'xml-key' });
    await xml.listDocuments();
    await xml.getDocument('item-1');
    expect(captured[0].url).toBe('https://api.xml.com/v1/documents');
    expect(captured[1].url).toBe('https://api.xml.com/v1/documents/item-1');
    for (const request of captured) {
      expect(new Headers(request.init?.headers).get('Authorization')).toBe('Bearer xml-key');
    }
  });

  test('createDocument POSTs to /documents', async () => {
    const xml = new Xml({ apiKey: 'xml-key' });
    await xml.createDocument({ name: 'test.xml' });
    expect(captured[0].url).toBe('https://api.xml.com/v1/documents');
    expect(captured[0].init?.method).toBe('POST');
  });

  test('listEvents hits /events', async () => {
    const xml = new Xml({ apiKey: 'xml-key' });
    await xml.listEvents();
    expect(captured[0].url).toBe('https://api.xml.com/v1/events');
  });

  test('search POSTs to /search', async () => {
    const xml = new Xml({ apiKey: 'xml-key' });
    await xml.search({ query: 'invoice' });
    expect(captured[0].url).toBe('https://api.xml.com/v1/search');
    expect(captured[0].init?.method).toBe('POST');
  });

  test('rawRequest supports custom path and method', async () => {
    const xml = new Xml({ apiKey: 'xml-key' });
    await xml.rawRequest({ method: 'DELETE', path: '/documents/abc' });
    expect(captured[0].url).toBe('https://api.xml.com/v1/documents/abc');
    expect(captured[0].init?.method).toBe('DELETE');
  });

  test('fromEnv requires XML_API_KEY', () => {
    const orig = process.env.XML_API_KEY;
    delete process.env.XML_API_KEY;
    expect(() => Xml.fromEnv()).toThrow('XML_API_KEY environment variable is required');
    if (orig) process.env.XML_API_KEY = orig;
  });
});
