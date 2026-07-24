import { afterEach, describe, expect, test } from 'bun:test';
import { TrustpilotClient } from './client';
import { Connector } from './index';
import { OAuthApi } from './oauth';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler?: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    } else if (rawHeaders && typeof rawHeaders === 'object') {
      Object.entries(rawHeaders).forEach(([key, value]) => { headers[key.toLowerCase()] = String(value); });
    }

    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);

    const json = handler?.(entry) ?? { ok: true };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
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

describe('TrustpilotClient auth routing', () => {
  test('public endpoints use apikey header', async () => {
    const recorded = installFetch();
    const client = new TrustpilotClient({ apiKey: 'tp-api-key', accessToken: 'oauth-token' });
    await client.get('/categories', undefined, 'apikey');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.trustpilot.com/v1/categories');
    expect(recorded[0].headers.apikey).toBe('tp-api-key');
    expect(recorded[0].headers.authorization).toBeUndefined();
  });

  test('private endpoints prefer bearer token', async () => {
    const recorded = installFetch();
    const client = new TrustpilotClient({ apiKey: 'tp-api-key', accessToken: 'oauth-token' });
    await client.get('/private/business-units/bu-1/reviews');

    expect(recorded[0].headers.authorization).toBe('Bearer oauth-token');
    expect(recorded[0].headers.apikey).toBeUndefined();
  });

  test('private endpoints fall back to apikey when no access token', async () => {
    const recorded = installFetch();
    const client = new TrustpilotClient({ apiKey: 'tp-api-key' });
    await client.get('/private/business-units/bu-1/reviews');

    expect(recorded[0].headers.apikey).toBe('tp-api-key');
    expect(recorded[0].headers.authorization).toBeUndefined();
  });

  test('apikey-only endpoints throw without api key', async () => {
    const client = new TrustpilotClient({ accessToken: 'oauth-token' });
    expect(() => client.get('/categories', undefined, 'apikey')).toThrow('API key is required');
  });

  test('private endpoints throw without credentials', async () => {
    const client = new TrustpilotClient({});
    await expect(client.get('/private/business-units/bu-1/reviews')).rejects.toThrow('credentials not configured');
  });
});

describe('TrustpilotClient route paths', () => {
  test('business unit find uses query param', async () => {
    const recorded = installFetch();
    const client = new TrustpilotClient({ apiKey: 'key' });
    await client.get('/business-units/find', { name: 'Acme Corp' }, 'apikey');
    expect(recorded[0].url).toContain('/business-units/find?name=Acme');
    expect(recorded[0].headers.apikey).toBe('key');
  });

  test('review reply posts to private path with body', async () => {
    const recorded = installFetch();
    const client = new TrustpilotClient({ accessToken: 'token' });
    await client.post('/private/reviews/rev-1/reply', { message: 'Thanks!' });
    expect(recorded[0].url).toContain('/private/reviews/rev-1/reply');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBe(JSON.stringify({ message: 'Thanks!' }));
  });

  test('invitation link creation posts consumer email', async () => {
    const recorded = installFetch();
    const client = new TrustpilotClient({ accessToken: 'token' });
    await client.post('/private/business-units/bu-1/invitation-links', {
      consumerEmail: 'user@example.com',
      consumerName: 'User',
    });
    expect(recorded[0].url).toContain('/private/business-units/bu-1/invitation-links');
    expect(JSON.parse(recorded[0].body!)).toEqual({
      consumerEmail: 'user@example.com',
      consumerName: 'User',
    });
  });

  test('product review summary uses public apikey path', async () => {
    const recorded = installFetch();
    const client = new TrustpilotClient({ apiKey: 'key' });
    await client.get('/product-reviews/business-units/bu-1/summaries', { sku: 'SKU-1' }, 'apikey');
    expect(recorded[0].url).toContain('/product-reviews/business-units/bu-1/summaries?sku=SKU-1');
    expect(recorded[0].headers.apikey).toBe('key');
  });
});

describe('OAuthApi', () => {
  test('generateAuthLink builds authenticate URL', () => {
    const oauth = new OAuthApi('client-id-key');
    const result = oauth.generateAuthLink({ redirectUri: 'https://example.com/callback', state: 'xyz' });
    expect(result.url).toContain('https://authenticate.trustpilot.com/');
    expect(result.url).toContain('client_id=client-id-key');
    expect(result.url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
    expect(result.url).toContain('response_type=code');
    expect(result.url).toContain('state=xyz');
  });

  test('generateAuthLink requires api key', () => {
    const oauth = new OAuthApi(undefined);
    expect(() => oauth.generateAuthLink({ redirectUri: 'https://example.com/callback' })).toThrow('API key is required');
  });
});

describe('Connector', () => {
  test('exposes all API modules', () => {
    const connector = new Connector({ apiKey: 'key', accessToken: 'token' });
    expect(connector.categories).toBeDefined();
    expect(connector.businessUnits).toBeDefined();
    expect(connector.reviews).toBeDefined();
    expect(connector.invitations).toBeDefined();
    expect(connector.products).toBeDefined();
    expect(connector.consumers).toBeDefined();
    expect(connector.tags).toBeDefined();
    expect(connector.oauth).toBeDefined();
  });
});
