import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { UnissonClient } from './client';
import { Unisson } from './index';
import { UnissonApiError } from '../types';

const mockConfig = {
  apiKey: 'unisson-key',
  baseUrl: 'https://api.unisson.ai/v1',
};

const realFetch = globalThis.fetch;

interface Recorded {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    let body: unknown;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    }
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    recorded.push({ method: init?.method ?? 'GET', url, body, headers });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve('{"ok":true}'),
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('UnissonClient', () => {
  test('throws when api key is missing', () => {
    expect(() => new UnissonClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('getApiKeyPreview masks long keys', () => {
    const client = new UnissonClient(mockConfig);
    expect(client.getApiKeyPreview()).toBe('unisso...-key');
  });

  test('uses bearer authorization on GET requests', async () => {
    const recorded = installFetch();
    const client = new UnissonClient(mockConfig);
    await client.get('/agents', { status: 'active' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.unisson.ai/v1/agents?status=active');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers?.authorization ?? recorded[0].headers?.Authorization).toBe('Bearer unisson-key');
  });

  test('encodes path segments with spaces', async () => {
    const recorded = installFetch();
    const client = new UnissonClient(mockConfig);
    await client.get('/agents/agent 1');

    expect(recorded[0].url).toBe('https://api.unisson.ai/v1/agents/agent%201');
  });

  test('POST sends JSON body', async () => {
    const recorded = installFetch();
    const client = new UnissonClient(mockConfig);
    await client.post('/agents', { product: 'Acme SaaS', channel: 'slack' });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toEqual({ product: 'Acme SaaS', channel: 'slack' });
  });

  test('throws UnissonApiError on HTTP errors', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"message":"invalid key"}'),
      }) as Response) as unknown as typeof fetch;

    const client = new UnissonClient(mockConfig);
    await expect(client.get('/agents')).rejects.toBeInstanceOf(UnissonApiError);
  });
});

describe('Unisson Runner API endpoints', () => {
  let captured: Recorded[];

  beforeEach(() => {
    captured = installFetch();
  });

  test('matches platform-alumia Runner API contract', async () => {
    const api = new Unisson(mockConfig);

    await api.agents.list({ status: 'active' });
    await api.agents.get('agent 1');
    await api.agents.create({ product: 'Acme SaaS', channel: 'slack' });
    await api.tasks.list({ open: true });
    await api.tasks.get('task 1');
    await api.tasks.create({ agentId: 'agent 1', title: 'Onboard customer' });
    await api.knowledge.listArticles({ updatedSince: '2026-01-01' });
    await api.knowledge.sync({ source: 'docs' });

    expect(captured.map((r) => [r.method, r.url])).toEqual([
      ['GET', 'https://api.unisson.ai/v1/agents?status=active'],
      ['GET', 'https://api.unisson.ai/v1/agents/agent%201'],
      ['POST', 'https://api.unisson.ai/v1/agents'],
      ['GET', 'https://api.unisson.ai/v1/tasks?open=true'],
      ['GET', 'https://api.unisson.ai/v1/tasks/task%201'],
      ['POST', 'https://api.unisson.ai/v1/tasks'],
      ['GET', 'https://api.unisson.ai/v1/knowledge/articles?updatedSince=2026-01-01'],
      ['POST', 'https://api.unisson.ai/v1/knowledge/sync'],
    ]);

    expect(captured[2].body).toEqual({ product: 'Acme SaaS', channel: 'slack' });
    expect(captured[5].body).toEqual({ agentId: 'agent 1', title: 'Onboard customer' });
    expect(captured[7].body).toEqual({ source: 'docs' });
  });

  test('raw-request supports arbitrary paths', async () => {
    const api = new Unisson(mockConfig);
    await api.rawRequest('/runner/execute', {
      method: 'POST',
      body: { prompt: 'Configure SSO' },
    });

    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe('https://api.unisson.ai/v1/runner/execute');
    expect(captured[0].body).toEqual({ prompt: 'Configure SSO' });
    expect(captured[0].headers?.authorization).toBe('Bearer unisson-key');
  });

  test('fromEnv requires UNISSON_API_KEY', () => {
    const saved = process.env.UNISSON_API_KEY;
    delete process.env.UNISSON_API_KEY;
    expect(() => Unisson.fromEnv()).toThrow(/UNISSON_API_KEY/);
    if (saved) process.env.UNISSON_API_KEY = saved;
  });
});
