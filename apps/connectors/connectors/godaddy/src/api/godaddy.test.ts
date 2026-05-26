import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { GoDaddy } from './index';
import { GoDaddyClient } from './client';
import { DomainsApi } from './domains';
import { DnsApi } from './dns';
import { GoDaddyApiError, parseApiError } from '../types';

// ============================================
// Helper: mock fetch
// ============================================

function mockFetch(response: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const status = response.status ?? 200;
  const headers = new Headers({
    'content-type': 'application/json',
    ...(response.headers || {}),
  });

  return mock(() =>
    Promise.resolve(
      new Response(
        status === 204 ? null : JSON.stringify(response.body),
        { status, headers }
      )
    )
  );
}

function restoreFetch(original: typeof globalThis.fetch) {
  globalThis.fetch = original;
}

// ============================================
// GoDaddyClient Tests
// ============================================

describe('GoDaddyClient', () => {
  it('should require both apiKey and apiSecret', () => {
    expect(() => new GoDaddyClient({ apiKey: '', apiSecret: '' })).toThrow(
      'Both apiKey and apiSecret are required'
    );
    expect(() => new GoDaddyClient({ apiKey: 'key', apiSecret: '' })).toThrow(
      'Both apiKey and apiSecret are required'
    );
    expect(() => new GoDaddyClient({ apiKey: '', apiSecret: 'secret' })).toThrow(
      'Both apiKey and apiSecret are required'
    );
  });

  it('should create client with valid credentials', () => {
    const client = new GoDaddyClient({ apiKey: 'testkey', apiSecret: 'testsecret' });
    expect(client).toBeDefined();
  });

  it('should include sso-key Authorization header in requests', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: any, options: any) => {
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new GoDaddyClient({ apiKey: 'mykey', apiSecret: 'mysecret' });
    await client.get('/v1/test');

    expect(capturedHeaders['Authorization']).toBe('sso-key mykey:mysecret');
    expect(capturedHeaders['Accept']).toBe('application/json');

    restoreFetch(originalFetch);
  });

  it('should handle 204 No Content', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    ) as any;

    const client = new GoDaddyClient({ apiKey: 'key', apiSecret: 'secret' });
    const result = await client.put('/v1/test');
    expect(result).toEqual({});

    restoreFetch(originalFetch);
  });

  it('should throw GoDaddyApiError on non-ok response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      status: 401,
      body: { message: 'Authentication failed', code: 'UNAUTHORIZED' },
    }) as any;

    const client = new GoDaddyClient({ apiKey: 'badkey', apiSecret: 'badsecret' });

    try {
      await client.get('/v1/domains');
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(GoDaddyApiError);
      expect((err as GoDaddyApiError).statusCode).toBe(401);
      expect((err as GoDaddyApiError).message).toContain('Authentication failed');
    }

    restoreFetch(originalFetch);
  });

  it('should build URL with query parameters', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new GoDaddyClient({ apiKey: 'key', apiSecret: 'secret' });
    await client.get('/v1/domains', { limit: 10, statuses: 'ACTIVE' });

    expect(capturedUrl).toContain('limit=10');
    expect(capturedUrl).toContain('statuses=ACTIVE');

    restoreFetch(originalFetch);
  });

  it('should return credential preview', () => {
    const client = new GoDaddyClient({ apiKey: 'abcdef1234567890', apiSecret: 'secret' });
    expect(client.getCredentialPreview()).toBe('Key: abcdef...');
  });

  it('should send JSON body for POST requests', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: any, options: any) => {
      capturedBody = options.body;
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ orderId: 123 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new GoDaddyClient({ apiKey: 'key', apiSecret: 'secret' });
    await client.post('/v1/domains/example.com/renew', { period: 1 });

    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(JSON.parse(capturedBody)).toEqual({ period: 1 });

    restoreFetch(originalFetch);
  });
});

// ============================================
// DomainsApi Tests
// ============================================

describe('DomainsApi', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  it('should list domains', async () => {
    const mockDomains = [
      { domain: 'example.com', status: 'ACTIVE', expires: '2027-01-01T00:00:00Z', renewAuto: true, nameServers: ['ns1.godaddy.com'] },
      { domain: 'test.org', status: 'ACTIVE', expires: '2026-06-15T00:00:00Z', renewAuto: false, nameServers: [] },
    ];

    globalThis.fetch = mockFetch({ body: mockDomains }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    const result = await gd.domains.list();

    expect(result).toHaveLength(2);
    expect(result[0].domain).toBe('example.com');
    expect(result[1].domain).toBe('test.org');
  });

  it('should list domains with filters', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    await gd.domains.list({ limit: 5, statuses: ['ACTIVE', 'EXPIRED'] });

    expect(capturedUrl).toContain('limit=5');
    expect(capturedUrl).toContain('statuses=ACTIVE%2CEXPIRED');
  });

  it('should get domain info', async () => {
    const mockDetail = {
      domain: 'example.com',
      domainId: 12345,
      status: 'ACTIVE',
      expires: '2027-01-01T00:00:00Z',
      renewAuto: true,
      nameServers: ['ns1.godaddy.com'],
      createdAt: '2020-01-01T00:00:00Z',
      locked: true,
      privacy: true,
      expirationProtected: false,
      holdRegistrar: false,
      registrarCreatedAt: '2020-01-01T00:00:00Z',
      renewDeadline: '2027-02-01T00:00:00Z',
      transferProtected: true,
    };

    globalThis.fetch = mockFetch({ body: mockDetail }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    const result = await gd.domains.getInfo('example.com');

    expect(result.domain).toBe('example.com');
    expect(result.domainId).toBe(12345);
    expect(result.locked).toBe(true);
  });

  it('should URL-encode domain name in getInfo', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    await gd.domains.getInfo('my-domain.co.uk');

    expect(capturedUrl).toContain('/v1/domains/my-domain.co.uk');
  });

  it('should renew a domain', async () => {
    const mockResponse = { orderId: 999, itemCount: 1, total: 14.99 };
    globalThis.fetch = mockFetch({ body: mockResponse }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    const result = await gd.domains.renew('example.com');

    expect(result.orderId).toBe(999);
    expect(result.total).toBe(14.99);
  });

  it('should renew a domain for multiple years', async () => {
    let capturedBody = '';
    globalThis.fetch = mock((_url: any, options: any) => {
      capturedBody = options.body;
      return Promise.resolve(
        new Response(JSON.stringify({ orderId: 100, itemCount: 1, total: 29.98 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    await gd.domains.renew('example.com', 2);

    expect(JSON.parse(capturedBody)).toEqual({ period: 2 });
  });

  it('should check domain availability', async () => {
    const mockAvailability = {
      available: true,
      domain: 'newdomain.com',
      definitive: true,
      price: 11.99,
      currency: 'USD',
      period: 1,
    };

    globalThis.fetch = mockFetch({ body: mockAvailability }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    const result = await gd.domains.checkAvailability('newdomain.com');

    expect(result.available).toBe(true);
    expect(result.domain).toBe('newdomain.com');
    expect(result.price).toBe(11.99);
  });

  it('should handle unavailable domain', async () => {
    const mockAvailability = {
      available: false,
      domain: 'google.com',
      definitive: true,
      price: 0,
      currency: 'USD',
      period: 0,
    };

    globalThis.fetch = mockFetch({ body: mockAvailability }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    const result = await gd.domains.checkAvailability('google.com');

    expect(result.available).toBe(false);
  });
});

// ============================================
// DnsApi Tests
// ============================================

describe('DnsApi', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  it('should get all DNS records for a domain', async () => {
    const mockRecords = [
      { type: 'A', name: '@', data: '1.2.3.4', ttl: 3600 },
      { type: 'CNAME', name: 'www', data: '@', ttl: 3600 },
      { type: 'MX', name: '@', data: 'mail.example.com', ttl: 3600, priority: 10 },
    ];

    globalThis.fetch = mockFetch({ body: mockRecords }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    const records = await gd.dns.getRecords('example.com');

    expect(records).toHaveLength(3);
    expect(records[0].type).toBe('A');
    expect(records[2].priority).toBe(10);
  });

  it('should get DNS records filtered by type', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify([{ type: 'A', name: '@', data: '1.2.3.4', ttl: 3600 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    await gd.dns.getRecords('example.com', 'A');

    expect(capturedUrl).toContain('/v1/domains/example.com/records/A');
  });

  it('should get DNS records by type and name', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify([{ type: 'A', name: 'www', data: '1.2.3.4', ttl: 3600 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    await gd.dns.getRecordsByName('example.com', 'A', 'www');

    expect(capturedUrl).toContain('/v1/domains/example.com/records/A/www');
  });

  it('should set DNS records by type', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = mock((url: any, options: any) => {
      capturedUrl = url.toString();
      capturedMethod = options.method;
      capturedBody = options.body;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    const records = [
      { type: 'A', name: '@', data: '1.2.3.4', ttl: 3600 },
      { type: 'A', name: 'www', data: '5.6.7.8', ttl: 3600 },
    ];

    await gd.dns.setRecords('example.com', 'A', records);

    expect(capturedUrl).toContain('/v1/domains/example.com/records/A');
    expect(capturedMethod).toBe('PUT');
    expect(JSON.parse(capturedBody)).toHaveLength(2);
  });

  it('should replace all DNS records', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = mock((url: any, options: any) => {
      capturedUrl = url.toString();
      capturedMethod = options.method;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    await gd.dns.replaceAllRecords('example.com', [
      { type: 'A', name: '@', data: '1.2.3.4', ttl: 3600 },
    ]);

    expect(capturedUrl).toContain('/v1/domains/example.com/records');
    expect(capturedUrl).not.toContain('/records/A');
    expect(capturedMethod).toBe('PUT');
  });

  it('should add DNS records (PATCH)', async () => {
    let capturedMethod = '';

    globalThis.fetch = mock((_url: any, options: any) => {
      capturedMethod = options.method;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    await gd.dns.addRecords('example.com', [
      { type: 'TXT', name: '@', data: 'v=spf1 include:_spf.google.com ~all', ttl: 3600 },
    ]);

    expect(capturedMethod).toBe('PATCH');
  });

  it('should set records by type and name', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = mock((url: any, options: any) => {
      capturedUrl = url.toString();
      capturedMethod = options.method;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as any;

    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    await gd.dns.setRecordsByName('example.com', 'A', 'www', [
      { type: 'A', name: 'www', data: '1.2.3.4', ttl: 3600 },
    ]);

    expect(capturedUrl).toContain('/v1/domains/example.com/records/A/www');
    expect(capturedMethod).toBe('PUT');
  });
});

// ============================================
// GoDaddy Connector Class Tests
// ============================================

describe('GoDaddy', () => {
  it('should create from config', () => {
    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    expect(gd.domains).toBeInstanceOf(DomainsApi);
    expect(gd.dns).toBeInstanceOf(DnsApi);
  });

  it('should create from environment variables', () => {
    const originalKey = process.env.GODADDY_API_KEY;
    const originalSecret = process.env.GODADDY_API_SECRET;

    process.env.GODADDY_API_KEY = 'envkey';
    process.env.GODADDY_API_SECRET = 'envsecret';

    const gd = GoDaddy.fromEnv();
    expect(gd).toBeDefined();
    expect(gd.domains).toBeInstanceOf(DomainsApi);

    // Restore
    if (originalKey) process.env.GODADDY_API_KEY = originalKey;
    else delete process.env.GODADDY_API_KEY;
    if (originalSecret) process.env.GODADDY_API_SECRET = originalSecret;
    else delete process.env.GODADDY_API_SECRET;
  });

  it('should throw when creating from env without credentials', () => {
    const originalKey = process.env.GODADDY_API_KEY;
    const originalSecret = process.env.GODADDY_API_SECRET;

    delete process.env.GODADDY_API_KEY;
    delete process.env.GODADDY_API_SECRET;

    expect(() => GoDaddy.fromEnv()).toThrow(
      'GODADDY_API_KEY and GODADDY_API_SECRET environment variables are required'
    );

    // Restore
    if (originalKey) process.env.GODADDY_API_KEY = originalKey;
    if (originalSecret) process.env.GODADDY_API_SECRET = originalSecret;
  });

  it('should return credential preview', () => {
    const gd = new GoDaddy({ apiKey: 'abcdef1234567890', apiSecret: 'secret' });
    expect(gd.getCredentialPreview()).toBe('Key: abcdef...');
  });

  it('should expose underlying client', () => {
    const gd = new GoDaddy({ apiKey: 'key', apiSecret: 'secret' });
    const client = gd.getClient();
    expect(client).toBeInstanceOf(GoDaddyClient);
  });
});

// ============================================
// Error Handling Tests
// ============================================

describe('GoDaddyApiError', () => {
  it('should create error with statusCode', () => {
    const err = new GoDaddyApiError('Not found', 404);
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('GoDaddyApiError');
  });

  it('should detect rate limiting', () => {
    const err = new GoDaddyApiError('Too many requests', 429);
    expect(err.isRateLimited()).toBe(true);
    expect(err.isServerError()).toBe(false);
    expect(err.isClientError()).toBe(true);
  });

  it('should detect auth errors', () => {
    const err401 = new GoDaddyApiError('Unauthorized', 401);
    const err403 = new GoDaddyApiError('Forbidden', 403);
    expect(err401.isAuthError()).toBe(true);
    expect(err403.isAuthError()).toBe(true);
  });

  it('should detect server errors', () => {
    const err = new GoDaddyApiError('Internal server error', 500);
    expect(err.isServerError()).toBe(true);
    expect(err.isClientError()).toBe(false);
  });

  it('should provide user-friendly messages', () => {
    expect(new GoDaddyApiError('', 401).getUserMessage()).toContain('Authentication failed');
    expect(new GoDaddyApiError('', 429).getUserMessage()).toContain('Rate limit');
    expect(new GoDaddyApiError('', 404).getUserMessage()).toContain('not found');
  });

  it('should serialize to JSON', () => {
    const err = new GoDaddyApiError('Test error', 400, {
      errors: [{ code: 'INVALID', message: 'Bad input' }],
    });
    const json = err.toJSON();
    expect(json.statusCode).toBe(400);
    expect(json.errors).toHaveLength(1);
  });
});

describe('parseApiError', () => {
  it('should parse string response', () => {
    const err = parseApiError('Something went wrong', 500);
    expect(err.message).toBe('Something went wrong');
    expect(err.statusCode).toBe(500);
  });

  it('should parse object with message field', () => {
    const err = parseApiError({ message: 'Bad request', code: 'INVALID' }, 400);
    expect(err.message).toBe('Bad request');
  });

  it('should parse object with error field', () => {
    const err = parseApiError({ error: 'Unauthorized' }, 401);
    expect(err.message).toBe('Unauthorized');
  });

  it('should handle null response', () => {
    const err = parseApiError(null, 500);
    expect(err.message).toBe('HTTP 500 Error');
  });

  it('should parse GoDaddy fields array', () => {
    const err = parseApiError(
      {
        message: 'Validation error',
        fields: [
          { code: 'REQUIRED', message: 'Name is required', path: 'name' },
        ],
      },
      422
    );
    expect(err.errors).toHaveLength(1);
    expect(err.errors![0].code).toBe('REQUIRED');
  });
});
