import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { UnpaywallClient } from './client';
import { Unpaywall } from './index';
import { UnpaywallApiError } from '../types';

describe('UnpaywallClient', () => {
  let client: UnpaywallClient;

  beforeEach(() => {
    client = new UnpaywallClient('test@example.com');
  });

  test('requires email', () => {
    expect(() => new UnpaywallClient('')).toThrow('Unpaywall email is required');
  });

  test('encodes DOI path segments with slashes', () => {
    expect(client.encodeDoi('10.1038/nature12373')).toBe('10.1038/nature12373');
    expect(client.encodeDoi('doi:10.1038/nature12373')).toBe('10.1038/nature12373');
    expect(client.encodeDoi('https://doi.org/10.1038/nature12373')).toBe('10.1038/nature12373');
  });

  test('encodes special characters in DOI segments', () => {
    expect(client.encodeDoi('10.1000/xyz%20abc')).toBe('10.1000/xyz%2520abc');
  });

  test('builds correct URL with email param', () => {
    const url = client.buildUrl('/10.1038/nature12373');
    expect(url).toBe('https://api.unpaywall.org/v2/10.1038/nature12373?email=test%40example.com');
  });

  test('builds search URL with query params', () => {
    const url = client.buildUrl('/search', { query: 'cell thermometry', is_oa: true, page: 2 });
    expect(url).toContain('https://api.unpaywall.org/v2/search?');
    expect(url).toContain('email=test%40example.com');
    expect(url).toContain('query=cell+thermometry');
    expect(url).toContain('is_oa=true');
    expect(url).toContain('page=2');
  });

  test('getDoi returns parsed DOI object', async () => {
    const mockDoi = {
      doi: '10.1038/nature12373',
      is_oa: true,
      oa_status: 'bronze',
      title: 'Nanometre-scale thermometry',
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockDoi), { status: 200 })),
    ) as any;

    const result = await client.getDoi('10.1038/nature12373');
    expect(result.doi).toBe('10.1038/nature12373');
    expect(result.is_oa).toBe(true);
    expect(result.oa_status).toBe('bronze');

    globalThis.fetch = originalFetch;
  });

  test('getDoi throws UnpaywallApiError on HTTP error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Not Found', { status: 404, statusText: 'Not Found' })),
    ) as any;

    await expect(client.getDoi('10.9999/invalid')).rejects.toThrow(UnpaywallApiError);

    globalThis.fetch = originalFetch;
  });

  test('search returns results array', async () => {
    const mockResults = [
      {
        snippet: 'Single-<b>cell</b> thermometry',
        score: 12.5,
        response: { doi: '10.1000/test', is_oa: true, oa_status: 'gold' },
      },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockResults), { status: 200 })),
    ) as any;

    const result = await client.search('cell thermometry', { isOa: true, page: 1 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].score).toBe(12.5);
    expect(result.results[0].response.doi).toBe('10.1000/test');

    globalThis.fetch = originalFetch;
  });
});

describe('Unpaywall', () => {
  const origEmail = process.env.UNPAYWALL_EMAIL;

  afterEach(() => {
    if (origEmail) process.env.UNPAYWALL_EMAIL = origEmail;
    else delete process.env.UNPAYWALL_EMAIL;
  });

  test('creates connector with explicit email', () => {
    const connector = new Unpaywall('user@example.com');
    expect(connector.client).toBeDefined();
  });

  test('creates connector from env var', () => {
    process.env.UNPAYWALL_EMAIL = 'env@example.com';
    const connector = new Unpaywall();
    expect(connector.client).toBeDefined();
  });

  test('throws without email configured', () => {
    delete process.env.UNPAYWALL_EMAIL;
    expect(() => new Unpaywall()).toThrow('Unpaywall email is required');
  });
});

describe('UnpaywallApiError', () => {
  test('creates error with status code and body', () => {
    const err = new UnpaywallApiError('not found', 404, '{"error":"missing"}');
    expect(err.message).toBe('not found');
    expect(err.statusCode).toBe(404);
    expect(err.responseBody).toBe('{"error":"missing"}');
    expect(err.name).toBe('UnpaywallApiError');
  });
});
