import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Wato } from './index';

const originalFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: unknown;
}

function jsonBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') return undefined;
  return JSON.parse(init.body);
}

function installFetchMock() {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: jsonBody(init),
    });
    return Response.json({ ok: true, connector: 'wato' });
  }) as unknown as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Wato API client', () => {
  test('requires apiKey', () => {
    expect(() => new Wato({ apiKey: '' })).toThrow('Wato apiKey is required');
  });

  test('uses bearer credentials for shared agent endpoints', async () => {
    const captured = installFetchMock();
    const wato = new Wato({ apiKey: 'wato-key' });

    await wato.listMemories({ scope: 'team' });
    await wato.upsertMemory({ title: 'pricing policy', content: 'approved by finance' });
    await wato.getMemory('mem 1');
    await wato.listWorkflows({ status: 'active' });
    await wato.runWorkflow('wf 1', { input: { account: 'acme' } });
    await wato.listTools({ connected: true });
    await wato.getArtifact('artifact 1');

    expect(captured.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.watolabs.com/v1/memories?scope=team'],
      ['POST', 'https://api.watolabs.com/v1/memories'],
      ['GET', 'https://api.watolabs.com/v1/memories/mem%201'],
      ['GET', 'https://api.watolabs.com/v1/workflows?status=active'],
      ['POST', 'https://api.watolabs.com/v1/workflows/wf%201/runs'],
      ['GET', 'https://api.watolabs.com/v1/tools?connected=true'],
      ['GET', 'https://api.watolabs.com/v1/artifacts/artifact%201'],
    ]);

    for (const request of captured) {
      expect(request.headers.get('Authorization')).toBe('Bearer wato-key');
    }

    expect(captured[1].body).toEqual({ title: 'pricing policy', content: 'approved by finance' });
    expect(captured[4].body).toEqual({ input: { account: 'acme' } });
  });

  test('supports configurable base URL', async () => {
    const captured = installFetchMock();
    const wato = new Wato({ apiKey: 'wato-key', baseUrl: 'https://custom.example/v1/' });
    await wato.listMemories();
    expect(captured[0].url).toBe('https://custom.example/v1/memories');
  });

  test('supports raw requests', async () => {
    const captured = installFetchMock();
    const wato = new Wato({ apiKey: 'wato-key' });

    await wato.rawRequest('/custom/agents', {
      method: 'POST',
      body: { enabled: true },
    });

    expect(captured[0].url).toBe('https://api.watolabs.com/v1/custom/agents');
    expect(captured[0].method).toBe('POST');
    expect(captured[0].body).toEqual({ enabled: true });
  });
});
