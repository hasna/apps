import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Standout } from './index';
import { StandoutClient } from './client';
import { StandoutApiError } from '../types';

describe('StandoutClient', () => {
  const mockConfig = {
    apiKey: 'standout-test-key',
    baseUrl: 'https://api.standout.ai/v1',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new StandoutClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new StandoutClient(mockConfig);
      expect(client).toBeInstanceOf(StandoutClient);
    });
  });

  describe('request', () => {
    let client: StandoutClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new StandoutClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('listCandidates makes GET request with bearer auth', async () => {
      const mockResponse = { candidates: [] };
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response)
      ) as unknown as typeof fetch;

      const api = new Standout(mockConfig);
      const result = await api.listCandidates();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.standout.ai/v1/candidates');
      expect(options.method).toBe('GET');
      expect((options.headers as Record<string, string>).Authorization).toBe('Bearer standout-test-key');
      expect(result).toEqual(mockResponse);
    });

    test('getCandidate requests correct path', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ id: 'c1' })),
        } as Response)
      ) as unknown as typeof fetch;

      const api = new Standout(mockConfig);
      await api.getCandidate('c1');

      const [url] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.standout.ai/v1/candidates/c1');
    });

    test('createAssessment makes POST request with body', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          text: () => Promise.resolve(JSON.stringify({ id: 'a1' })),
        } as Response)
      ) as unknown as typeof fetch;

      const api = new Standout(mockConfig);
      const body = { candidateId: 'c1', roleId: 'r1' };
      await api.createAssessment(body);

      const [url, options] = (global.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://api.standout.ai/v1/assessments');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(body));
      expect((options.headers as Record<string, string>).Authorization).toBe('Bearer standout-test-key');
    });

    test('throws StandoutApiError on error response', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: () => Promise.resolve(JSON.stringify({ message: 'Not found' })),
        } as Response)
      ) as unknown as typeof fetch;

      await expect(client.request('/missing')).rejects.toThrow(StandoutApiError);
    });
  });
});
