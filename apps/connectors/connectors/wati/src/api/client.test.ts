import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { WatiClient } from './client';
import { WatiApiError } from '../types';

describe('WatiClient', () => {
  const mockConfig = {
    apiKey: ' wati-tok ',
    baseUrl: 'https://example.com/',
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('trims api key and base URL', () => {
    const client = new WatiClient(mockConfig);
    expect(client.getApiKeyPreview()).toBe('***');
    expect(client.getBaseUrl()).toBe('https://example.com');
  });

  test('throws when api key missing', () => {
    expect(() => new WatiClient({ apiKey: '', baseUrl: 'https://example.com' })).toThrow(
      'API key is required',
    );
  });

  test('throws when base URL missing', () => {
    expect(() => new WatiClient({ apiKey: 'key', baseUrl: '' })).toThrow('Base URL is required');
  });

  test('GET request uses Bearer auth and handles JSON response', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ result: true, contacts: [] })),
      } as Response),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new WatiClient(mockConfig);
    const result = await client.get('/api/v1/getContacts');

    expect(result).toEqual({ result: true, contacts: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, options] = call;
    expect(options.method).toBe('GET');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer wati-tok');
  });

  test('POST with query params and JSON body', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ result: true })),
      } as Response),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new WatiClient(mockConfig);
    await client.post(
      '/api/v1/sendTemplateMessage',
      { template_name: 'welcome', broadcast_name: 'welcome', parameters: [] },
      { whatsappNumber: '+15551234' },
    );

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, options] = call;
    expect(url).toContain('whatsappNumber=%2B15551234');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({
      template_name: 'welcome',
      broadcast_name: 'welcome',
      parameters: [],
    });
  });

  test('throws WatiApiError on non-2xx', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ message: 'rate limited' })),
      } as Response),
    ) as unknown as typeof fetch;

    const client = new WatiClient(mockConfig);
    await expect(client.get('/api/v1/getContacts')).rejects.toThrow(WatiApiError);
    await expect(client.get('/api/v1/getContacts')).rejects.toThrow('rate limited');
  });

  test('throws WatiApiError when result is false in 2xx body', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ result: false, info: 'missing template' })),
      } as Response),
    ) as unknown as typeof fetch;

    const client = new WatiClient(mockConfig);
    await expect(client.get('/api/v1/getContacts')).rejects.toThrow('missing template');
  });
});
