import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ZohoInventoryClient } from './client';
import { ZohoInventoryApiError } from '../types';

describe('ZohoInventoryClient', () => {
  const mockConfig = {
    token: 'zoho-inventory-token',
    organizationId: '10234695',
    baseUrl: 'https://www.zohoapis.com/inventory/v1',
  };

  describe('constructor', () => {
    test('throws when token is missing', () => {
      expect(() => new ZohoInventoryClient({ token: '', organizationId: '10234695' })).toThrow(
        'Zoho Inventory token and organizationId are required',
      );
    });

    test('throws when organizationId is missing', () => {
      expect(() => new ZohoInventoryClient({ token: 'token', organizationId: '' })).toThrow(
        'Zoho Inventory token and organizationId are required',
      );
    });

    test('creates client with valid config', () => {
      expect(new ZohoInventoryClient(mockConfig)).toBeInstanceOf(ZohoInventoryClient);
    });
  });

  describe('request', () => {
    let client: ZohoInventoryClient;
    let originalFetch: typeof global.fetch;
    let fetchMock: ReturnType<typeof mock>;

    beforeEach(() => {
      client = new ZohoInventoryClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('sends GET with Zoho-oauthtoken auth and organization_id', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ code: 0, items: [] }),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.request('/items', { params: { page: 1 } });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://www.zohoapis.com/inventory/v1/items?organization_id=10234695&page=1');
      expect((options.headers as Record<string, string>).Authorization).toBe('Zoho-oauthtoken zoho-inventory-token');
    });

    test('throws ZohoInventoryApiError on API error code', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ code: 57, message: 'Invalid token' }),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.request('/items')).rejects.toThrow(ZohoInventoryApiError);
    });

    test('throws ZohoInventoryApiError on HTTP error', async () => {
      fetchMock = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({ message: 'Unauthorized' }),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      try {
        await client.request('/items');
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ZohoInventoryApiError);
        expect((error as ZohoInventoryApiError).statusCode).toBe(401);
      }
    });
  });
});
