import { afterEach, describe, expect, test } from 'bun:test';
import { SproutSocial } from './index';
import { SproutSocialApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; json?: unknown },
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body,
    });
    const { status = 200, json } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SproutSocial API transport', () => {
  test('sends a Bearer authorization header', async () => {
    const recorded = installFetch(() => ({ json: { data: [] } }));
    const sprout = new SproutSocial({ accessToken: 'secret-token', customerId: '123' });
    await sprout.getClientMetadata();
    expect(recorded[0].headers['Authorization']).toBe('Bearer secret-token');
    expect(recorded[0].headers['Accept']).toBe('application/json');
  });

  test('metadata client hits /metadata/client without a customer id', async () => {
    const recorded = installFetch(() => ({ json: { data: [{ customer_id: 1, customer_name: 'Acme' }] } }));
    const sprout = new SproutSocial({ accessToken: 't' });
    const res = await sprout.getClientMetadata();
    expect(res.data[0]?.customer_name).toBe('Acme');
    expect(recorded[0].url).toBe('https://api.sproutsocial.com/v1/metadata/client');
    expect(recorded[0].method).toBe('GET');
  });

  test('customer-scoped endpoints embed the customer id in the path', async () => {
    const recorded = installFetch(() => ({ json: { data: [] } }));
    const sprout = new SproutSocial({ accessToken: 't', customerId: '987' });
    await sprout.getCustomerProfiles();
    expect(recorded[0].url).toBe('https://api.sproutsocial.com/v1/987/metadata/customer');
  });

  test('customer-scoped endpoints throw a clear error when the customer id is missing', async () => {
    installFetch(() => ({ json: {} }));
    const sprout = new SproutSocial({ accessToken: 't' });
    await expect(sprout.getCustomerProfiles()).rejects.toThrow(/customer id is required/i);
  });

  test('profile analytics POSTs the query body', async () => {
    const recorded = installFetch(() => ({ json: { data: [] } }));
    const sprout = new SproutSocial({ accessToken: 't', customerId: '55' });
    await sprout.getProfileAnalytics({
      filters: ['customer_profile_id.eq(1)'],
      metrics: ['impressions'],
      page: 2,
    });
    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.sproutsocial.com/v1/55/analytics/profiles');
    expect(call.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({
      filters: ['customer_profile_id.eq(1)'],
      metrics: ['impressions'],
      page: 2,
    });
  });

  test('createPost forces is_draft on', async () => {
    const recorded = installFetch(() => ({ json: { data: [{ publishing_post_id: 'p1' }] } }));
    const sprout = new SproutSocial({ accessToken: 't', customerId: '9' });
    await sprout.createPost({ group_id: 3, customer_profile_ids: [1, 2], text: 'hello' });
    const body = JSON.parse(recorded[0].body as string);
    expect(body.is_draft).toBe(true);
    expect(body.group_id).toBe(3);
    expect(body.customer_profile_ids).toEqual([1, 2]);
    expect(body.text).toBe('hello');
  });

  test('maps error responses to SproutSocialApiError', async () => {
    installFetch(() => ({ status: 401, json: { error: 'Unauthorized', code: 401 } }));
    const sprout = new SproutSocial({ accessToken: 'bad', customerId: '1' });
    try {
      await sprout.getCustomerProfiles();
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(SproutSocialApiError);
      const apiErr = err as SproutSocialApiError;
      expect(apiErr.statusCode).toBe(401);
      expect(apiErr.message).toBe('Unauthorized');
      expect(apiErr.code).toBe(401);
    }
  });

  test('honors a custom base URL without trailing slash duplication', async () => {
    const recorded = installFetch(() => ({ json: { data: [] } }));
    const sprout = new SproutSocial({
      accessToken: 't',
      customerId: '2',
      baseUrl: 'https://api.sproutsocial.com/v1/',
    });
    await sprout.getTags();
    expect(recorded[0].url).toBe('https://api.sproutsocial.com/v1/2/metadata/customer/tags');
  });
});
