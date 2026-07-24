import { afterEach, describe, expect, test } from 'bun:test';
import { Wandb, WandbClient } from './index';
import { WandbApiError } from '../types';

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
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
    }
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const entry = { url, method: init?.method ?? 'GET', headers, body };
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

describe('WandbClient', () => {
  test('requires API key', () => {
    expect(() => new WandbClient({ apiKey: '' })).toThrow('W&B API key is required');
  });

  test('sends Bearer authorization header', async () => {
    const recorded = installFetch(() => ({
      data: { viewer: { id: '1', username: 'testuser' } },
    }));
    const client = new WandbClient({ apiKey: 'test-key-123' });
    await client.query('query Viewer { viewer { id username } }');
    expect(recorded[0].url).toBe('https://api.wandb.ai/graphql');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['Authorization']).toBe('Bearer test-key-123');
  });

  test('viewer query sends expected GraphQL body', async () => {
    const recorded = installFetch(() => ({
      data: { viewer: { id: 'v1', username: 'alice', name: 'Alice' } },
    }));
    const wandb = new Wandb({ apiKey: 'key' });
    const result = await wandb.viewer.get();
    expect(result.viewer.username).toBe('alice');
    const body = JSON.parse(recorded[0].body!);
    expect(body.query).toContain('viewer');
    expect(body.query).toContain('username');
  });

  test('projectRuns passes entity and project variables', async () => {
    const recorded = installFetch(() => ({
      data: {
        project: {
          runs: {
            edges: [{ node: { id: 'r1', name: 'run-1', displayName: 'Run 1', state: 'finished' } }],
          },
        },
      },
    }));
    const wandb = new Wandb({ apiKey: 'key' });
    const result = await wandb.projects.projectRuns({ entity: 'team', project: 'demo' });
    expect(result.project?.runs.edges[0].node.name).toBe('run-1');
    const body = JSON.parse(recorded[0].body!);
    expect(body.variables).toEqual({ entity: 'team', project: 'demo', first: 50 });
    expect(body.query).toContain('ProjectRuns');
  });

  test('throws WandbApiError on GraphQL errors', async () => {
    installFetch(() => ({
      errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }],
    }));
    const client = new WandbClient({ apiKey: 'bad-key' });
    await expect(client.query('query { viewer { id } }')).rejects.toThrow('Not authorized');
  });

  test('throws WandbApiError on HTTP errors', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      async json() {
        return {};
      },
    })) as unknown as typeof fetch;
    const client = new WandbClient({ apiKey: 'key' });
    await expect(client.query('query { viewer { id } }')).rejects.toThrow(WandbApiError);
  });

  test('custom base URL is respected', async () => {
    const recorded = installFetch(() => ({ data: { viewer: { id: '1' } } }));
    const client = new WandbClient({ apiKey: 'key', baseUrl: 'https://custom.example/graphql' });
    await client.query('query { viewer { id } }');
    expect(recorded[0].url).toBe('https://custom.example/graphql');
  });
});
