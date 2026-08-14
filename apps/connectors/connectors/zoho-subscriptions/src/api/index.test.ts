import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoSubscriptions } from './index';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ZohoSubscriptions facade', () => {
  test('listCustomers and listSubscriptions smoke', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/customers')) {
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ code: 0, customers: [{ customer_id: 'c1' }] })),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ code: 0, subscriptions: [{ subscription_id: 's1' }] })),
      } as Response;
    }) as typeof fetch;

    const zs = new ZohoSubscriptions({ token: 'tok', organizationId: 'org-1' });
    const customers = await zs.listCustomers();
    const subscriptions = await zs.listSubscriptions({ status: 'live' });

    expect(customers.customers[0]?.customer_id).toBe('c1');
    expect(subscriptions.subscriptions[0]?.subscription_id).toBe('s1');
  });
});
