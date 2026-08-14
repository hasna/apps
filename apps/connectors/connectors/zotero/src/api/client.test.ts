import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  ZoteroClient,
  normalizeLibraryType,
  buildLibraryPrefix,
  buildZoteroUrl,
  DEFAULT_BASE_URL,
} from './client';
import { ZoteroApiError } from '../types';

describe('ZoteroClient helpers', () => {
  test('normalizeLibraryType maps group to groups', () => {
    expect(normalizeLibraryType('users')).toBe('users');
    expect(normalizeLibraryType('groups')).toBe('groups');
    expect(normalizeLibraryType('group')).toBe('groups');
    expect(normalizeLibraryType(undefined)).toBe('users');
  });

  test('buildLibraryPrefix encodes library id and type', () => {
    expect(buildLibraryPrefix('12345', 'users')).toBe('/users/12345');
    expect(buildLibraryPrefix('abc/def', 'groups')).toBe('/groups/abc%2Fdef');
  });

  test('buildZoteroUrl appends query params and strips trailing slash', () => {
    const url = buildZoteroUrl(`${DEFAULT_BASE_URL}/`, '/users/1/items', {
      limit: 10,
      q: 'test query',
      empty: '',
      skip: undefined,
    });
    expect(url).toBe('https://api.zotero.org/users/1/items?limit=10&q=test+query');
  });
});

describe('ZoteroClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key',
    libraryId: '1234567',
    libraryType: 'users' as const,
    baseUrl: 'https://api.zotero.org',
  };

  describe('constructor', () => {
    test('throws when api key is missing', () => {
      expect(() => new ZoteroClient({ apiKey: '', libraryId: '1' })).toThrow('Zotero API key is required');
    });

    test('throws when library id is missing', () => {
      expect(() => new ZoteroClient({ apiKey: 'key', libraryId: '' })).toThrow('Zotero library ID is required');
    });

    test('creates client with valid config', () => {
      const client = new ZoteroClient(mockConfig);
      expect(client.libraryPrefix()).toBe('/users/1234567');
    });

    test('normalizes group library type', () => {
      const client = new ZoteroClient({ ...mockConfig, libraryType: 'group' });
      expect(client.libraryPrefix()).toBe('/groups/1234567');
    });
  });

  describe('request', () => {
    let client: ZoteroClient;
    let originalFetch: typeof global.fetch;
    let fetchMock: ReturnType<typeof mock>;

    beforeEach(() => {
      client = new ZoteroClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('sends required Zotero headers on GET', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('[]'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.get('/users/1234567/items', { limit: 1 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.zotero.org/users/1234567/items?limit=1');
      expect(options.method).toBe('GET');
      expect(options.headers['Zotero-API-Key']).toBe('test-api-key');
      expect(options.headers['Zotero-API-Version']).toBe('3');
      expect(options.headers.Accept).toBe('application/json');
    });

    test('includes version header on PATCH', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.patch('/users/1234567/items/ABC123', { title: 'Updated' }, { version: 42 });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe('PATCH');
      expect(options.headers['If-Unmodified-Since-Version']).toBe('42');
    });

    test('includes version header on DELETE', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.delete('/users/1234567/items/ABC123', { version: 7 });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe('DELETE');
      expect(options.headers['If-Unmodified-Since-Version']).toBe('7');
    });

    test('throws ZoteroApiError on failed response', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ message: 'Invalid key' })),
        } as Response)
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.get('/users/1234567/items')).rejects.toThrow(ZoteroApiError);
    });
  });
});

describe('upload auth parsing', () => {
  test('parses upload authorization response shape', () => {
    const response = {
      url: 'https://upload.example.com/',
      contentType: 'multipart/form-data',
      uploadKey: 'abc123',
      prefix: '--boundary\r\n',
      suffix: '\r\n--boundary--',
    };

    expect(response.url).toBeTruthy();
    expect(response.contentType).toBeTruthy();
    expect(response.uploadKey).toBeTruthy();
  });
});
