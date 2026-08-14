import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient } from './client';
import { Connector } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, init.headers);
      }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init);
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

describe('WorkflowTrigger API client', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('API key is required');
  });

  test('list triggers uses Bearer auth and GET /triggers', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new ConnectorClient({ apiKey: 'test-key' });
    await client.get('/triggers');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.workflow-trigger.com/v1/triggers');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization || recorded[0].headers.authorization).toBe('Bearer test-key');
  });

  test('get trigger encodes ID in path', async () => {
    const recorded = installFetch(() => ({ id: 'item-1' }));
    const connector = new Connector({ apiKey: 'workflow-trigger-key' });
    await connector.triggers.get('item-1');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.workflow-trigger.com/v1/triggers/item-1');
    expect(recorded[0].headers.Authorization || recorded[0].headers.authorization).toBe('Bearer workflow-trigger-key');
  });

  test('custom base URL override', async () => {
    const recorded = installFetch(() => ({}));
    const client = new ConnectorClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example.com/v2',
    });
    await client.get('/events');

    expect(recorded[0].url).toBe('https://custom.example.com/v2/events');
  });

  test('search posts to /search', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const connector = new Connector({ apiKey: 'key' });
    await connector.search.search({ query: 'test' });

    expect(recorded[0].url).toBe('https://api.workflow-trigger.com/v1/search');
    expect(recorded[0].method).toBe('POST');
  });
});
