import { afterEach, describe, expect, test } from 'bun:test';
import { Wiz, WizClient } from './index';

const realFetch = globalThis.fetch;

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const entry: Recorded = {
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
      async json() {
        return json ?? {};
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('WizClient', () => {
  test('requires apiKey', () => {
    expect(() => new WizClient({ apiKey: '' })).toThrow('Wiz apiKey is required');
  });

  test('listIssues calls GET /issues with Bearer auth', async () => {
    const recorded = installFetch((call) => {
      expect(call.url).toBe('https://api.wiz.io/v1/issues?limit=10');
      expect(call.method).toBe('GET');
      expect(headerValue(call.headers, 'Authorization')).toBe('Bearer test-key');
      return { issues: [{ id: 'issue-1' }] };
    });

    const client = new WizClient({ apiKey: 'test-key' });
    const result = await client.request('/issues', { params: { limit: 10 } });
    expect(result).toEqual({ issues: [{ id: 'issue-1' }] });
    expect(recorded).toHaveLength(1);
  });

  test('getIssue encodes issue id in path', async () => {
    const recorded = installFetch((call) => {
      expect(call.url).toBe('https://api.wiz.io/v1/issues/item-1');
      expect(headerValue(call.headers, 'Authorization')).toBe('Bearer test-key');
      return { id: 'item-1' };
    });

    const wiz = new Wiz({ apiKey: 'test-key' });
    const issue = await wiz.getIssue('item-1');
    expect(issue).toEqual({ id: 'item-1' });
    expect(recorded).toHaveLength(1);
  });

  test('createIssue POSTs JSON body to /issues', async () => {
    const recorded = installFetch((call) => {
      expect(call.url).toBe('https://api.wiz.io/v1/issues');
      expect(call.method).toBe('POST');
      expect(call.body).toBe(JSON.stringify({ title: 'New issue' }));
      return { id: 'new-issue' };
    });

    const wiz = new Wiz({ apiKey: 'test-key' });
    const issue = await wiz.createIssue({ title: 'New issue' });
    expect(issue).toEqual({ id: 'new-issue' });
    expect(recorded).toHaveLength(1);
  });

  test('search POSTs to /search', async () => {
    const recorded = installFetch((call) => {
      expect(call.url).toBe('https://api.wiz.io/v1/search');
      expect(call.method).toBe('POST');
      expect(call.body).toBe(JSON.stringify({ query: 'severity:HIGH' }));
      return { results: [] };
    });

    const wiz = new Wiz({ apiKey: 'test-key' });
    await wiz.search({ query: 'severity:HIGH' });
    expect(recorded).toHaveLength(1);
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch((call) => {
      expect(call.url).toBe('https://api.wiz.io/v1/custom?foo=bar');
      expect(call.method).toBe('PUT');
      return { ok: true };
    });

    const wiz = new Wiz({ apiKey: 'test-key' });
    await wiz.rawRequest({ method: 'PUT', path: '/custom', params: { foo: 'bar' } });
    expect(recorded).toHaveLength(1);
  });

  test('uses custom base URL when configured', async () => {
    const recorded = installFetch((call) => {
      expect(call.url).toBe('https://custom.example/v1/events');
      return { events: [] };
    });

    const wiz = new Wiz({ apiKey: 'test-key', baseUrl: 'https://custom.example/v1' });
    await wiz.listEvents();
    expect(recorded).toHaveLength(1);
  });

  test('fromEnv reads WIZ_API_KEY and WIZ_BASE_URL', () => {
    process.env.WIZ_API_KEY = 'env-key';
    process.env.WIZ_BASE_URL = 'https://env.example/v1';
    const wiz = Wiz.fromEnv();
    expect(wiz.getClient()).toBeDefined();
    delete process.env.WIZ_API_KEY;
    delete process.env.WIZ_BASE_URL;
  });
});
