import { afterEach, describe, expect, test } from 'bun:test';
import { Userlens } from './index';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    captured.push({ url, method: init?.method ?? 'GET', headers, body });
    return Response.json({ ok: true });
  }) as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('UserlensClient', () => {
  test('uses HTTP Basic auth and documented Userlens event endpoints', async () => {
    const captured = installFetch();
    const expectedAuth = `Basic ${Buffer.from('userlens-key:').toString('base64')}`;
    const client = new Userlens({ apiKey: 'userlens-key' });

    await client.identifyUser('user 1', { email: 'a@x.com', plan: 'pro' });
    await client.groupUser('acct 1', 'user 1', { name: 'Acme' });
    await client.trackEvent('user 1', 'Feature Used', { feature: 'export' });
    await client.forwardRawEvents([
      { event: '$ul_pageview', userId: 'user 1', properties: { $ul_page: '/dash' } },
    ]);

    expect(captured.map((request) => [request.method, request.url])).toEqual([
      ['POST', 'https://events.userlens.io/event'],
      ['POST', 'https://events.userlens.io/event'],
      ['POST', 'https://events.userlens.io/event'],
      ['POST', 'https://raw.userlens.io/raw/event'],
    ]);

    for (const request of captured) {
      expect(request.headers.authorization).toBe(expectedAuth);
    }

    expect(captured[0].body).toEqual({
      type: 'identify',
      userId: 'user 1',
      source: 'userlens-restapi',
      traits: { email: 'a@x.com', plan: 'pro' },
    });
    expect(captured[1].body).toEqual({
      type: 'group',
      groupId: 'acct 1',
      userId: 'user 1',
      source: 'userlens-restapi',
      traits: { name: 'Acme' },
    });
    expect(captured[2].body).toEqual({
      type: 'track',
      userId: 'user 1',
      source: 'userlens-restapi',
      event: 'Feature Used',
      properties: { feature: 'export' },
    });
  });

  test('supports raw requests and rejects missing api_key before fetch', async () => {
    const captured = installFetch();
    const client = new Userlens({ apiKey: 'userlens-key' });

    await client.rawRequest({
      path: '/event',
      method: 'POST',
      body: { type: 'track', userId: 'user 1', event: 'Ping' },
    });
    expect(captured[0].url).toBe('https://events.userlens.io/event');

    await client.rawRequest({
      path: '/raw/event',
      method: 'POST',
      useRawBase: true,
      body: { events: [] },
    });
    expect(captured[1].url).toBe('https://raw.userlens.io/raw/event');

    const missingKey = new Userlens({});
    await expect(missingKey.identifyUser('user 1', {})).rejects.toThrow(/missing api_key credential/i);
    expect(captured).toHaveLength(2);
  });
});
