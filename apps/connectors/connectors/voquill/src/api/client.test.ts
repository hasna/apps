import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Connector } from './index';

const API_KEY = 'voquill-key';
const BASE_URL = 'https://api.voquill.com/v1';

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

describe('Voquill API client', () => {
  const originalFetch = globalThis.fetch;
  let captured: CapturedRequest[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    captured = [];
  });

  function installMockFetch() {
    captured = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      captured.push({
        url,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: jsonBody(init),
      });
      return Response.json({ ok: true, connector: 'voquill' });
    }) as unknown as typeof fetch;
  }

  function client(): Connector {
    return new Connector({ apiKey: API_KEY, baseUrl: BASE_URL });
  }

  test('requires API key', () => {
    expect(() => new Connector({})).toThrow(/API key/i);
  });

  test('uses bearer credentials for pathology workflow endpoints', async () => {
    installMockFetch();
    const api = client();

    await api.cases.list({ status: 'open' });
    await api.cases.get('case 1');
    await api.cases.create({ accessionNumber: 'A-1001' });
    await api.reports.createDraft('case 1', { transcript: 'Final diagnosis pending' });
    await api.reports.get('report 1');
    await api.reports.suggestCptCodes('case 1', { findings: 'skin biopsy' });
    await api.templates.list();
    await api.templates.get('template 1');
    await api.snippets.list();
    await api.snippets.upsert({ label: 'normal skin', content: 'No significant abnormality' });

    expect(captured.map((request) => [request.method, request.url])).toEqual([
      ['GET', `${BASE_URL}/cases?status=open`],
      ['GET', `${BASE_URL}/cases/case%201`],
      ['POST', `${BASE_URL}/cases`],
      ['POST', `${BASE_URL}/cases/case%201/reports`],
      ['GET', `${BASE_URL}/reports/report%201`],
      ['POST', `${BASE_URL}/cases/case%201/cpt-suggestions`],
      ['GET', `${BASE_URL}/templates`],
      ['GET', `${BASE_URL}/templates/template%201`],
      ['GET', `${BASE_URL}/snippets`],
      ['POST', `${BASE_URL}/snippets`],
    ]);

    for (const request of captured) {
      expect(request.headers.get('Authorization')).toBe(`Bearer ${API_KEY}`);
    }

    expect(captured[2].body).toEqual({ accessionNumber: 'A-1001' });
    expect(captured[3].body).toEqual({ transcript: 'Final diagnosis pending' });
    expect(captured[5].body).toEqual({ findings: 'skin biopsy' });
    expect(captured[9].body).toEqual({ label: 'normal skin', content: 'No significant abnormality' });
  });

  test('upsert snippet uses PATCH when snippetId is provided', async () => {
    installMockFetch();
    const api = client();

    await api.snippets.upsert({
      snippetId: 'snippet 1',
      label: 'updated',
      content: 'Updated content',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('PATCH');
    expect(captured[0].url).toBe(`${BASE_URL}/snippets/snippet%201`);
    expect(captured[0].body).toEqual({ label: 'updated', content: 'Updated content' });
  });

  test('supports raw requests', async () => {
    installMockFetch();
    const api = client();

    await api.rawRequest({
      path: '/custom/labs',
      method: 'POST',
      body: { enabled: true },
    });

    expect(captured[0].url).toBe(`${BASE_URL}/custom/labs`);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].body).toEqual({ enabled: true });
    expect(captured[0].headers.get('Authorization')).toBe(`Bearer ${API_KEY}`);
  });
});
