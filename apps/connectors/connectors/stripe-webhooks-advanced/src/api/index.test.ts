import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Connector } from './index';

describe('Connector.fromEnv', () => {
  const originalEnv = { ...process.env };
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    originalFetch = global.fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  test('throws when API key is missing', () => {
    delete process.env.STRIPE_WEBHOOKS_ADVANCED_API_KEY;

    expect(() => Connector.fromEnv()).toThrow('STRIPE_WEBHOOKS_ADVANCED_API_KEY environment variable is required');
  });

  test('uses env base URL and account ID', async () => {
    process.env.STRIPE_WEBHOOKS_ADVANCED_API_KEY = 'sk_org_test';
    process.env.STRIPE_WEBHOOKS_ADVANCED_ACCOUNT_ID = 'acct_123';
    process.env.STRIPE_WEBHOOKS_ADVANCED_BASE_URL = 'https://stripe.test/v1';

    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"object":"list","data":[],"has_more":false,"url":"/v1/webhook_endpoints"}'),
      } as Response),
    );

    await Connector.fromEnv().webhooks.list();

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://stripe.test/v1/webhook_endpoints');
    expect(options.headers['Stripe-Context']).toBe('acct_123');
  });
});
