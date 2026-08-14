import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { VeracodeClient } from './client';
import { Veracode } from './index';
import { VeracodeApiError } from '../types';

describe('VeracodeClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: 'https://api.veracode.com/v1',
  };

  describe('constructor', () => {
    test('throws when api key is missing', () => {
      expect(() => new VeracodeClient({ apiKey: '' })).toThrow('Veracode API key is required');
    });

    test('creates client with valid config', () => {
      expect(new VeracodeClient(mockConfig)).toBeInstanceOf(VeracodeClient);
    });
  });

  describe('request methods', () => {
    let client: VeracodeClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new VeracodeClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() calls GET /scans with Bearer auth', async () => {
      const mockResponse = { scans: [] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );

      const result = await client.get('/scans');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.veracode.com/v1/scans');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toBe('Bearer test-api-key-12345');
      expect(result).toEqual(mockResponse);
    });

    test('get() calls GET /scans/:id with encoded scan id', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{"scan_id":"abc"}'),
        } as Response),
      );

      await client.get('/scans/scan%2F123');

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.veracode.com/v1/scans/scan%2F123');
    });

    test('get() calls GET /events', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{"events":[]}'),
        } as Response),
      );

      await client.get('/events', { page: 0 });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.veracode.com/v1/events?page=0');
    });

    test('post() calls POST /search with JSON body', async () => {
      const body = { query: 'flaw' };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{"results":[]}'),
        } as Response),
      );

      await client.post('/search', body);

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.veracode.com/v1/search');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
    });

    test('throws VeracodeApiError on error response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('{"message":"Invalid credentials"}'),
        } as Response),
      );

      await expect(client.get('/scans')).rejects.toThrow(VeracodeApiError);
    });
  });
});

describe('Veracode', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{}'),
      } as Response),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('listScans uses /scans path', async () => {
    const api = new Veracode({ apiKey: 'key' });
    await api.listScans();
    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.veracode.com/v1/scans');
  });

  test('createScan POSTs to /scans', async () => {
    const api = new Veracode({ apiKey: 'key' });
    await api.createScan({ name: 'test' });
    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.veracode.com/v1/scans');
    expect(options.method).toBe('POST');
  });

  test('getScan GETs /scans/:id', async () => {
    const api = new Veracode({ apiKey: 'key' });
    await api.getScan('abc-123');
    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.veracode.com/v1/scans/abc-123');
  });

  test('listEvents uses /events path', async () => {
    const api = new Veracode({ apiKey: 'key' });
    await api.listEvents();
    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.veracode.com/v1/events');
  });

  test('search POSTs to /search', async () => {
    const api = new Veracode({ apiKey: 'key' });
    await api.search({ query: 'cve' });
    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.veracode.com/v1/search');
    expect(options.method).toBe('POST');
  });

  test('fromEnv requires VERACODE_API_KEY', () => {
    const prev = process.env.VERACODE_API_KEY;
    delete process.env.VERACODE_API_KEY;
    expect(() => Veracode.fromEnv()).toThrow('VERACODE_API_KEY');
    if (prev) process.env.VERACODE_API_KEY = prev;
  });
});
