import { afterEach, describe, expect, test } from 'bun:test';
import { TraverseClient, DEFAULT_BASE_URL } from './client';
import { Traverse } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(handler?: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
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

describe('TraverseClient', () => {
  test('requires API key', () => {
    expect(() => new TraverseClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('uses Bearer auth for list environments', async () => {
    const recorded = installFetch();
    const client = new TraverseClient({ apiKey: 'traverse-key' });
    await client.get('/environments');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/environments`);
    expect(recorded[0].headers.authorization).toBe('Bearer traverse-key');
    expect(recorded[0].method).toBe('GET');
  });

  test('encodes episode id path segments', async () => {
    const recorded = installFetch();
    const client = new TraverseClient({ apiKey: 'traverse-key' });
    await client.post('/episodes/ep%201/judgments', { score: 0.9 });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/episodes/ep%201/judgments`);
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ score: 0.9 });
    expect(recorded[0].headers.authorization).toBe('Bearer traverse-key');
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch();
    const client = new TraverseClient({
      apiKey: 'traverse-key',
      baseUrl: 'https://custom.example/v2/',
    });
    await client.get('/datasets');
    expect(recorded[0].url).toBe('https://custom.example/v2/datasets');
  });
});

describe('Traverse facade', () => {
  test('episodes.submitJudgment encodes episode id', async () => {
    const recorded = installFetch();
    const traverse = new Traverse({ apiKey: 'traverse-key' });
    await traverse.episodes.submitJudgment('ep 1', { score: 0.9 });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/episodes/ep%201/judgments`);
    expect(JSON.parse(recorded[0].body as string)).toEqual({ score: 0.9 });
  });

  test('environments.get encodes environment id', async () => {
    const recorded = installFetch();
    const traverse = new Traverse({ apiKey: 'traverse-key' });
    await traverse.environments.get('env/with space');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/environments/env%2Fwith%20space`);
  });
});
