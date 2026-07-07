import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  responder: (url: string) => { status?: number; json?: unknown } = () => ({ json: {} }),
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const { status = 200, json = {} } = responder(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json);
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Stripe Climate transport', () => {
  test('sends Bearer auth against the Climate products endpoint', async () => {
    const recorded = installFetch(() => ({ json: { object: 'list', data: [], has_more: false } }));
    const client = new Connector({ apiKey: 'sk_test_example' });

    await client.products.list({ limit: 5 });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.url).toBe('https://api.stripe.com/v1/climate/products?limit=5');
    expect(recorded[0]!.method).toBe('GET');
    expect(recorded[0]!.headers['Authorization']).toBe('Bearer sk_test_example');
    expect(recorded[0]!.headers['Stripe-Version']).toBeDefined();
  });

  test('retrieves a supplier by id', async () => {
    const recorded = installFetch(() => ({ json: { id: 'climsup_abc', object: 'climate.supplier' } }));
    const client = new Connector({ apiKey: 'sk_test_example' });

    await client.suppliers.get('climsup_abc');

    expect(recorded[0]!.url).toBe('https://api.stripe.com/v1/climate/suppliers/climsup_abc');
    expect(recorded[0]!.method).toBe('GET');
  });

  test('form-encodes nested order params with bracket notation', async () => {
    const recorded = installFetch(() => ({ json: { id: 'climord_1', object: 'climate.order' } }));
    const client = new Connector({ apiKey: 'sk_test_example' });

    await client.orders.create({
      product: 'climsku_123',
      metric_tons: '1.5',
      beneficiary: { public_name: 'Acme Corp' },
      metadata: { order_ref: 'A-100' },
    });

    expect(recorded[0]!.url).toBe('https://api.stripe.com/v1/climate/orders');
    expect(recorded[0]!.method).toBe('POST');
    expect(recorded[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = recorded[0]!.body ?? '';
    expect(body).toContain('product=climsku_123');
    expect(body).toContain('metric_tons=1.5');
    expect(body).toContain('beneficiary%5Bpublic_name%5D=Acme%20Corp');
    expect(body).toContain('metadata%5Border_ref%5D=A-100');
  });

  test('cancel posts to the order cancel sub-resource', async () => {
    const recorded = installFetch(() => ({ json: { id: 'climord_1', object: 'climate.order', status: 'canceled' } }));
    const client = new Connector({ apiKey: 'sk_test_example' });

    await client.orders.cancel('climord_1');

    expect(recorded[0]!.url).toBe('https://api.stripe.com/v1/climate/orders/climord_1/cancel');
    expect(recorded[0]!.method).toBe('POST');
  });

  test('sends Stripe-Account header for connected accounts', async () => {
    const recorded = installFetch(() => ({ json: { object: 'list', data: [], has_more: false } }));
    const client = new Connector({ apiKey: 'sk_test_example', accountId: 'acct_123' });

    await client.orders.list();

    expect(recorded[0]!.headers['Stripe-Account']).toBe('acct_123');
  });

  test('surfaces Stripe error payloads as ConnectorApiError', async () => {
    installFetch(() => ({ status: 404, json: { error: { message: 'No such climate product', type: 'invalid_request_error' } } }));
    const client = new Connector({ apiKey: 'sk_test_example' });

    let caught: unknown;
    try {
      await client.products.get('climsku_missing');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConnectorApiError);
    expect((caught as ConnectorApiError).statusCode).toBe(404);
    expect((caught as ConnectorApiError).message).toBe('No such climate product');
  });

  test('requires an API key', () => {
    expect(() => new Connector({ apiKey: '' })).toThrow('API key is required');
  });
});
