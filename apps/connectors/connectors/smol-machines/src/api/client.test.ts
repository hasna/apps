import { afterEach, describe, expect, test } from 'bun:test';
import { SmolMachinesClient, DEFAULT_BASE_URL } from './client';
import { MachinesApi } from './machines';

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
    } else if (rawHeaders) {
      Object.entries(rawHeaders as Record<string, string>).forEach(([key, value]) => {
        headers[key.toLowerCase()] = value;
      });
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

describe('SmolMachinesClient', () => {
  test('uses default hosted base URL', () => {
    const client = new SmolMachinesClient();
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(client.hasApiKey()).toBe(false);
  });

  test('omits Authorization header when api_key is unset', async () => {
    const recorded = installFetch(() => []);
    const client = new SmolMachinesClient({ baseUrl: 'http://127.0.0.1:8080/api/v1' });
    await client.get('/machines');
    expect(recorded[0].url).toBe('http://127.0.0.1:8080/api/v1/machines');
    expect(recorded[0].headers.authorization).toBeUndefined();
  });

  test('sends Bearer token when api_key is configured', async () => {
    const recorded = installFetch(() => []);
    const client = new SmolMachinesClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.smolmachines.com/v1',
    });
    await client.get('/machines');
    expect(recorded[0].headers.authorization).toBe('Bearer test-key');
    expect(recorded[0].url).toBe('https://api.smolmachines.com/v1/machines');
  });

  test('respects base_url override', async () => {
    const recorded = installFetch(() => ({ name: 'demo', state: 'stopped' }));
    const client = new SmolMachinesClient({ baseUrl: 'http://127.0.0.1:9000/api/v1' });
    await client.get('/machines/demo');
    expect(recorded[0].url).toBe('http://127.0.0.1:9000/api/v1/machines/demo');
  });
});

describe('MachinesApi', () => {
  test('list hits GET /machines', async () => {
    const recorded = installFetch(() => [{ name: 'a' }, { name: 'b' }]);
    const api = new MachinesApi(new SmolMachinesClient());
    const machines = await api.list();
    expect(machines).toHaveLength(2);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].url).toContain('/machines');
  });

  test('exec posts command payload with encoded machine name', async () => {
    const recorded = installFetch(() => ({ stdout: 'hello\n', exitCode: 0 }));
    const api = new MachinesApi(new SmolMachinesClient());
    await api.exec('my vm', { command: ['echo', 'hello'] });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toContain('/machines/my%20vm/exec');
    expect(JSON.parse(recorded[0].body!)).toEqual({ command: ['echo', 'hello'] });
  });

  test('delete issues DELETE to machine path', async () => {
    const recorded = installFetch(() => ({}));
    const api = new MachinesApi(new SmolMachinesClient());
    await api.delete('sandbox');
    expect(recorded[0].method).toBe('DELETE');
    expect(recorded[0].url).toContain('/machines/sandbox');
  });
});
