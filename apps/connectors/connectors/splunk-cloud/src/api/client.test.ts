import { describe, test, expect, mock } from 'bun:test';
import { SplunkCloudClient } from './client';
import { SplunkCloud } from './index';
import { SplunkCloudApiError, parseApiError } from '../types';

const BASE = 'https://stack.example.splunkcloud.com:8089';

// ============================================
// Client construction & auth
// ============================================

describe('SplunkCloudClient', () => {
  test('requires a base URL', () => {
    expect(() => new SplunkCloudClient({ baseUrl: '', token: 't' })).toThrow('Base URL is required');
  });

  test('requires authentication', () => {
    expect(() => new SplunkCloudClient({ baseUrl: BASE })).toThrow('Authentication is required');
  });

  test('accepts username/password', () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, username: 'admin', password: 'secret' });
    expect(client).toBeDefined();
  });

  test('strips trailing slash from base URL', () => {
    const client = new SplunkCloudClient({ baseUrl: `${BASE}/`, token: 'tok' });
    expect(client.getBaseUrl()).toBe(BASE);
  });

  test('buildUrl injects output_mode=json', () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, token: 'tok' });
    const url = client.buildUrl('/services/server/info');
    expect(url).toBe(`${BASE}/services/server/info?output_mode=json`);
  });

  test('buildUrl merges extra params', () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, token: 'tok' });
    const url = new URL(client.buildUrl('/services/search/jobs', { count: 5, offset: 0 }));
    expect(url.searchParams.get('output_mode')).toBe('json');
    expect(url.searchParams.get('count')).toBe('5');
    // offset 0 is falsy-empty guarded? 0 is not undefined/null/'' so it stays
    expect(url.searchParams.get('offset')).toBe('0');
  });

  test('buildUrl normalizes paths without a leading slash', () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, token: 'tok' });
    expect(client.buildUrl('services/apps/local')).toBe(`${BASE}/services/apps/local?output_mode=json`);
  });

  test('getKeyPreview masks a long token', () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, token: 'abcdef1234567890' });
    expect(client.getKeyPreview()).toBe('abcdef...7890');
  });

  test('getKeyPreview returns *** for a short token', () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, token: '1234567890' });
    expect(client.getKeyPreview()).toBe('***');
  });
});

// ============================================
// Auth header & request behavior (mocked fetch)
// ============================================

describe('SplunkCloudClient requests', () => {
  test('sends a Bearer token', async () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, token: 'my-token' });
    let capturedHeaders: Record<string, string> = {};

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({ entry: [] }), { status: 200 }));
    }) as any;

    await client.get('/services/server/info');
    expect(capturedHeaders['Authorization']).toBe('Bearer my-token');

    globalThis.fetch = originalFetch;
  });

  test('sends Basic auth when username/password given', async () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, username: 'admin', password: 'pw' });
    let capturedHeaders: Record<string, string> = {};

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({ entry: [] }), { status: 200 }));
    }) as any;

    await client.get('/services/server/info');
    const expected = `Basic ${Buffer.from('admin:pw').toString('base64')}`;
    expect(capturedHeaders['Authorization']).toBe(expected);

    globalThis.fetch = originalFetch;
  });

  test('encodes POST bodies as form-urlencoded', async () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, token: 'tok' });
    let capturedBody = '';
    let capturedContentType = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      capturedContentType = (init.headers as Record<string, string>)['Content-Type'];
      return Promise.resolve(new Response(JSON.stringify({ sid: '123' }), { status: 201 }));
    }) as any;

    await client.post('/services/search/jobs', { search: 'search index=_internal', exec_mode: 'normal' });
    expect(capturedContentType).toBe('application/x-www-form-urlencoded');
    const parsed = new URLSearchParams(capturedBody);
    expect(parsed.get('search')).toBe('search index=_internal');
    expect(parsed.get('exec_mode')).toBe('normal');

    globalThis.fetch = originalFetch;
  });

  test('throws SplunkCloudApiError with parsed message on HTTP error', async () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, token: 'tok', retries: 0 });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ messages: [{ type: 'ERROR', text: 'Unauthorized' }] }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ) as any;

    await expect(client.get('/services/server/info')).rejects.toThrow('Unauthorized');

    globalThis.fetch = originalFetch;
  });

  test('returns parsed JSON on success', async () => {
    const client = new SplunkCloudClient({ baseUrl: BASE, token: 'tok' });
    const payload = { entry: [{ name: 'main', content: { totalEventCount: 42 } }] };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })),
    ) as any;

    const result = await client.get<typeof payload>('/services/data/indexes');
    expect(result.entry[0]!.name).toBe('main');

    globalThis.fetch = originalFetch;
  });
});

// ============================================
// SplunkCloud high-level class
// ============================================

describe('SplunkCloud', () => {
  test('constructs with a valid config', () => {
    const sc = new SplunkCloud({ baseUrl: BASE, token: 'tok' });
    expect(sc.getBaseUrl()).toBe(BASE);
    expect(sc.getClient()).toBeInstanceOf(SplunkCloudClient);
  });

  test('createSearchJob prepends "search" to bare SPL', async () => {
    const sc = new SplunkCloud({ baseUrl: BASE, token: 'tok' });
    let capturedBody = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve(new Response(JSON.stringify({ sid: 'abc' }), { status: 201 }));
    }) as any;

    const res = await sc.createSearchJob({ search: 'index=_internal | head 10' });
    expect(res.sid).toBe('abc');
    expect(new URLSearchParams(capturedBody).get('search')).toBe('search index=_internal | head 10');

    globalThis.fetch = originalFetch;
  });

  test('createSearchJob leaves a leading pipe SPL untouched', async () => {
    const sc = new SplunkCloud({ baseUrl: BASE, token: 'tok' });
    let capturedBody = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve(new Response(JSON.stringify({ sid: 'abc' }), { status: 201 }));
    }) as any;

    await sc.createSearchJob({ search: '| metadata type=sourcetypes' });
    expect(new URLSearchParams(capturedBody).get('search')).toBe('| metadata type=sourcetypes');

    globalThis.fetch = originalFetch;
  });

  test('getServerInfo unwraps the entry envelope', async () => {
    const sc = new SplunkCloud({ baseUrl: BASE, token: 'tok' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ entry: [{ name: 'server', content: { version: '9.2.0', isCloud: 1 } }] }), {
          status: 200,
        }),
      ),
    ) as any;

    const info = await sc.getServerInfo();
    expect(info.version).toBe('9.2.0');
    expect(info.isCloud).toBe(1);

    globalThis.fetch = originalFetch;
  });

  test('fromEnv throws without a base URL', () => {
    const origBase = process.env.SPLUNK_CLOUD_BASE_URL;
    delete process.env.SPLUNK_CLOUD_BASE_URL;
    expect(() => SplunkCloud.fromEnv()).toThrow('SPLUNK_CLOUD_BASE_URL');
    if (origBase) process.env.SPLUNK_CLOUD_BASE_URL = origBase;
  });

  test('fromEnv throws without credentials', () => {
    const orig = {
      base: process.env.SPLUNK_CLOUD_BASE_URL,
      token: process.env.SPLUNK_CLOUD_TOKEN,
      user: process.env.SPLUNK_CLOUD_USERNAME,
      pass: process.env.SPLUNK_CLOUD_PASSWORD,
    };
    process.env.SPLUNK_CLOUD_BASE_URL = BASE;
    delete process.env.SPLUNK_CLOUD_TOKEN;
    delete process.env.SPLUNK_CLOUD_USERNAME;
    delete process.env.SPLUNK_CLOUD_PASSWORD;

    expect(() => SplunkCloud.fromEnv()).toThrow('Authentication required');

    if (orig.base) process.env.SPLUNK_CLOUD_BASE_URL = orig.base; else delete process.env.SPLUNK_CLOUD_BASE_URL;
    if (orig.token) process.env.SPLUNK_CLOUD_TOKEN = orig.token;
    if (orig.user) process.env.SPLUNK_CLOUD_USERNAME = orig.user;
    if (orig.pass) process.env.SPLUNK_CLOUD_PASSWORD = orig.pass;
  });

  test('fromEnv builds a client from env vars', () => {
    const orig = { base: process.env.SPLUNK_CLOUD_BASE_URL, token: process.env.SPLUNK_CLOUD_TOKEN };
    process.env.SPLUNK_CLOUD_BASE_URL = BASE;
    process.env.SPLUNK_CLOUD_TOKEN = 'env-token-1234567890';

    const sc = SplunkCloud.fromEnv();
    expect(sc.getKeyPreview()).toBe('env-to...7890');

    if (orig.base) process.env.SPLUNK_CLOUD_BASE_URL = orig.base; else delete process.env.SPLUNK_CLOUD_BASE_URL;
    if (orig.token) process.env.SPLUNK_CLOUD_TOKEN = orig.token; else delete process.env.SPLUNK_CLOUD_TOKEN;
  });
});

// ============================================
// Error helpers
// ============================================

describe('parseApiError', () => {
  test('extracts Splunk message text', () => {
    const err = parseApiError({ messages: [{ type: 'ERROR', text: 'bad request' }] }, 400);
    expect(err).toBeInstanceOf(SplunkCloudApiError);
    expect(err.message).toBe('bad request');
    expect(err.statusCode).toBe(400);
  });

  test('falls back to a generic message', () => {
    const err = parseApiError('plain text error', 500);
    expect(err.message).toContain('status 500');
    expect(err.responseBody).toBe('plain text error');
  });
});
