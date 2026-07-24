import { afterEach, describe, expect, test } from 'bun:test';
import { VisiblSemiconductors } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    let body: unknown;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ ok: true, connector: 'visibl-semiconductors' });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('VisiblSemiconductors API client', () => {
  test('requires API key', () => {
    expect(() => new VisiblSemiconductors({ apiKey: '' })).toThrow(/API key is required/);
  });

  test('uses bearer credentials for chip design workflow endpoints', async () => {
    const recorded = installFetch();
    const client = new VisiblSemiconductors({ apiKey: 'visibl-key' });

    await client.listProjects({ status: 'active' });
    await client.getProject('proj 1');
    await client.listDriftCases({ severity: 'high' });
    await client.getDriftCase('case 1');
    await client.listFixProposals('case 1');
    await client.approveFixProposal('prop 1', { reviewer: 'alice' });
    await client.syncDesignContext('proj 1', { source: 'rtl' });
    await client.listCiSignals({ failing: true });
    await client.getTapeoutReadiness('proj 1');

    expect(recorded.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.visiblsemi.com/v1/projects?status=active'],
      ['GET', 'https://api.visiblsemi.com/v1/projects/proj%201'],
      ['GET', 'https://api.visiblsemi.com/v1/drift-cases?severity=high'],
      ['GET', 'https://api.visiblsemi.com/v1/drift-cases/case%201'],
      ['GET', 'https://api.visiblsemi.com/v1/drift-cases/case%201/proposals'],
      ['POST', 'https://api.visiblsemi.com/v1/proposals/prop%201/approve'],
      ['POST', 'https://api.visiblsemi.com/v1/projects/proj%201/design-context/sync'],
      ['GET', 'https://api.visiblsemi.com/v1/ci-signals?failing=true'],
      ['GET', 'https://api.visiblsemi.com/v1/projects/proj%201/tapeout-readiness'],
    ]);

    for (const request of recorded) {
      const auth = request.headers.Authorization ?? request.headers.authorization;
      expect(auth).toBe('Bearer visibl-key');
    }

    expect(recorded[5].body).toEqual({ reviewer: 'alice' });
    expect(recorded[6].body).toEqual({ source: 'rtl' });
  });

  test('supports raw requests with custom base URL', async () => {
    const recorded = installFetch();
    const client = new VisiblSemiconductors({
      apiKey: 'visibl-key',
      baseUrl: 'https://api.visiblsemi.com/v1',
    });

    await client.rawRequest({
      path: '/custom/agents',
      method: 'POST',
      body: { enabled: true },
    });

    expect(recorded[0].url).toBe('https://api.visiblsemi.com/v1/custom/agents');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toEqual({ enabled: true });
  });
});
