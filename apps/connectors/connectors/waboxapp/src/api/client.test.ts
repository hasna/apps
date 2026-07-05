import { afterEach, describe, expect, test } from 'bun:test';
import { Waboxapp, WaboxappClient } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    const json = handler(url, init);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
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

describe('WaboxappClient transport', () => {
  test('getStatus uses GET with token query param', async () => {
    const recorded = installFetch(() => ({ success: true, uid: '34666123456' }));
    const client = new WaboxappClient({ token: 'my_token', uid: '34666123456' });
    const result = await client.get('/status/34666123456');
    expect(result).toEqual({ success: true, uid: '34666123456' });
    expect(recorded[0]?.url).toBe('https://www.waboxapp.com/api/status/34666123456?token=my_token');
    expect(recorded[0]?.method).toBe('GET');
  });

  test('post send/chat uses form body with token and uid', async () => {
    const recorded = installFetch(() => ({ success: true, custom_uid: 'msg-1' }));
    const client = new WaboxappClient({ token: 'my_token', uid: '34666123456' });
    await client.post('/send/chat', {
      to: '34666789123',
      custom_uid: 'msg-1',
      text: 'Hello',
    });
    expect(recorded[0]?.url).toBe('https://www.waboxapp.com/api/send/chat');
    expect(recorded[0]?.method).toBe('POST');
    const body = new URLSearchParams(recorded[0]?.body ?? '');
    expect(body.get('token')).toBe('my_token');
    expect(body.get('uid')).toBe('34666123456');
    expect(body.get('to')).toBe('34666789123');
    expect(body.get('custom_uid')).toBe('msg-1');
    expect(body.get('text')).toBe('Hello');
  });

  test('requires token and uid', () => {
    expect(() => new WaboxappClient({ token: '', uid: '1' })).toThrow('token');
    expect(() => new WaboxappClient({ token: 't', uid: '' })).toThrow('uid');
  });

  test('Waboxapp.status.getStatus delegates to client', async () => {
    installFetch(() => ({ success: true, uid: '34666123456', platform: 'android' }));
    const api = new Waboxapp({ token: 'my_token', uid: '34666123456' });
    const status = await api.status.getStatus();
    expect(status.platform).toBe('android');
  });
});
