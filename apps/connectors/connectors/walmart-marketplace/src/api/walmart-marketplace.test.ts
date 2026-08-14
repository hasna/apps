import { describe, it, expect, mock } from 'bun:test';
import { WalmartMarketplace } from './index';
import { WalmartMarketplaceClient, DEFAULT_BASE_URL } from './client';
import { ItemsApi } from './items';

describe('WalmartMarketplaceClient', () => {
  it('requires access token and service name', () => {
    expect(() => new WalmartMarketplaceClient({ accessToken: '', serviceName: 'svc' })).toThrow(
      'Access token is required'
    );
    expect(() => new WalmartMarketplaceClient({ accessToken: 'token', serviceName: '' })).toThrow(
      'Service name is required'
    );
  });

  it('includes WM_SEC.ACCESS_TOKEN and WM_SVC.NAME headers on GET /items', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: unknown, options: { headers: Record<string, string> }) => {
      capturedUrl = String(_url);
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ ItemResponse: [], totalItems: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new WalmartMarketplaceClient({
      accessToken: 'test-access-token',
      serviceName: 'Test Marketplace Service',
      correlationId: 'fixed-correlation-id',
    });

    await client.get('/items');

    expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/items`);
    expect(capturedHeaders['WM_SEC.ACCESS_TOKEN']).toBe('test-access-token');
    expect(capturedHeaders['WM_SVC.NAME']).toBe('Test Marketplace Service');
    expect(capturedHeaders['WM_QOS.CORRELATION_ID']).toBe('fixed-correlation-id');
    expect(capturedHeaders['Accept']).toBe('application/json');

    globalThis.fetch = originalFetch;
  });
});

describe('ItemsApi', () => {
  it('list-items builds GET https://marketplace.walmartapis.com/v3/items with required headers', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: unknown, options: { method: string; headers: Record<string, string> }) => {
      capturedUrl = String(_url);
      capturedMethod = options.method;
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ ItemResponse: [{ sku: 'SKU-1' }], totalItems: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const marketplace = new WalmartMarketplace({
      accessToken: 'wm-token-123',
      serviceName: 'My Walmart App',
    });

    const result = await marketplace.items.list({ limit: 20 });

    expect(capturedMethod).toBe('GET');
    expect(capturedUrl).toBe('https://marketplace.walmartapis.com/v3/items?limit=20');
    expect(capturedHeaders['WM_SEC.ACCESS_TOKEN']).toBe('wm-token-123');
    expect(capturedHeaders['WM_SVC.NAME']).toBe('My Walmart App');
    expect(capturedHeaders['WM_QOS.CORRELATION_ID']).toBeTruthy();
    expect(result.ItemResponse).toHaveLength(1);

    globalThis.fetch = originalFetch;
  });

  it('get item by SKU encodes path segment', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify({ ItemResponse: [{ sku: 'SKU/ABC' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const api = new ItemsApi(
      new WalmartMarketplaceClient({
        accessToken: 'token',
        serviceName: 'svc',
      })
    );

    await api.get('SKU/ABC');
    expect(capturedUrl).toContain('/items/SKU%2FABC');

    globalThis.fetch = originalFetch;
  });
});

describe('WalmartMarketplace', () => {
  it('creates from environment variables', () => {
    const prevToken = process.env.WALMART_ACCESS_TOKEN;
    const prevService = process.env.WALMART_SERVICE_NAME;

    process.env.WALMART_ACCESS_TOKEN = 'env-token';
    process.env.WALMART_SERVICE_NAME = 'env-service';

    const marketplace = WalmartMarketplace.fromEnv();
    expect(marketplace.getServiceName()).toBe('env-service');

    if (prevToken) process.env.WALMART_ACCESS_TOKEN = prevToken;
    else delete process.env.WALMART_ACCESS_TOKEN;
    if (prevService) process.env.WALMART_SERVICE_NAME = prevService;
    else delete process.env.WALMART_SERVICE_NAME;
  });

  it('throws when env credentials are missing', () => {
    const prevToken = process.env.WALMART_ACCESS_TOKEN;
    const prevService = process.env.WALMART_SERVICE_NAME;
    delete process.env.WALMART_ACCESS_TOKEN;
    delete process.env.WALMART_SERVICE_NAME;

    expect(() => WalmartMarketplace.fromEnv()).toThrow('WALMART_ACCESS_TOKEN');

    process.env.WALMART_ACCESS_TOKEN = 'token';
    expect(() => WalmartMarketplace.fromEnv()).toThrow('WALMART_SERVICE_NAME');

    if (prevToken) process.env.WALMART_ACCESS_TOKEN = prevToken;
    else delete process.env.WALMART_ACCESS_TOKEN;
    if (prevService) process.env.WALMART_SERVICE_NAME = prevService;
    else delete process.env.WALMART_SERVICE_NAME;
  });
});
