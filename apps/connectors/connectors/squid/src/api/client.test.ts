import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, ConnectorClient, DEFAULT_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler?: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler ? handler(entry) : { ok: true };
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

describe('Squid API client', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('Squid API key is required');
  });

  test('listNetworkModels sends Bearer auth to default base URL', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'squid-key' });
    await client.listNetworkModels();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/network-models`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer squid-key');
  });

  test('getNetworkModel encodes model ID in path', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'squid-key' });
    await client.getNetworkModel('model/1');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/network-models/model%2F1`);
    expect(recorded[0].headers.authorization).toBe('Bearer squid-key');
  });

  test('listAssets hits /assets', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'squid-key' });
    await client.listAssets();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/assets`);
  });

  test('listWorkflows hits /workflows', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'squid-key' });
    await client.listWorkflows();
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/workflows`);
  });

  test('createWorkflowRun POSTs workflow body', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'squid-key' });
    await client.createWorkflowRun({ workflowId: 'wf1', input: { region: 'uk' } });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/workflow-runs`);
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.authorization).toBe('Bearer squid-key');
    expect(JSON.parse(recorded[0].body!)).toEqual({ workflowId: 'wf1', input: { region: 'uk' } });
  });

  test('listModelVersions hits versions subpath', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'squid-key' });
    await client.listModelVersions('model-42');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/network-models/model-42/versions`);
  });

  test('rawRequest supports custom path and method', async () => {
    const recorded = installFetch();
    const client = new Connector({ apiKey: 'squid-key', baseUrl: 'https://custom.example/v1' });
    await client.rawRequest({ method: 'PATCH', path: '/custom', body: { enabled: true } });
    expect(recorded[0].url).toBe('https://custom.example/v1/custom');
    expect(recorded[0].method).toBe('PATCH');
    expect(recorded[0].headers.authorization).toBe('Bearer squid-key');
  });
});
