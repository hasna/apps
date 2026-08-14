import { afterEach, describe, expect, test } from 'bun:test';
import { UniswapApiClient } from './client';
import { UniswapApiError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => { ok: boolean; status: number; json: unknown },
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    const result = handler(url, init);
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.ok ? 'OK' : 'Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(result.json);
      },
    } as Response;
  }) as typeof fetch;

  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('UniswapApiClient', () => {
  const mockConfig = {
    apiKey: 'test-uniswap-api-key-12345',
    baseUrl: 'https://trade-api.gateway.uniswap.org/v1',
  };

  describe('constructor', () => {
    test('throws error when apiKey is missing', () => {
      expect(() => new UniswapApiClient({ apiKey: '' })).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new UniswapApiClient(mockConfig);
      expect(client).toBeInstanceOf(UniswapApiClient);
    });
  });

  describe('getApiKeyPreview', () => {
    test('returns masked key for long keys', () => {
      const client = new UniswapApiClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('test-u...2345');
    });

    test('returns *** for short keys', () => {
      const client = new UniswapApiClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('request methods', () => {
    test('post() sends quote request with x-api-key header and JSON body', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        json: { requestId: 'req-1', routing: 'CLASSIC' },
      }));

      const client = new UniswapApiClient(mockConfig);
      const body = {
        swapper: '0xabc',
        tokenIn: '0xUSDC',
        tokenOut: '0xWETH',
        tokenInChainId: 1,
        tokenOutChainId: 1,
        amount: '1000000',
        type: 'EXACT_INPUT',
      };

      const result = await client.post('/quote', body);

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe('https://trade-api.gateway.uniswap.org/v1/quote');
      expect(recorded[0].method).toBe('POST');
      expect(recorded[0].headers['x-api-key']).toBe(mockConfig.apiKey);
      expect(recorded[0].headers['content-type']).toBe('application/json');
      expect(recorded[0].body).toBe(JSON.stringify(body));
      expect(result).toEqual({ requestId: 'req-1', routing: 'CLASSIC' });
    });

    test('get() requests swappable tokens with query params and x-api-key header', async () => {
      const recorded = installFetch(() => ({
        ok: true,
        status: 200,
        json: {
          requestId: 'req-2',
          tokens: [{ address: '0x1', chainId: 1, symbol: 'USDC' }],
        },
      }));

      const client = new UniswapApiClient(mockConfig);
      const result = await client.get('/swappable_tokens', {
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenInChainId: 1,
      });

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toContain('/swappable_tokens');
      expect(recorded[0].url).toContain('tokenIn=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(recorded[0].url).toContain('tokenInChainId=1');
      expect(recorded[0].method).toBe('GET');
      expect(recorded[0].headers['x-api-key']).toBe(mockConfig.apiKey);
      expect(result).toEqual({
        requestId: 'req-2',
        tokens: [{ address: '0x1', chainId: 1, symbol: 'USDC' }],
      });
    });

    test('throws UniswapApiError on error response', async () => {
      installFetch(() => ({
        ok: false,
        status: 401,
        json: { detail: 'Invalid API key' },
      }));

      const client = new UniswapApiClient(mockConfig);
      await expect(client.get('/swappable_tokens')).rejects.toThrow(UniswapApiError);
    });
  });
});
