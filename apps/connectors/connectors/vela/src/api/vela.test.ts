import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Vela } from './index';

const originalFetch = globalThis.fetch;

type CapturedRequest = {
  url: string;
  init?: RequestInit;
  body?: unknown;
};

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') return undefined;
  return JSON.parse(init.body);
}

describe('Vela API', () => {
  let captured: CapturedRequest[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    captured = [];
  });

  function setupFetchMock(): void {
    captured = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: urlOf(input), init, body: jsonBody(init) });
      return Response.json({ ok: true, connector: 'vela' });
    }) as unknown as typeof fetch;
  }

  test('uses bearer credentials for scheduling workflow endpoints', async () => {
    setupFetchMock();
    const vela = new Vela({ apiKey: 'vela-key' });

    await vela.schedulingRequests.list({ status: 'pending' });
    await vela.schedulingRequests.get('req 1');
    await vela.schedulingRequests.create({ subject: 'Interview', participants: ['a@x.com'] });
    await vela.meetings.list({ upcoming: true });
    await vela.meetings.get('meet 1');
    await vela.meetings.cancel('meet 1', { reason: 'conflict' });
    await vela.meetings.reschedule('meet 1', { startAt: '2026-05-23T15:00:00Z' });
    await vela.contacts.list({ vip: true });
    await vela.calendar.sync({ provider: 'google' });

    expect(captured.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', 'https://api.tryvela.ai/v1/scheduling-requests?status=pending'],
      ['GET', 'https://api.tryvela.ai/v1/scheduling-requests/req%201'],
      ['POST', 'https://api.tryvela.ai/v1/scheduling-requests'],
      ['GET', 'https://api.tryvela.ai/v1/meetings?upcoming=true'],
      ['GET', 'https://api.tryvela.ai/v1/meetings/meet%201'],
      ['POST', 'https://api.tryvela.ai/v1/meetings/meet%201/cancel'],
      ['POST', 'https://api.tryvela.ai/v1/meetings/meet%201/reschedule'],
      ['GET', 'https://api.tryvela.ai/v1/contacts?vip=true'],
      ['POST', 'https://api.tryvela.ai/v1/calendar/sync'],
    ]);

    for (const request of captured) {
      expect(new Headers(request.init?.headers).get('Authorization')).toBe('Bearer vela-key');
    }

    expect(captured[2].body).toEqual({ subject: 'Interview', participants: ['a@x.com'] });
    expect(captured[5].body).toEqual({ reason: 'conflict' });
    expect(captured[6].body).toEqual({ startAt: '2026-05-23T15:00:00Z' });
    expect(captured[8].body).toEqual({ provider: 'google' });
  });

  test('supports raw requests with custom base URL', async () => {
    setupFetchMock();
    const vela = new Vela({
      apiKey: 'vela-key',
      baseUrl: 'https://custom.example/v2',
    });

    await vela.rawRequest({
      path: '/custom/agents',
      method: 'POST',
      body: { enabled: true },
    });

    expect(captured[0].url).toBe('https://custom.example/v2/custom/agents');
    expect(captured[0].init?.method).toBe('POST');
    expect(captured[0].body).toEqual({ enabled: true });
  });

  test('rejects missing API key at construction', () => {
    expect(() => new Vela({})).toThrow(/API key is required/i);
  });
});
