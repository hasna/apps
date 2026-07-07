import { describe, it, expect, afterEach, mock } from 'bun:test';
import { Zipkin } from './index';
import { ZipkinClient, DEFAULT_BASE_URL } from './client';
import { TracesApi } from './traces';
import { EventsApi } from './events';
import { SearchApi } from './search';
import { ZipkinApiError } from '../types';

function restoreFetch(original: typeof globalThis.fetch) {
  globalThis.fetch = original;
}

describe('ZipkinClient', () => {
  it('should require an API key', () => {
    expect(() => new ZipkinClient({ apiKey: '' })).toThrow('API key is required');
  });

  it('should default to Zipkin Cloud base URL', () => {
    const client = new ZipkinClient({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toBe('https://api.zipkin.io/v1');
  });

  it('should include Bearer authorization header', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: unknown, options: RequestInit) => {
      capturedHeaders = options.headers as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const client = new ZipkinClient({ apiKey: 'my-zipkin-key' });
    await client.get('/traces');

    expect(capturedHeaders.Authorization).toBe('Bearer my-zipkin-key');
    expect(capturedHeaders.Accept).toBe('application/json');

    restoreFetch(originalFetch);
  });

  it('should use custom base URL when provided', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const client = new ZipkinClient({
      apiKey: 'key',
      baseUrl: 'https://zipkin.example.com/api/v2/',
    });
    await client.get('/traces');

    expect(capturedUrl).toBe('https://zipkin.example.com/api/v2/traces');

    restoreFetch(originalFetch);
  });

  it('should throw ZipkinApiError on non-ok response', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ) as any;

    const client = new ZipkinClient({ apiKey: 'bad-key' });

    try {
      await client.get('/traces');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ZipkinApiError);
      expect((err as ZipkinApiError).statusCode).toBe(401);
      expect((err as ZipkinApiError).message).toContain('Unauthorized');
    }

    restoreFetch(originalFetch);
  });
});

describe('TracesApi', () => {
  afterEach(() => {
    restoreFetch(globalThis.fetch);
  });

  it('should list traces with query parameters', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify([[]]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const client = new ZipkinClient({ apiKey: 'key' });
    const traces = new TracesApi(client);
    await traces.list({ serviceName: 'frontend', limit: 5 });

    expect(capturedUrl).toContain('/traces');
    expect(capturedUrl).toContain('serviceName=frontend');
    expect(capturedUrl).toContain('limit=5');

    restoreFetch(originalFetch);
  });

  it('should encode trace ID in get path', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const client = new ZipkinClient({ apiKey: 'key' });
    const traces = new TracesApi(client);
    await traces.get('abc/def');

    expect(capturedUrl).toContain('/traces/abc%2Fdef');

    restoreFetch(originalFetch);
  });

  it('should POST spans to create a trace', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedBody = '';

    globalThis.fetch = mock((url: unknown, options: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(options.body);
      return Promise.resolve(new Response(null, { status: 202 }));
    }) as any;

    const client = new ZipkinClient({ apiKey: 'key' });
    const traces = new TracesApi(client);
    const span = {
      traceId: 'abc123',
      id: 'span1',
      name: 'get',
      timestamp: 1_700_000_000_000_000,
    };

    await traces.create(span);

    expect(capturedUrl).toContain('/traces');
    expect(capturedBody).toContain('"traceId":"abc123"');

    restoreFetch(originalFetch);
  });
});

describe('EventsApi', () => {
  it('should list events', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const client = new ZipkinClient({ apiKey: 'key' });
    const events = new EventsApi(client);
    await events.list({ traceId: 'trace-1', limit: 20 });

    expect(capturedUrl).toContain('/events');
    expect(capturedUrl).toContain('traceId=trace-1');
    expect(capturedUrl).toContain('limit=20');

    restoreFetch(originalFetch);
  });
});

describe('SearchApi', () => {
  it('should POST search body', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedBody = '';

    globalThis.fetch = mock((url: unknown, options: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(options.body);
      return Promise.resolve(
        new Response(JSON.stringify([[]]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const client = new ZipkinClient({ apiKey: 'key' });
    const search = new SearchApi(client);
    await search.search({
      serviceName: 'api',
      annotationQuery: 'http.status_code=500',
      limit: 3,
    });

    expect(capturedUrl).toContain('/search');
    expect(capturedBody).toContain('"serviceName":"api"');
    expect(capturedBody).toContain('"annotationQuery":"http.status_code=500"');
    expect(capturedBody).toContain('"limit":3');

    restoreFetch(originalFetch);
  });
});

describe('Zipkin', () => {
  it('should expose API modules', () => {
    const zipkin = new Zipkin({ apiKey: 'key' });
    expect(zipkin.traces).toBeDefined();
    expect(zipkin.events).toBeDefined();
    expect(zipkin.search).toBeDefined();
  });
});
