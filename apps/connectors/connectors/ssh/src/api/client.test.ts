import { afterEach, describe, expect, test } from 'bun:test';
import { Ssh } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) headers[key] = value;
    } else if (rawHeaders) {
      Object.assign(headers, rawHeaders);
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async json() {
        return json ?? {};
      },
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

describe('Ssh REST client', () => {
  test('listSessions sends Bearer auth to /sessions', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://api.ssh.com/v1/sessions');
      return { sessions: [{ id: 'sess-1' }] };
    });
    const ssh = new Ssh({ apiKey: 'test-key' });
    const result = await ssh.listSessions();
    expect(result.sessions?.[0]?.id).toBe('sess-1');
    expect(recorded[0].headers.Authorization).toBe('Bearer test-key');
    expect(recorded[0].method).toBe('GET');
  });

  test('getSession requests encoded session path', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://api.ssh.com/v1/sessions/sess%2F42');
      return { id: 'sess/42', status: 'active' };
    });
    const ssh = new Ssh({ apiKey: 'test-key' });
    const session = await ssh.getSession('sess/42');
    expect(session.id).toBe('sess/42');
    expect(recorded[0].url).toContain('/sessions/sess%2F42');
    expect(recorded[0].headers.Authorization).toBe('Bearer test-key');
  });

  test('uses custom base URL when configured', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://custom.example/v1/events');
      return { events: [] };
    });
    const ssh = new Ssh({ apiKey: 'k', baseUrl: 'https://custom.example/v1' });
    await ssh.listEvents();
    expect(recorded[0].url).toBe('https://custom.example/v1/events');
  });

  test('requires api key', () => {
    expect(() => new Ssh({ apiKey: '' })).toThrow('SSH API key is required');
  });
});
