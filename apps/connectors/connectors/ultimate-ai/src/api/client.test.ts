import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { UltimateAiClient, DEFAULT_BASE_URL } from './client';
import { UltimateAiApiError } from '../types';

describe('UltimateAiClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key-12345',
    baseUrl: DEFAULT_BASE_URL,
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new UltimateAiClient({ apiKey: '' })).toThrow('Ultimate AI API key is required');
    });

    test('creates client with valid config', () => {
      const client = new UltimateAiClient(mockConfig);
      expect(client).toBeInstanceOf(UltimateAiClient);
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });

    test('uses custom base URL when provided', () => {
      const client = new UltimateAiClient({
        apiKey: 'key',
        baseUrl: 'https://custom.example/v1/',
      });
      expect(client.getBaseUrl()).toBe('https://custom.example/v1');
    });
  });

  describe('request', () => {
    let client: UltimateAiClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new UltimateAiClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('listBots issues Bearer auth to /bots', async () => {
      const mockResponse = { bots: [] };
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.request('/bots');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe('https://api.ultimate.ai/v1/bots');
      expect(call[1].method).toBe('GET');
      expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer test-api-key-12345');
      expect(result).toEqual(mockResponse);
    });

    test('getBot issues Bearer auth to /bots/:id', async () => {
      const mockResponse = { id: 'bot-1', name: 'Support Bot' };
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.request('/bots/bot-1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe('https://api.ultimate.ai/v1/bots/bot-1');
      expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer test-api-key-12345');
      expect(result).toEqual(mockResponse);
    });

    test('throws UltimateAiApiError on 4xx responses', async () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({ message: 'Invalid API key' }),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.request('/bots')).rejects.toThrow(UltimateAiApiError);
      await expect(client.request('/bots')).rejects.toMatchObject({
        message: 'Invalid API key',
        statusCode: 401,
      });
    });
  });
});
