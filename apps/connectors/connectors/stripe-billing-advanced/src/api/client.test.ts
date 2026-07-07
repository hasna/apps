import { describe, test, expect, mock } from 'bun:test';
import {
  StripeBillingAdvancedClient,
  DEFAULT_API_VERSION,
  DEFAULT_BASE_URL,
  DEFAULT_BILLING_PATH_PREFIX,
} from './client';
import { StripeBillingAdvanced } from './index';

describe('StripeBillingAdvancedClient', () => {
  test('requires apiKey', () => {
    expect(() => new StripeBillingAdvancedClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('uses default base URL and API version', () => {
    const client = new StripeBillingAdvancedClient({ apiKey: 'test_key_1234567890' });
    expect(client.buildUrl('/v2/billing/pricing_plans')).toBe(
      `${DEFAULT_BASE_URL}${DEFAULT_BILLING_PATH_PREFIX}/pricing_plans`,
    );
    expect(client.getApiVersion()).toBe(DEFAULT_API_VERSION);
  });

  test('getApiKeyPreview masks key', () => {
    const client = new StripeBillingAdvancedClient({ apiKey: 'test_key_abcdefghijklmnop' });
    expect(client.getApiKeyPreview()).toBe('test_k...mnop');
  });

  test('POST pricing_plans sends Bearer, Stripe-Version, and JSON body', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ id: 'pp_test', object: 'v2.billing.pricing_plan' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    try {
      const client = new StripeBillingAdvancedClient({
        apiKey: 'test_key_secret',
        apiVersion: '2026-05-27.preview',
      });
      await client.post('/v2/billing/pricing_plans', {
        display_name: 'Pro Plan',
        currency: 'usd',
      });

      expect(capturedUrl).toBe('https://api.stripe.com/v2/billing/pricing_plans');
      expect(capturedInit?.method).toBe('POST');
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test_key_secret');
      expect(headers['Stripe-Version']).toBe('2026-05-27.preview');
      expect(headers['Content-Type']).toBe('application/json');
      expect(capturedInit?.body).toBe(JSON.stringify({ display_name: 'Pro Plan', currency: 'usd' }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('StripeBillingAdvanced', () => {
  test('createPricingPlan uses billing path prefix', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ id: 'pp_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    try {
      const api = new StripeBillingAdvanced({ apiKey: 'test_key' });
      await api.createPricingPlan({ display_name: 'Test', currency: 'usd' });
      expect(capturedUrl).toBe('https://api.stripe.com/v2/billing/pricing_plans');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fromEnv throws without STRIPE_BILLING_ADVANCED_API_KEY', () => {
    const orig = process.env.STRIPE_BILLING_ADVANCED_API_KEY;
    delete process.env.STRIPE_BILLING_ADVANCED_API_KEY;
    expect(() => StripeBillingAdvanced.fromEnv()).toThrow('STRIPE_BILLING_ADVANCED_API_KEY');
    if (orig) process.env.STRIPE_BILLING_ADVANCED_API_KEY = orig;
  });
});
