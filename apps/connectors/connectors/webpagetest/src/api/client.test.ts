import { afterEach, describe, expect, test } from 'bun:test';
import { WebPageTest } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) {
        headers[key.toLowerCase()] = value;
      }
    } else if (rawHeaders) {
      for (const [key, value] of Object.entries(rawHeaders)) {
        headers[key.toLowerCase()] = value;
      }
    }

    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);

    const json = handler(entry);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;

  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('WebPageTest API client', () => {
  test('requires API key', () => {
    expect(() => new WebPageTest({ apiKey: '' })).toThrow('API key is required');
  });

  test('listTests sends GET /tests with X-WPT-API-KEY header', async () => {
    const recorded = installFetch((request) => {
      expect(request.method).toBe('GET');
      expect(request.url).toBe('https://api.webpagetest.org/v1/tests?limit=5');
      expect(request.headers['x-wpt-api-key']).toBe('test-api-key');
      return { data: [] };
    });

    const client = new WebPageTest({ apiKey: 'test-api-key' });
    await client.listTests({ limit: 5 });

    expect(recorded).toHaveLength(1);
  });

  test('getTest sends GET /tests/{id} with encoded path', async () => {
    const recorded = installFetch((request) => {
      expect(request.method).toBe('GET');
      expect(request.url).toBe('https://api.webpagetest.org/v1/tests/240101_AB_cd');
      expect(request.headers['x-wpt-api-key']).toBe('secret-key');
      return { id: '240101_AB_cd', status: 'completed' };
    });

    const client = new WebPageTest({ apiKey: 'secret-key' });
    const result = await client.getTest('240101_AB_cd');

    expect(result).toEqual({ id: '240101_AB_cd', status: 'completed' });
    expect(recorded).toHaveLength(1);
  });

  test('createTest sends POST /tests with JSON body', async () => {
    const recorded = installFetch((request) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe('https://api.webpagetest.org/v1/tests');
      expect(request.headers['content-type']).toBe('application/json');
      expect(request.headers['x-wpt-api-key']).toBe('test-api-key');
      expect(JSON.parse(request.body ?? '{}')).toEqual({
        url: 'https://example.com',
        location: 'ec2-us-east-1',
      });
      return { id: 'new-test' };
    });

    const client = new WebPageTest({ apiKey: 'test-api-key' });
    const result = await client.createTest({
      url: 'https://example.com',
      location: 'ec2-us-east-1',
    });

    expect(result).toEqual({ id: 'new-test' });
    expect(recorded).toHaveLength(1);
  });

  test('runClassicTest uses classic host and runtest.php', async () => {
    const recorded = installFetch((request) => {
      expect(request.method).toBe('POST');
      expect(request.url).toContain('https://www.webpagetest.org/runtest.php');
      expect(request.url).toContain('url=https%3A%2F%2Fexample.com');
      expect(request.headers['x-wpt-api-key']).toBe('classic-key');
      return { statusCode: 200, data: { testId: 'abc' } };
    });

    const client = new WebPageTest({ apiKey: 'classic-key' });
    await client.runClassicTest({ url: 'https://example.com', f: 'json' });

    expect(recorded).toHaveLength(1);
  });

  test('supports custom REST base URL override', async () => {
    const recorded = installFetch((request) => {
      expect(request.url).toBe('https://wpt.example.com/v1/events');
      return { events: [] };
    });

    const client = new WebPageTest({
      apiKey: 'key',
      baseUrl: 'https://wpt.example.com/v1',
    });
    await client.listEvents();

    expect(recorded).toHaveLength(1);
  });
});
