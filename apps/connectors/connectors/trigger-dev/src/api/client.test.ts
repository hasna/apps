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
    const client = new TriggerDev({ apiKey: 'test-secret-key' });
    await client.listRuns();
    expect(recorded[0].headers.authorization).toBe('Bearer test-secret-key');
  });

  test('listRuns calls GET https://api.trigger.dev/api/v1/runs', async () => {
    const recorded = installFetch(() => ({ data: [{ id: 'run_1' }] }));
    const client = new TriggerDev({ apiKey: 'key' });
    const result = await client.listRuns();
    expect(recorded[0].url).toBe('https://api.trigger.dev/api/v1/runs');
    expect(recorded[0].method).toBe('GET');
    expect(result).toEqual({ data: [{ id: 'run_1' }] });
  });

  test('listRuns encodes documented filter and page query parameters', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new TriggerDev({ apiKey: 'key' });
    await client.listRuns({
      limit: 25,
      status: ['QUEUED', 'EXECUTING'],
      taskIdentifier: 'my-task',
      after: 'run_after',
      period: '1d',
    });
    expect(recorded[0].url).toBe(
      'https://api.trigger.dev/api/v1/runs?page%5Bsize%5D=25&page%5Bafter%5D=run_after&filter%5Bstatus%5D=QUEUED%2CEXECUTING&filter%5BtaskIdentifier%5D=my-task&filter%5BcreatedAt%5D%5Bperiod%5D=1d',
    );
  });

  test('getRun calls GET https://api.trigger.dev/api/v1/runs/{id}', async () => {
    const recorded = installFetch(() => ({ id: 'run_abc' }));
    const client = new TriggerDev({ apiKey: 'key' });
    const result = await client.getRun('run_abc');
    expect(recorded[0].url).toBe('https://api.trigger.dev/api/v1/runs/run_abc');
    expect(recorded[0].method).toBe('GET');
    expect(result).toEqual({ id: 'run_abc' });
  });

  test('createRun triggers a task with JSON body', async () => {
    const recorded = installFetch(() => ({ id: 'run_new' }));
    const client = new TriggerDev({ apiKey: 'key' });
    await client.createRun({ taskIdentifier: 'my-task', payload: { foo: 'bar' } });
    expect(recorded[0].url).toBe('https://api.trigger.dev/api/v1/tasks/my-task/trigger');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({
      payload: { foo: 'bar' },
    });
  });

  test('listEvents calls GET /runs/{runId}/events', async () => {
    const recorded = installFetch(() => ({ events: [] }));
    const client = new TriggerDev({ apiKey: 'key' });
    await client.listEvents('run_123');
    expect(recorded[0].url).toBe('https://api.trigger.dev/api/v1/runs/run_123/events');
    expect(recorded[0].method).toBe('GET');
  });

  test('search posts to /query', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const client = new TriggerDev({ apiKey: 'key' });
    await client.search({ query: "SELECT run_id FROM runs WHERE status = 'FAILED'" });
    expect(recorded[0].url).toBe('https://api.trigger.dev/api/v1/query');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({ query: "SELECT run_id FROM runs WHERE status = 'FAILED'" });
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
