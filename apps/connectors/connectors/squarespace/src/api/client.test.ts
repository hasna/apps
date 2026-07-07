import { afterEach, describe, expect, test } from 'bun:test';
import { SquarespaceClient } from './client';
import { InventoryApi } from './inventory';
import { OrdersApi } from './orders';
import { ProductsApi } from './products';
import { TransactionsApi } from './transactions';
import { SquarespaceApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => {
    ok: boolean;
    status: number;
    statusText?: string;
    json?: unknown;
    text?: string;
  },
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const result = handler(url, init);
    const text = result.text ?? JSON.stringify(result.json ?? {});
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText ?? (result.ok ? 'OK' : 'Error'),
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => text,
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SquarespaceClient', () => {
  const mockConfig = { apiKey: 'sample-value-0000' };

  test('throws when API key is missing', () => {
    expect(() => new SquarespaceClient({ apiKey: '' })).toThrow('Squarespace API key is required');
  });

  test('masks long API keys', () => {
    const client = new SquarespaceClient(mockConfig);
    expect(client.getApiKeyPreview()).toBe(`${mockConfig.apiKey.substring(0, 6)}...${mockConfig.apiKey.slice(-4)}`);
  });

  test('returns *** for short keys', () => {
    const client = new SquarespaceClient({ apiKey: 'short' });
    expect(client.getApiKeyPreview()).toBe('***');
  });

  test('makes GET request with Bearer auth and base URL', async () => {
    const recorded = installFetch(() => ({
      ok: true,
      status: 200,
      json: { inventory: [] },
    }));

    const client = new SquarespaceClient(mockConfig);
    const result = await client.request<{ inventory: unknown[] }>('/commerce/inventory');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.squarespace.com/1.0/commerce/inventory');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization).toBe(`Bearer ${mockConfig.apiKey}`);
    expect(result).toEqual({ inventory: [] });
  });

  test('appends cursor query parameter', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, json: {} }));
    const client = new SquarespaceClient(mockConfig);
    await client.request('/commerce/orders', { params: { cursor: 'abc123' } });
    expect(recorded[0].url).toContain('cursor=abc123');
  });

  test('filters undefined query params', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, json: {} }));
    const client = new SquarespaceClient(mockConfig);
    await client.request('/test-resource', { params: { cursor: 'x', type: undefined } });
    expect(recorded[0].url).toContain('cursor=x');
    expect(recorded[0].url).not.toContain('type=');
  });

  test('supports versioned endpoint paths and repeated query params', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, json: {} }));
    const client = new SquarespaceClient(mockConfig);
    await client.request('/v2/commerce/products', { params: { type: ['PHYSICAL', 'SERVICE'] } });
    expect(recorded[0].url).toBe('https://api.squarespace.com/v2/commerce/products?type=PHYSICAL&type=SERVICE');
  });

  test('POST sends JSON body', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, json: { id: '1' } }));
    const client = new SquarespaceClient(mockConfig);
    const body = { name: 'Test Product' };
    await client.request('/test-resource', { method: 'POST', body });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['Content-Type']).toBe('application/json');
    expect(recorded[0].body).toBe(JSON.stringify(body));
  });

  test('ProductsApi uses current v2 methods for update and variant image association', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, json: { products: [] } }));
    const client = new SquarespaceClient(mockConfig);
    const products = new ProductsApi(client);

    await products.update('prod-1', { name: { present: true, value: 'Updated' } });
    await products.associateVariantImage('prod-1', 'var-1', 'image-1');

    expect(recorded[0].url).toBe('https://api.squarespace.com/v2/commerce/products/prod-1');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[1].url).toBe('https://api.squarespace.com/v2/commerce/products/prod-1/variants/var-1/image');
    expect(recorded[1].method).toBe('POST');
    expect(recorded[1].body).toBe(JSON.stringify({ imageId: { present: true, value: 'image-1' } }));
  });

  test('order creation and inventory adjustment require idempotency keys', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, json: { id: '1' } }));
    const client = new SquarespaceClient(mockConfig);

    await new OrdersApi(client).create({ lineItems: [] }, 'order-key');
    await new InventoryApi(client).adjust({ incrementOperations: [] }, 'inventory-key');

    expect(recorded[0].headers['Idempotency-Key']).toBe('order-key');
    expect(recorded[1].headers['Idempotency-Key']).toBe('inventory-key');
  });

  test('TransactionsApi get supports multiple document IDs and documents response', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, json: { documents: [] } }));
    const client = new SquarespaceClient(mockConfig);

    const result = await new TransactionsApi(client).get(['txn 1', 'txn/2']);

    expect(recorded[0].url).toBe('https://api.squarespace.com/1.0/commerce/transactions/txn%201,txn%2F2');
    expect(result).toEqual({ documents: [] });
  });

  test('handles 204 No Content', async () => {
    installFetch(() => ({ ok: true, status: 204, text: '' }));
    const client = new SquarespaceClient(mockConfig);
    const result = await client.request('/test-resource/1', { method: 'DELETE' });
    expect(result).toEqual({});
  });

  test('throws SquarespaceApiError on API error response', async () => {
    installFetch(() => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: { message: 'Invalid API key', type: 'AUTHENTICATION_ERROR' },
    }));
    const client = new SquarespaceClient(mockConfig);
    try {
      await client.request('/commerce/inventory');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SquarespaceApiError);
      expect((err as SquarespaceApiError).statusCode).toBe(401);
      expect((err as SquarespaceApiError).message).toBe('Invalid API key');
    }
  });
});
