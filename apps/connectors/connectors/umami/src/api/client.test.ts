import { describe, test, expect, mock } from 'bun:test';
import { UmamiClient, buildBaseUrl } from './client';
import { Umami } from '../api/index';

describe('buildBaseUrl', () => {
  test('defaults to Umami Cloud v1', () => {
    expect(buildBaseUrl({})).toBe('https://api.umami.is/v1');
  });

  test('appends cloud region segment', () => {
    expect(buildBaseUrl({ region: 'us' })).toBe('https://api.umami.is/v1/us');
    expect(buildBaseUrl({ region: 'eu' })).toBe('https://api.umami.is/v1/eu');
  });

  test('uses explicit baseUrl when provided', () => {
    expect(buildBaseUrl({ baseUrl: 'https://api.umami.is/v1/us/' })).toBe('https://api.umami.is/v1/us');
  });

  test('normalizes self-hosted host to /api prefix', () => {
    expect(buildBaseUrl({ host: 'https://analytics.example.com' })).toBe('https://analytics.example.com/api');
    expect(buildBaseUrl({ host: 'https://analytics.example.com/api' })).toBe('https://analytics.example.com/api');
  });

  test('preserves custom cloud host override', () => {
    expect(buildBaseUrl({ host: 'https://api.umami.is/v1', region: 'eu' })).toBe('https://api.umami.is/v1/eu');
  });
});

describe('UmamiClient', () => {
  test('requires api key', () => {
    expect(() => new UmamiClient({ apiKey: '' })).toThrow('Umami API key is required');
  });

  test('masks api key preview', () => {
    const client = new UmamiClient({ apiKey: 'test-api-key-1234567890' });
    expect(client.getApiKeyPreview()).toBe('test-a...7890');
  });

  test('sends x-umami-api-key header and cloud base URL', async () => {
    const client = new UmamiClient({ apiKey: 'secret-key-12345', region: 'us' });
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    }) as unknown as typeof fetch;

    await client.get('/websites');

    expect(capturedUrl).toBe('https://api.umami.is/v1/us/websites');
    expect(capturedHeaders['x-umami-api-key']).toBe('secret-key-12345');
    expect(capturedHeaders.accept).toBe('application/json');

    globalThis.fetch = originalFetch;
  });
});

describe('Umami', () => {
  test('fromEnv reads UMAMI_API_KEY and region', () => {
    const previous = {
      key: process.env.UMAMI_API_KEY,
      host: process.env.UMAMI_HOST,
      region: process.env.UMAMI_REGION,
      baseUrl: process.env.UMAMI_BASE_URL,
    };

    process.env.UMAMI_API_KEY = 'env-key-1234567890';
    process.env.UMAMI_REGION = 'eu';
    delete process.env.UMAMI_HOST;
    delete process.env.UMAMI_BASE_URL;

    const connector = Umami.fromEnv();
    expect(connector.getBaseUrl()).toBe('https://api.umami.is/v1/eu');
    expect(connector.getApiKeyPreview()).toBe('env-ke...7890');

    if (previous.key === undefined) delete process.env.UMAMI_API_KEY;
    else process.env.UMAMI_API_KEY = previous.key;
    if (previous.host === undefined) delete process.env.UMAMI_HOST;
    else process.env.UMAMI_HOST = previous.host;
    if (previous.region === undefined) delete process.env.UMAMI_REGION;
    else process.env.UMAMI_REGION = previous.region;
    if (previous.baseUrl === undefined) delete process.env.UMAMI_BASE_URL;
    else process.env.UMAMI_BASE_URL = previous.baseUrl;
  });
});
