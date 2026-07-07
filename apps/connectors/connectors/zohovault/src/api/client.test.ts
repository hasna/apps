import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ZohoVaultClient } from './client';
import { ZohoVaultApiError } from '../types';

describe('ZohoVaultClient', () => {
  const mockConfig = {
    token: 'zv-tok',
    dataCenter: 'com',
  };

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    test('throws when token is missing', () => {
      expect(() => new ZohoVaultClient({ token: '' })).toThrow('Zoho Vault token is required');
    });

    test('creates client with valid config', () => {
      const client = new ZohoVaultClient(mockConfig);
      expect(client).toBeInstanceOf(ZohoVaultClient);
      expect(client.getBaseUrl()).toBe('https://vault.zoho.com/api/rest/json/v1');
    });

    test('routes EU data center to vault.zoho.eu', () => {
      const client = new ZohoVaultClient({ token: 'zv-tok', dataCenter: 'eu' });
      expect(client.getBaseUrl()).toBe('https://vault.zoho.eu/api/rest/json/v1');
    });

    test('throws on invalid data center', () => {
      expect(() => new ZohoVaultClient({ token: 'zv-tok', dataCenter: 'invalid' })).toThrow(ZohoVaultApiError);
    });
  });

  describe('request', () => {
    test('GET uses Zoho-oauthtoken header', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ operation: { result: { status: 'Success' } }, secrets: [] })),
        } as Response),
      );

      const client = new ZohoVaultClient(mockConfig);
      await client.request('/secrets');

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(String(url)).toBe('https://vault.zoho.com/api/rest/json/v1/secrets');
      expect((options as RequestInit).method).toBe('GET');
      expect((options as RequestInit).headers).toMatchObject({
        Authorization: 'Zoho-oauthtoken zv-tok',
      });
    });

    test('POST createSecret uses urlencoded body with serialized secretdata', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ operation: { result: { status: 'Success' } } })),
        } as Response),
      );

      const client = new ZohoVaultClient(mockConfig);
      await client.request('/secrets', {
        method: 'POST',
        body: {
          name: 'AWS prod root',
          description: 'prod root',
          secretdata: { username: 'root', password: 'REDACTED' },
        },
      });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect((options as RequestInit).method).toBe('POST');
      expect((options as RequestInit).headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      const body = new URLSearchParams((options as RequestInit).body as string);
      expect(body.get('name')).toBe('AWS prod root');
      expect(body.get('description')).toBe('prod root');
      expect(JSON.parse(body.get('secretdata') ?? '{}')).toEqual({
        username: 'root',
        password: 'REDACTED',
      });
    });

    test('shareSecret POSTs permission in urlencoded body', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ operation: { result: { status: 'Success' } } })),
        } as Response),
      );

      const client = new ZohoVaultClient(mockConfig);
      await client.request('/secrets/sec-1/share', {
        method: 'POST',
        body: { userids: 'user-1,user-2', permission: 'VIEW' },
      });

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(String(url)).toBe('https://vault.zoho.com/api/rest/json/v1/secrets/sec-1/share');
      const body = new URLSearchParams((options as RequestInit).body as string);
      expect(body.get('userids')).toBe('user-1,user-2');
      expect(body.get('permission')).toBe('VIEW');
    });

    test('operation.result non-Success throws ZohoVaultApiError', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ operation: { result: { status: 'Failed', message: 'Permission denied' } } }),
            ),
        } as Response),
      );

      const client = new ZohoVaultClient(mockConfig);
      await expect(client.request('/secrets')).rejects.toThrow('Permission denied');
    });

    test('non-2xx response throws ZohoVaultApiError with API message', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: () => Promise.resolve(JSON.stringify({ message: 'rate limited' })),
        } as Response),
      );

      const client = new ZohoVaultClient(mockConfig);
      try {
        await client.request('/secrets');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ZohoVaultApiError);
        expect((err as ZohoVaultApiError).message).toBe('rate limited');
        expect((err as ZohoVaultApiError).statusCode).toBe(429);
      }
    });
  });
});
