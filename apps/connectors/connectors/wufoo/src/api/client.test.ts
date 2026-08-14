import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WufooClient, buildWufooBaseUrl, encodeResourceId } from './client';
import { WufooApiError } from '../types';

describe('buildWufooBaseUrl', () => {
  test('builds subdomain URL', () => {
    expect(buildWufooBaseUrl('fishbowl')).toBe('https://fishbowl.wufoo.com/api/v3');
  });

  test('uses explicit base URL when provided', () => {
    expect(buildWufooBaseUrl('ignored', 'https://custom.example/api/v3/')).toBe(
      'https://custom.example/api/v3',
    );
  });
});

describe('encodeResourceId', () => {
  test('encodes slashes in title-based identifiers', () => {
    expect(encodeResourceId('my/form')).toBe('my%2Fform');
  });

  test('leaves hash identifiers unchanged', () => {
    expect(encodeResourceId('s1afea8b1vk0jf7')).toBe('s1afea8b1vk0jf7');
  });
});

describe('WufooClient', () => {
  const mockConfig = {
    apiKey: 'AOI6-LFKL-VM1Q-IEX9',
    subdomain: 'fishbowl',
  };

  describe('constructor', () => {
    test('throws when api key is missing', () => {
      expect(() => new WufooClient({ apiKey: '', subdomain: 'fishbowl' })).toThrow(
        'API key is required',
      );
    });

    test('throws when subdomain is missing', () => {
      expect(() => new WufooClient({ apiKey: 'key', subdomain: '' })).toThrow(
        'Subdomain is required',
      );
    });

    test('creates client with valid config', () => {
      const client = new WufooClient(mockConfig);
      expect(client).toBeInstanceOf(WufooClient);
      expect(client.getBaseUrl()).toBe('https://fishbowl.wufoo.com/api/v3');
    });
  });

  describe('request methods', () => {
    let client: WufooClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new WufooClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends Basic auth and Accept header', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ Forms: [] })),
        } as Response),
      );

      await client.get('/forms.json');

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://fishbowl.wufoo.com/api/v3/forms.json');
      expect(options.method).toBe('GET');
      expect(options.headers.Authorization).toMatch(/^Basic /);
      expect(options.headers.Accept).toBe('application/json');
    });

    test('postForm() sends application/x-www-form-urlencoded body', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ Success: 1, EntryId: 10 })),
        } as Response),
      );

      await client.postForm('/forms/test/entries.json', { Field1: 'Wufoo', Field2: 'Test' });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(options.body).toBe('Field1=Wufoo&Field2=Test');
    });

    test('putForm() sends form-encoded webhook payload', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ WebHookPutResult: { Hash: 'abc' } })),
        } as Response),
      );

      await client.putForm('/forms/test/webhooks.json', {
        url: 'https://example.com/hook',
        metadata: 'true',
      });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('PUT');
      expect(options.body).toBe('url=https%3A%2F%2Fexample.com%2Fhook&metadata=true');
    });

    test('throws WufooApiError on 4xx response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ Text: 'Form not found' })),
        } as Response),
      );

      await expect(client.get('/forms/missing.json')).rejects.toThrow(WufooApiError);
    });

    test('getApiKeyPreview masks long keys', () => {
      expect(client.getApiKeyPreview()).toBe('AOI6-L...IEX9');
    });
  });
});
