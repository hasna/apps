import { afterEach, describe, expect, test } from 'bun:test';
import { Wayco, WaycoClient } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(handler: (recorded: Recorded) => unknown): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
    };
    recorded.push(entry);
    const json = handler(entry);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? { ok: true });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('WaycoClient', () => {
  test('requires api key', () => {
    expect(() => new WaycoClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('uses default base URL', () => {
    expect(WaycoClient.getDefaultBaseUrl()).toBe('https://api.wayco.ai/v1');
  });
});

describe('Wayco med-legal workflow endpoints', () => {
  const apiKey = 'wayco-key';
  const wayco = new Wayco({ apiKey });

  test('calls expected URLs with bearer auth and encoded path segments', async () => {
    const recorded = installFetch(() => ({ ok: true, connector: 'wayco' }));

    await wayco.listCases({ status: 'intake' });
    await wayco.getCase('case 1');
    await wayco.createLead({ caller_name: 'Jane Doe', injury_type: 'PI' });
    await wayco.qualifyLead('lead 1', { source: 'voice' });
    await wayco.summarizeMedicalRecords('case 1', { document_ids: ['doc 1'] });
    await wayco.matchProviders('case 1', { specialty: 'orthopedics', zip: '10016' });
    await wayco.getVoiceCall('call 1');

    expect(recorded.map((r) => [r.method, r.url])).toEqual([
      ['GET', 'https://api.wayco.ai/v1/cases?status=intake'],
      ['GET', 'https://api.wayco.ai/v1/cases/case%201'],
      ['POST', 'https://api.wayco.ai/v1/leads'],
      ['POST', 'https://api.wayco.ai/v1/leads/lead%201/qualify'],
      ['POST', 'https://api.wayco.ai/v1/cases/case%201/medical-records/summary'],
      ['POST', 'https://api.wayco.ai/v1/cases/case%201/provider-matches'],
      ['GET', 'https://api.wayco.ai/v1/voice-calls/call%201'],
    ]);

    for (const request of recorded) {
      expect(request.headers.authorization ?? request.headers.Authorization).toBe('Bearer wayco-key');
    }

    expect(JSON.parse(recorded[2].body as string)).toEqual({ caller_name: 'Jane Doe', injury_type: 'PI' });
    expect(JSON.parse(recorded[4].body as string)).toEqual({ document_ids: ['doc 1'] });
    expect(JSON.parse(recorded[5].body as string)).toEqual({ specialty: 'orthopedics', zip: '10016' });
  });

  test('rawRequest supports custom paths and methods', async () => {
    const recorded = installFetch(() => ({ enabled: true }));

    await wayco.rawRequest({
      path: '/custom/intake',
      method: 'POST',
      body: { enabled: true },
    });

    expect(recorded[0].url).toBe('https://api.wayco.ai/v1/custom/intake');
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body as string)).toEqual({ enabled: true });
    expect(recorded[0].headers.authorization ?? recorded[0].headers.Authorization).toBe('Bearer wayco-key');
  });
});
