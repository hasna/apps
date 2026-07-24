import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { WithAiClient } from './client';
import { WithAi } from './index';

const originalFetch = globalThis.fetch;
let captured: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') return undefined;
  return JSON.parse(init.body);
}

describe('WithAiClient', () => {
  beforeEach(() => {
    captured = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: urlOf(input), init, body: jsonBody(init) });
      return Response.json({ ok: true, connector: 'withai' });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    captured = [];
  });

  test('requires api key', () => {
    expect(() => new WithAiClient({ apiKey: '' })).toThrow('API key or token is required');
  });

  test('builds default base URL', () => {
    const client = new WithAiClient({ apiKey: 'withai-key' });
    expect(client.buildUrl('/workspaces')).toBe('https://api.withai.co/v1/workspaces');
  });

  test('encodes path segments in URLs', () => {
    const client = new WithAiClient({ apiKey: 'withai-key' });
    expect(client.buildUrl('/workspaces/ws%201')).toBe('https://api.withai.co/v1/workspaces/ws%201');
  });
});

describe('WithAi connector API', () => {
  let api: WithAi;

  beforeEach(() => {
    captured = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: urlOf(input), init, body: jsonBody(init) });
      return Response.json({ ok: true, connector: 'withai' });
    }) as unknown as typeof fetch;
    api = new WithAi({ apiKey: 'withai-key' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    captured = [];
  });

  test('uses bearer credentials for command-center endpoints', async () => {
    await api.listWorkspaces({ firm: 'alpha' });
    await api.getWorkspace('ws 1');
    await api.createResearchTask('ws 1', { ticker: 'MSFT', prompt: 'update model' });
    await api.getResearchTask('task 1');
    await api.searchDocuments({ search_text: 'channel checks', filters: { ticker: 'MSFT' } });
    await api.createPortfolioAlert({ ticker: 'MSFT', threshold: 'guidance change' });
    await api.listIntegrations({ status: 'connected' });

    expect(captured.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', 'https://api.withai.co/v1/workspaces?firm=alpha'],
      ['GET', 'https://api.withai.co/v1/workspaces/ws%201'],
      ['POST', 'https://api.withai.co/v1/workspaces/ws%201/research-tasks'],
      ['GET', 'https://api.withai.co/v1/research-tasks/task%201'],
      ['POST', 'https://api.withai.co/v1/documents/search'],
      ['POST', 'https://api.withai.co/v1/portfolio/alerts'],
      ['GET', 'https://api.withai.co/v1/integrations?status=connected'],
    ]);

    for (const request of captured) {
      expect(new Headers(request.init?.headers).get('Authorization')).toBe('Bearer withai-key');
    }

    expect(captured[2].body).toEqual({ ticker: 'MSFT', prompt: 'update model' });
    expect(captured[4].body).toEqual({ search_text: 'channel checks', filters: { ticker: 'MSFT' } });
  });

  test('supports raw requests', async () => {
    await api.rawRequest({
      path: '/custom/command-center',
      method: 'POST',
      body: { enabled: true },
    });

    expect(captured[0].url).toBe('https://api.withai.co/v1/custom/command-center');
    expect(captured[0].init?.method).toBe('POST');
    expect(captured[0].body).toEqual({ enabled: true });
  });

  test('fromEnv requires WITHAI_API_KEY', () => {
    const orig = process.env.WITHAI_API_KEY;
    delete process.env.WITHAI_API_KEY;
    expect(() => WithAi.fromEnv()).toThrow('WITHAI_API_KEY environment variable is required');
    if (orig) process.env.WITHAI_API_KEY = orig;
  });
});
