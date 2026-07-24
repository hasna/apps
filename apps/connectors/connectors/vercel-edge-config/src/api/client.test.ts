import { afterEach, describe, expect, mock, test } from 'bun:test';
import { VercelEdgeConfigClient } from './client';
import { VercelEdgeConfig } from './index';
import { VercelEdgeConfigApiError } from '../types';

interface Recorded {
  url: string;
  method: string;
  body?: string;
  auth?: string;
}

function installFetch(handler: () => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = init?.headers as Record<string, string> | undefined;
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      auth: headers?.Authorization,
    });
    const json = handler();
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

describe('VercelEdgeConfigClient', () => {
  const mockConfig = {
    apiKey: 'test-vercel-token-12345',
    teamId: 'team_test123',
    baseUrl: 'https://api.vercel.com',
  };

  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('throws when API key is missing', () => {
    expect(() => new VercelEdgeConfigClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('get() sends Bearer auth and teamId query param', async () => {
    const recorded = installFetch(() => ({ edgeConfigs: [] }));
    const client = new VercelEdgeConfigClient(mockConfig);
    await client.get('/v1/edge-config');

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.vercel.com/v1/edge-config?teamId=team_test123');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].auth).toBe('Bearer test-vercel-token-12345');
  });

  test('patch() targets /v1/edge-config/{id}/items with JSON body', async () => {
    const recorded = installFetch(() => ({ status: 'ok' }));
    const client = new VercelEdgeConfigClient(mockConfig);
    const items = [{ operation: 'upsert', key: 'flag', value: true }];
    await client.patch('/v1/edge-config/ecfg_x/items', items);

    expect(recorded[0].url).toBe('https://api.vercel.com/v1/edge-config/ecfg_x/items?teamId=team_test123');
    expect(recorded[0].method).toBe('PATCH');
    expect(recorded[0].body).toBe(JSON.stringify(items));
  });

  test('throws VercelEdgeConfigApiError on API error response', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({ 'content-type': 'application/json' }),
        async text() {
          return JSON.stringify({ error: { code: 'forbidden', message: 'Not authorized' } });
        },
      }) as Response) as unknown as typeof fetch;

    const client = new VercelEdgeConfigClient(mockConfig);
    await expect(client.get('/v1/edge-config')).rejects.toBeInstanceOf(VercelEdgeConfigApiError);
  });

  test('getApiKeyPreview masks long tokens', () => {
    const client = new VercelEdgeConfigClient(mockConfig);
    expect(client.getApiKeyPreview()).toBe('test-v...2345');
  });
});

describe('VercelEdgeConfig API wrapper', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('listEdgeConfigs calls GET /v1/edge-config', async () => {
    const recorded = installFetch(() => ({ edgeConfigs: [{ id: 'ecfg_1' }] }));
    const api = new VercelEdgeConfig({ apiKey: 'token', teamId: 'team_abc' });
    const result = await api.listEdgeConfigs();

    expect(result.edgeConfigs[0].id).toBe('ecfg_1');
    expect(recorded[0].url).toContain('/v1/edge-config');
    expect(recorded[0].url).toContain('teamId=team_abc');
  });

  test('getItem encodes edgeConfigId and key in path', async () => {
    const recorded = installFetch(() => ({ key: 'my/key', value: 'v' }));
    const api = new VercelEdgeConfig({ apiKey: 'token' });
    await api.getItem('ecfg_x', 'my/key');

    expect(recorded[0].url).toContain('/v1/edge-config/ecfg_x/item/my%2Fkey');
  });
});
