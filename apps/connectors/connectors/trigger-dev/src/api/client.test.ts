import { afterEach, describe, expect, test } from 'bun:test';
import { TriggerDev } from './index';

const realFetch = globalThis.fetch;

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
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    }
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

describe('TriggerDevClient', () => {
  test('sends Bearer authorization header', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new TriggerDev({ apiKey: 'tr_dev_test_key_12345' });
    await client.listRuns();
    expect(recorded[0].headers.authorization).toBe('Bearer tr_dev_test_key_12345');
  });

  test('listRuns calls GET https://api.trigger.dev/v1/runs', async () => {
    const recorded = installFetch(() => ({ data: [{ id: 'run_1' }] }));
    const client = new TriggerDev({ apiKey: 'key' });
    const result = await client.listRuns();
    expect(recorded[0].url).toBe('https://api.trigger.dev/v1/runs');
    expect(recorded[0].method).toBe('GET');
    expect(result).toEqual({ data: [{ id: 'run_1' }] });
  });

  test('getRun calls GET https://api.trigger.dev/v1/runs/{id}', async () => {
    const recorded = installFetch(() => ({ id: 'run_abc' }));
    const client = new TriggerDev({ apiKey: 'key' });
    const result = await client.getRun('run_abc');
    expect(recorded[0].url).toBe('https://api.trigger.dev/v1/runs/run_abc');
    expect(recorded[0].method).toBe('GET');
    expect(result).toEqual({ id: 'run_abc' });
  });

  test('createRun posts JSON body to /runs', async () => {
    const recorded = installFetch(() => ({ id: 'run_new' }));
    const client = new TriggerDev({ apiKey: 'key' });
    await client.createRun({ taskIdentifier: 'my-task', payload: { foo: 'bar' } });
    expect(recorded[0].url).toBe('https://api.trigger.dev/v1/runs');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({
      taskIdentifier: 'my-task',
      payload: { foo: 'bar' },
    });
  });

  test('listEvents calls GET /events', async () => {
    const recorded = installFetch(() => ({ events: [] }));
    const client = new TriggerDev({ apiKey: 'key' });
    await client.listEvents({ limit: 10 });
    expect(recorded[0].url).toBe('https://api.trigger.dev/v1/events?limit=10');
    expect(recorded[0].method).toBe('GET');
  });

  test('search posts to /search', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const client = new TriggerDev({ apiKey: 'key' });
    await client.search({ query: 'status:failed' });
    expect(recorded[0].url).toBe('https://api.trigger.dev/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ query: 'status:failed' });
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch(() => ({}));
    const client = new TriggerDev({
      apiKey: 'key',
      baseUrl: 'https://custom.example/v1',
    });
    await client.getRun('x');
    expect(recorded[0].url).toBe('https://custom.example/v1/runs/x');
  });

  test('requires API key', () => {
    expect(() => new TriggerDev({ apiKey: '' })).toThrow('API key is required');
  });
});
