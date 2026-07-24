import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Usereframe } from './index';
import { UsereframeClient, encodePathSegment } from './client';
import { UsereframeApiError } from '../types';

describe('UsereframeClient', () => {
  const mockConfig = {
    apiKey: 'reframe-key',
    baseUrl: 'https://api.usereframe.ai/v1',
  };

  let originalFetch: typeof global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('throws when API key is missing', () => {
    expect(() => new UsereframeClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('encodePathSegment encodes path IDs', () => {
    expect(encodePathSegment('bom 1')).toBe('bom%201');
    expect(encodePathSegment('shipment 1')).toBe('shipment%201');
  });

  test('getApiKeyPreview masks long keys', () => {
    const client = new UsereframeClient(mockConfig);
    expect(client.getApiKeyPreview()).toBe('refram...-key');
  });

  test('procurement workflow endpoints use bearer auth, paths, and JSON bodies', async () => {
    const captured: Array<{ method: string; url: string; headers: HeadersInit; body?: string }> = [];
    originalFetch = global.fetch;
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        method: init?.method || 'GET',
        url: typeof input === 'string' ? input : input.toString(),
        headers: init?.headers || {},
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"ok":true}'),
      } as Response;
    }) as unknown as typeof fetch;

    const client = new Usereframe(mockConfig);

    await client.boms.list({ status: 'sourcing' });
    await client.boms.get('bom 1');
    await client.boms.upload({ name: 'Proto Board', lineItems: [{ mpn: 'STM32', quantity: 10 }] });
    await client.parts.search({ q: 'STM32', lifecycle: 'active' });
    await client.boms.requestQuotes('bom 1', { targetDate: '2026-06-01' });
    await client.suppliers.list({ region: 'US' });
    await client.purchaseOrders.create({ quoteId: 'quote-1', supplierId: 'supplier-1' });
    await client.shipments.get('shipment 1');
    await client.assistant.sendMessage({ message: 'Find alternate parts for the MCU' });

    expect(captured.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.usereframe.ai/v1/boms?status=sourcing'],
      ['GET', 'https://api.usereframe.ai/v1/boms/bom%201'],
      ['POST', 'https://api.usereframe.ai/v1/boms'],
      ['GET', 'https://api.usereframe.ai/v1/parts/search?q=STM32&lifecycle=active'],
      ['POST', 'https://api.usereframe.ai/v1/boms/bom%201/quotes'],
      ['GET', 'https://api.usereframe.ai/v1/suppliers?region=US'],
      ['POST', 'https://api.usereframe.ai/v1/purchase-orders'],
      ['GET', 'https://api.usereframe.ai/v1/shipments/shipment%201'],
      ['POST', 'https://api.usereframe.ai/v1/assistant/messages'],
    ]);

    for (const request of captured) {
      const headers = new Headers(request.headers);
      expect(headers.get('Authorization')).toBe('Bearer reframe-key');
    }

    expect(JSON.parse(captured[2].body!)).toEqual({
      name: 'Proto Board',
      lineItems: [{ mpn: 'STM32', quantity: 10 }],
    });
    expect(JSON.parse(captured[4].body!)).toEqual({ targetDate: '2026-06-01' });
    expect(JSON.parse(captured[6].body!)).toEqual({ quoteId: 'quote-1', supplierId: 'supplier-1' });
  });

  test('rawRequest supports custom path and method', async () => {
    originalFetch = global.fetch;
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      expect(typeof input === 'string' ? input : input.toString()).toBe(
        'https://api.usereframe.ai/v1/assistant/messages',
      );
      expect(init?.method).toBe('POST');
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"ok":true}'),
      } as Response;
    }) as unknown as typeof fetch;

    const client = new Usereframe(mockConfig);
    await client.rawRequest({
      path: '/assistant/messages',
      method: 'POST',
      body: { message: 'status?' },
    });
  });

  test('throws UsereframeApiError on failed responses', async () => {
    originalFetch = global.fetch;
    global.fetch = mock(async () => ({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ message: 'Not found' })),
    })) as unknown as typeof fetch;

    const client = new UsereframeClient(mockConfig);
    await expect(client.get('/boms/missing')).rejects.toThrow(UsereframeApiError);
  });
});
