import { describe, test, expect, mock } from 'bun:test';
import { TenableClient } from './client';
import { Tenable } from './index';
import { TenableApiError } from '../types';

describe('TenableClient', () => {
  test('requires accessKey and secretKey', () => {
    expect(() => new TenableClient({ accessKey: '', secretKey: 'x' })).toThrow(
      'Tenable accessKey and secretKey are required',
    );
    expect(() => new TenableClient({ accessKey: 'x', secretKey: '' })).toThrow(
      'Tenable accessKey and secretKey are required',
    );
  });

  test('builds URLs against the default base and appends params', () => {
    const client = new TenableClient({ accessKey: 'a', secretKey: 'b' });
    expect(client.buildUrl('/scans')).toBe('https://cloud.tenable.com/scans');
    expect(client.buildUrl('/workbenches/assets', { date_range: 30 })).toBe(
      'https://cloud.tenable.com/workbenches/assets?date_range=30',
    );
  });

  test('honours a custom base URL and trims a trailing slash', () => {
    const client = new TenableClient({
      accessKey: 'a',
      secretKey: 'b',
      baseUrl: 'https://cloud.tenable.eu/',
    });
    expect(client.buildUrl('/session')).toBe('https://cloud.tenable.eu/session');
  });

  test('sends the X-ApiKeys header on requests', async () => {
    const client = new TenableClient({ accessKey: 'aaa', secretKey: 'bbb' });
    const originalFetch = globalThis.fetch;
    let sentHeader: string | undefined;
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      sentHeader = (init.headers as Record<string, string>)['X-ApiKeys'];
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }) as unknown as typeof fetch;

    await client.request('/session');
    expect(sentHeader).toBe('accessKey=aaa;secretKey=bbb');

    globalThis.fetch = originalFetch;
  });

  test('throws TenableApiError on a non-2xx response', async () => {
    const client = new TenableClient({ accessKey: 'a', secretKey: 'b' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Invalid Credentials' }), { status: 401 })),
    ) as unknown as typeof fetch;

    const promise = client.request('/session');
    await expect(promise).rejects.toBeInstanceOf(TenableApiError);
    await expect(promise).rejects.toThrow('Invalid Credentials');

    globalThis.fetch = originalFetch;
  });
});

describe('Tenable', () => {
  test('fromEnv throws without credentials', () => {
    const origAccess = process.env.TENABLE_ACCESS_KEY;
    const origSecret = process.env.TENABLE_SECRET_KEY;
    delete process.env.TENABLE_ACCESS_KEY;
    delete process.env.TENABLE_SECRET_KEY;

    expect(() => Tenable.fromEnv()).toThrow('TENABLE_ACCESS_KEY and TENABLE_SECRET_KEY are required');

    if (origAccess) process.env.TENABLE_ACCESS_KEY = origAccess;
    if (origSecret) process.env.TENABLE_SECRET_KEY = origSecret;
  });

  test('fromEnv builds a client from env vars', async () => {
    const origAccess = process.env.TENABLE_ACCESS_KEY;
    const origSecret = process.env.TENABLE_SECRET_KEY;
    const originalFetch = globalThis.fetch;
    process.env.TENABLE_ACCESS_KEY = 'env-access';
    process.env.TENABLE_SECRET_KEY = 'env-secret';
    let sentHeader: string | undefined;
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      sentHeader = (init.headers as Record<string, string>)['X-ApiKeys'];
      return Promise.resolve(new Response(JSON.stringify({ user: { username: 'test' } }), { status: 200 }));
    }) as unknown as typeof fetch;

    const tenable = Tenable.fromEnv();
    await tenable.getSession();
    expect(sentHeader).toBe('accessKey=env-access;secretKey=env-secret');

    globalThis.fetch = originalFetch;
    if (origAccess) process.env.TENABLE_ACCESS_KEY = origAccess;
    else delete process.env.TENABLE_ACCESS_KEY;
    if (origSecret) process.env.TENABLE_SECRET_KEY = origSecret;
    else delete process.env.TENABLE_SECRET_KEY;
  });

  test('listScans issues a GET /scans request', async () => {
    const tenable = new Tenable({ accessKey: 'a', secretKey: 'b' });
    const originalFetch = globalThis.fetch;
    let calledUrl = '';
    let calledMethod = '';
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      calledUrl = url;
      calledMethod = init.method || 'GET';
      return Promise.resolve(new Response(JSON.stringify({ scans: [] }), { status: 200 }));
    }) as unknown as typeof fetch;

    const result = await tenable.listScans();
    expect(calledUrl).toBe('https://cloud.tenable.com/scans');
    expect(calledMethod).toBe('GET');
    expect(result.scans).toEqual([]);

    globalThis.fetch = originalFetch;
  });
});
