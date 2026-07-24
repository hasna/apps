import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { SpecsApi } from './specs';
import { BuildsApi } from './builds';
import { PullRequestsApi } from './pull-requests';
import { TasksApi } from './tasks';
import { RawApi } from './raw';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

const originalFetch = globalThis.fetch;

function mockFetchResolve(body: unknown, status = 200) {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  ) as unknown as typeof fetch;
}

function mockFetchReject() {
  globalThis.fetch = mock(() => Promise.reject(new Error('Network error'))) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ============================================
// Client Tests
// ============================================

describe('ConnectorClient', () => {
  test('requires apiKey', () => {
    expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('creates client with valid config', () => {
    const client = new ConnectorClient({ apiKey: 'test-key-1234567890' });
    expect(client).toBeDefined();
    expect(client.getApiKeyPreview()).toBe('test-k...7890');
  });

  test('uses default base URL', () => {
    const client = new ConnectorClient({ apiKey: 'key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('honors base URL override and strips trailing slash', () => {
    const client = new ConnectorClient({ apiKey: 'key', baseUrl: 'https://example.test/api/' });
    expect(client.getBaseUrl()).toBe('https://example.test/api');
    expect(client.buildUrl('/specs')).toBe('https://example.test/api/specs');
  });

  test('builds correct URL', () => {
    const client = new ConnectorClient({ apiKey: 'key' });
    expect(client.buildUrl('/specs/abc')).toBe('https://api.syntropy.io/v1/specs/abc');
  });

  test('builds URL with query params, skipping undefined', () => {
    const client = new ConnectorClient({ apiKey: 'key' });
    const url = client.buildUrl('/specs', { status: 'ready', limit: 10, skip: undefined });
    expect(url).toBe('https://api.syntropy.io/v1/specs?status=ready&limit=10');
  });

  test('getApiKeyPreview masks key', () => {
    const client = new ConnectorClient({ apiKey: 'abcdef1234567890' });
    expect(client.getApiKeyPreview()).toBe('abcdef...7890');
  });

  test('getApiKeyPreview returns *** for short key', () => {
    const client = new ConnectorClient({ apiKey: '1234567890' });
    expect(client.getApiKeyPreview()).toBe('***');
  });

  test('request returns stub when API unreachable', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key-12345' });
    mockFetchReject();
    const result = await client.request('/specs');
    expect(result.stub).toBe(true);
    expect(result.data).toBeNull();
  });

  test('request throws ConnectorApiError on HTTP error', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key-12345' });
    mockFetchResolve('Unauthorized', 401);
    await expect(client.request('/specs')).rejects.toThrow('Syntropy API GET');
  });

  test('request sends POST with JSON body and returns parsed JSON', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key-12345' });
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    }) as unknown as typeof fetch;

    const result = await client.request<{ ok: boolean }>('/specs', {
      method: 'POST',
      body: { title: 'x' },
    });
    expect(result.stub).toBe(false);
    expect(result.data).toEqual({ ok: true });
    expect(captured!.init.method).toBe('POST');
    expect(captured!.init.body).toBe(JSON.stringify({ title: 'x' }));
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe('Bearer test-key-12345');
  });

  test('rawRequest returns status/body without throwing on non-2xx', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key-12345' });
    mockFetchResolve({ error: 'not found' }, 404);
    const result = await client.rawRequest('GET', '/whatever');
    expect(result.stub).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.data).toEqual({ error: 'not found' });
  });

  test('rawRequest returns stub on network failure', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key-12345' });
    mockFetchReject();
    const result = await client.rawRequest('GET', '/whatever');
    expect(result.stub).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });
});

// ============================================
// Connector Tests
// ============================================

describe('Connector', () => {
  test('creates connector with valid config', () => {
    const connector = new Connector({ apiKey: 'key' });
    expect(connector.specs).toBeDefined();
    expect(connector.builds).toBeDefined();
    expect(connector.pullRequests).toBeDefined();
    expect(connector.tasks).toBeDefined();
    expect(connector.raw).toBeDefined();
  });

  test('fromEnv throws without SYNTROPY_API_KEY', () => {
    const origKey = process.env.SYNTROPY_API_KEY;
    delete process.env.SYNTROPY_API_KEY;
    expect(() => Connector.fromEnv()).toThrow('SYNTROPY_API_KEY environment variable is required');
    if (origKey) process.env.SYNTROPY_API_KEY = origKey;
  });

  test('fromEnv creates connector with env vars', () => {
    const origKey = process.env.SYNTROPY_API_KEY;
    const origUrl = process.env.SYNTROPY_BASE_URL;
    process.env.SYNTROPY_API_KEY = 'test-key-12345';
    process.env.SYNTROPY_BASE_URL = 'https://custom.test/v2';

    const connector = Connector.fromEnv();
    expect(connector.getApiKeyPreview()).toBe('test-k...2345');
    expect(connector.getBaseUrl()).toBe('https://custom.test/v2');

    if (origKey) process.env.SYNTROPY_API_KEY = origKey; else delete process.env.SYNTROPY_API_KEY;
    if (origUrl) process.env.SYNTROPY_BASE_URL = origUrl; else delete process.env.SYNTROPY_BASE_URL;
  });

  test('getClient returns the underlying client', () => {
    const connector = new Connector({ apiKey: 'key' });
    expect(connector.getClient()).toBeInstanceOf(ConnectorClient);
  });
});

// ============================================
// SpecsApi Tests
// ============================================

describe('SpecsApi', () => {
  let api: SpecsApi;
  beforeEach(() => {
    api = new SpecsApi(new ConnectorClient({ apiKey: 'test-key-12345' }));
  });

  test('list returns live data on success', async () => {
    mockFetchResolve({ specs: [{ id: 's1', title: 'Feature', status: 'ready' }] });
    const result = await api.list();
    expect(result.stub).toBe(false);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0].id).toBe('s1');
  });

  test('list returns stub data when API unreachable', async () => {
    mockFetchReject();
    const result = await api.list();
    expect(result.stub).toBe(true);
    expect(result.specs.length).toBeGreaterThan(0);
  });

  test('get returns live data (enveloped)', async () => {
    mockFetchResolve({ spec: { id: 's7', title: 'X', status: 'building' } });
    const result = await api.get('s7');
    expect(result.stub).toBe(false);
    expect(result.spec.id).toBe('s7');
    expect(result.spec.status).toBe('building');
  });

  test('get returns stub for the requested id when unreachable', async () => {
    mockFetchReject();
    const result = await api.get('missing');
    expect(result.stub).toBe(true);
    expect(result.spec.id).toBe('missing');
  });

  test('create posts and returns live data', async () => {
    mockFetchResolve({ spec: { id: 'new1', title: 'Login', status: 'draft' } }, 201);
    const result = await api.create({ title: 'Login', prompt: 'Add login' });
    expect(result.stub).toBe(false);
    expect(result.spec.id).toBe('new1');
    expect(result.spec.title).toBe('Login');
  });

  test('create returns stub echoing the title when unreachable', async () => {
    mockFetchReject();
    const result = await api.create({ title: 'Offline Spec' });
    expect(result.stub).toBe(true);
    expect(result.spec.title).toBe('Offline Spec');
  });

  test('list throws on HTTP 500', async () => {
    mockFetchResolve('Internal Server Error', 500);
    await expect(api.list()).rejects.toThrow('Syntropy API GET');
  });
});

// ============================================
// BuildsApi Tests
// ============================================

describe('BuildsApi', () => {
  let api: BuildsApi;
  beforeEach(() => {
    api = new BuildsApi(new ConnectorClient({ apiKey: 'test-key-12345' }));
  });

  test('list returns live data on success', async () => {
    mockFetchResolve({ builds: [{ id: 'b1', spec_id: 's1', status: 'succeeded' }] });
    const result = await api.list();
    expect(result.stub).toBe(false);
    expect(result.builds[0].id).toBe('b1');
  });

  test('list returns stub when unreachable', async () => {
    mockFetchReject();
    const result = await api.list();
    expect(result.stub).toBe(true);
    expect(result.builds.length).toBeGreaterThan(0);
  });

  test('get returns live build', async () => {
    mockFetchResolve({ build: { id: 'b9', spec_id: 's2', status: 'running' } });
    const result = await api.get('b9');
    expect(result.stub).toBe(false);
    expect(result.build.id).toBe('b9');
  });

  test('start returns live build on success', async () => {
    mockFetchResolve({ build: { id: 'b10', spec_id: 's3', status: 'queued' } }, 201);
    const result = await api.start('s3');
    expect(result.stub).toBe(false);
    expect(result.build.spec_id).toBe('s3');
    expect(result.build.status).toBe('queued');
  });

  test('start returns stub echoing spec id when unreachable', async () => {
    mockFetchReject();
    const result = await api.start('s99');
    expect(result.stub).toBe(true);
    expect(result.build.spec_id).toBe('s99');
  });
});

// ============================================
// PullRequestsApi Tests
// ============================================

describe('PullRequestsApi', () => {
  let api: PullRequestsApi;
  beforeEach(() => {
    api = new PullRequestsApi(new ConnectorClient({ apiKey: 'test-key-12345' }));
  });

  test('list returns live data on success', async () => {
    mockFetchResolve({ pull_requests: [{ id: 'pr1', title: 'T', url: 'http://x', status: 'open' }] });
    const result = await api.list();
    expect(result.stub).toBe(false);
    expect(result.pull_requests[0].id).toBe('pr1');
  });

  test('list returns stub when unreachable', async () => {
    mockFetchReject();
    const result = await api.list();
    expect(result.stub).toBe(true);
    expect(result.pull_requests.length).toBeGreaterThan(0);
  });

  test('list throws on HTTP 403', async () => {
    mockFetchResolve('Forbidden', 403);
    await expect(api.list()).rejects.toThrow('Syntropy API GET');
  });
});

// ============================================
// TasksApi Tests
// ============================================

describe('TasksApi', () => {
  let api: TasksApi;
  beforeEach(() => {
    api = new TasksApi(new ConnectorClient({ apiKey: 'test-key-12345' }));
  });

  test('list returns live data on success', async () => {
    mockFetchResolve({ tasks: [{ id: 't1', title: 'Do', status: 'done' }] });
    const result = await api.list();
    expect(result.stub).toBe(false);
    expect(result.tasks[0].id).toBe('t1');
  });

  test('list returns stub when unreachable', async () => {
    mockFetchReject();
    const result = await api.list();
    expect(result.stub).toBe(true);
    expect(result.tasks.length).toBeGreaterThan(0);
  });
});

// ============================================
// RawApi Tests
// ============================================

describe('RawApi', () => {
  let api: RawApi;
  beforeEach(() => {
    api = new RawApi(new ConnectorClient({ apiKey: 'test-key-12345' }));
  });

  test('request surfaces status and body', async () => {
    mockFetchResolve({ hello: 'world' }, 200);
    const result = await api.request({ path: '/anything' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ hello: 'world' });
  });

  test('request does not throw on 500, reports status', async () => {
    mockFetchResolve('boom', 500);
    const result = await api.request({ method: 'POST', path: '/anything', body: { a: 1 } });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  test('request returns stub on network failure', async () => {
    mockFetchReject();
    const result = await api.request({ path: '/anything' });
    expect(result.stub).toBe(true);
    expect(result.ok).toBe(false);
  });
});

// ============================================
// ConnectorApiError Tests
// ============================================

describe('ConnectorApiError', () => {
  test('creates error with message and status code', () => {
    const err = new ConnectorApiError('test error', 500);
    expect(err.message).toBe('test error');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('ConnectorApiError');
  });

  test('creates error with response body', () => {
    const err = new ConnectorApiError('unauthorized', 401, '{"error":"invalid_key"}');
    expect(err.responseBody).toBe('{"error":"invalid_key"}');
    expect(err.statusCode).toBe(401);
  });
});
