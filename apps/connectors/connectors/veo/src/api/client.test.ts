import { afterEach, describe, expect, test } from 'bun:test';
import { Veo, encodePathSegment } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : (init.headers as Record<string, string>);
      Object.assign(headers, raw);
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init, recorded);
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

describe('VeoClient', () => {
  test('encodePathSegment encodes special characters', () => {
    expect(encodePathSegment('video/id with spaces')).toBe('video%2Fid%20with%20spaces');
  });

  test('requires API key', () => {
    expect(() => new Veo({ apiKey: '' })).toThrow('API key is required');
  });

  test('listVideos calls /videos/v3/get-all with Bearer auth', async () => {
    const recorded = installFetch((url, init) => {
      expect(url).toContain('/videos/v3/get-all');
      expect(init?.method).toBe('GET');
      return { items: [] };
    });
    const veo = new Veo({ apiKey: 'test-token' });
    await veo.videos.list({ page: 1 });
    expect(recorded[0].headers.Authorization).toBe('Bearer test-token');
    expect(recorded[0].url).toContain('page=1');
  });

  test('getVideo encodes video id in path', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/videos/video%2F123');
      return { id: 'video/123' };
    });
    const veo = new Veo({ apiKey: 'test-token' });
    await veo.videos.get('video/123');
    expect(recorded.length).toBe(1);
  });

  test('getTranscript hits /videos/{id}/transcript', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/videos/abc/transcript');
      return { text: 'hello' };
    });
    const veo = new Veo({ apiKey: 'test-token' });
    const transcript = await veo.videos.getTranscript('abc');
    expect(transcript.text).toBe('hello');
    expect(recorded.length).toBe(1);
  });

  test('listUsers calls /users', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/users');
      return { users: [] };
    });
    const veo = new Veo({ apiKey: 'test-token' });
    await veo.users.list();
    expect(recorded[0].url).toMatch(/\/users$/);
  });

  test('listGroups calls /groups', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/groups');
      return { groups: [] };
    });
    const veo = new Veo({ apiKey: 'test-token' });
    await veo.groups.list();
    expect(recorded[0].url).toMatch(/\/groups$/);
  });

  test('rawRequest supports POST with body', async () => {
    const recorded = installFetch((url, init) => {
      expect(url).toContain('/custom');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ foo: 'bar' }));
      return { ok: true };
    });
    const veo = new Veo({ apiKey: 'test-token' });
    await veo.rawRequest({ method: 'POST', path: '/custom', body: { foo: 'bar' } });
    expect(recorded.length).toBe(1);
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch((url) => {
      expect(url.startsWith('https://custom.example/api/users')).toBe(true);
      return {};
    });
    const veo = new Veo({ apiKey: 'test-token', baseUrl: 'https://custom.example/api' });
    await veo.users.list();
    expect(recorded.length).toBe(1);
  });
});
