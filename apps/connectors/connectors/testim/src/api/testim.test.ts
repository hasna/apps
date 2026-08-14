import { describe, it, expect, afterEach, mock } from 'bun:test';
import { Testim } from './index';
import { TestimClient } from './client';
import { TestsApi } from './tests';
import { TestimApiError } from '../types';

function mockFetch(response: { status?: number; body?: unknown }) {
  const status = response.status ?? 200;
  return mock(() =>
    Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(response.body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    )
  );
}

function restoreFetch(original: typeof globalThis.fetch) {
  globalThis.fetch = original;
}

describe('TestimClient', () => {
  it('requires an API key', () => {
    expect(() => new TestimClient({ apiKey: '' })).toThrow('API key is required');
  });

  it('sends Bearer authorization header', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: unknown, options: { headers: Record<string, string> }) => {
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ tests: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new TestimClient({ apiKey: 'test-api-key' });
    await client.get('/tests');

    expect(capturedHeaders.Authorization).toBe('Bearer test-api-key');
    expect(capturedHeaders.Accept).toBe('application/json');

    restoreFetch(originalFetch);
  });

  it('uses default base URL without /v1 prefix', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: string) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ tests: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new TestimClient({ apiKey: 'key' });
    await client.get('/tests', { branch: 'master' });

    expect(capturedUrl).toBe('https://api.testim.io/tests?branch=master');

    restoreFetch(originalFetch);
  });

  it('supports EU base URL override', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: string) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ tests: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new TestimClient({ apiKey: 'key', baseUrl: 'https://api.eu.testim.io' });
    await client.get('/tests');

    expect(capturedUrl.startsWith('https://api.eu.testim.io/tests')).toBe(true);

    restoreFetch(originalFetch);
  });

  it('throws TestimApiError on failed responses', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      status: 401,
      body: { message: 'Invalid API key' },
    }) as any;

    const client = new TestimClient({ apiKey: 'bad-key' });

    try {
      await client.get('/tests');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TestimApiError);
      expect((err as TestimApiError).statusCode).toBe(401);
      expect((err as TestimApiError).message).toContain('Invalid API key');
    }

    restoreFetch(originalFetch);
  });
});

describe('TestsApi', () => {
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  it('lists tests', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      body: {
        tests: [{ name: 'Login Test', _id: 'abc123' }],
      },
    }) as any;

    const testim = new Testim({ apiKey: 'key' });
    const result = await testim.tests.list({ branch: 'master' });

    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].name).toBe('Login Test');
  });

  it('gets a test by id', async () => {
    originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: string) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(
          JSON.stringify({ name: 'Login Test', testId: 'abc123', status: 'active' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    }) as any;

    const testim = new Testim({ apiKey: 'key' });
    const result = await testim.tests.get('abc123', { branch: 'feature-branch' });

    expect(capturedUrl).toContain('/tests/abc123');
    expect(capturedUrl).toContain('branch=feature-branch');
    expect(result.testId).toBe('abc123');
  });

  it('searches tests by name', async () => {
    originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: string) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(
          JSON.stringify({ tests: [{ id: 'abc', link: 'https://app.testim.io/#/test/abc' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    }) as any;

    const testim = new Testim({ apiKey: 'key' });
    const result = await testim.tests.search('login');

    expect(capturedUrl).toContain('/tests/search');
    expect(capturedUrl).toContain('name=login');
    expect(result.tests[0].id).toBe('abc');
  });

  it('searches suites and test plans', async () => {
    originalFetch = globalThis.fetch;
    const urls: string[] = [];

    globalThis.fetch = mock((url: string) => {
      urls.push(url.toString());
      const path = url.toString();
      const body = path.includes('/suites/search')
        ? { suites: [{ id: 's1', link: 'https://app.testim.io/#/suite/s1' }] }
        : { testPlans: [{ id: 'p1', link: 'https://app.testim.io/#/plan/p1' }] };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const testim = new Testim({ apiKey: 'key' });
    const suites = await testim.tests.searchSuites('smoke');
    const plans = await testim.tests.searchTestPlans('nightly');

    expect(urls.some((u) => u.includes('/suites/search'))).toBe(true);
    expect(urls.some((u) => u.includes('/test-plans/search'))).toBe(true);
    expect(suites.suites[0].id).toBe('s1');
    expect(plans.testPlans[0].id).toBe('p1');
  });

  it('runs a test remotely', async () => {
    originalFetch = globalThis.fetch;
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = mock((_url: string, options: { method: string; body: string }) => {
      capturedMethod = options.method;
      capturedBody = options.body;
      return Promise.resolve(
        new Response(JSON.stringify({ executionId: 'exec-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const testim = new Testim({ apiKey: 'key' });
    const result = await testim.tests.run('abc123', { branch: 'master', grid: 'default' });

    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody)).toEqual({ branch: 'master', grid: 'default' });
    expect(result.executionId).toBe('exec-1');
  });

  it('requires a grid for remote execution params', () => {
    const params = { branch: 'master', grid: 'default' } satisfies Parameters<Testim['tests']['run']>[1];

    expect(params.grid).toBe('default');
  });
});

describe('Testim', () => {
  it('creates from environment variables', () => {
    const original = process.env.TESTIM_API_KEY;
    process.env.TESTIM_API_KEY = 'env-key';

    const testim = Testim.fromEnv();
    expect(testim.tests).toBeInstanceOf(TestsApi);

    if (original) process.env.TESTIM_API_KEY = original;
    else delete process.env.TESTIM_API_KEY;
  });

  it('throws when env API key is missing', () => {
    const original = process.env.TESTIM_API_KEY;
    delete process.env.TESTIM_API_KEY;

    expect(() => Testim.fromEnv()).toThrow('TESTIM_API_KEY environment variable is required');

    if (original) process.env.TESTIM_API_KEY = original;
  });
});
