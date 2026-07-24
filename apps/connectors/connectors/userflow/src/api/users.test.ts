import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { UserflowClient } from './client';
import { UsersApi } from './users';

describe('UsersApi', () => {
  let originalFetch: typeof global.fetch;
  let captured: Array<{ url: string; method: string; body?: string; headers: Record<string, string> }>;

  beforeEach(() => {
    originalFetch = global.fetch;
    captured = [];
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      captured.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
        headers,
      });
      return Response.json({ ok: true });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const api = new UsersApi(new UserflowClient({ apiKey: 'uf-key' }));

  test('upsertUser POSTs to /v2/users with encoded body', async () => {
    await api.upsertUser({
      id: 'user/1',
      attributes: { plan: 'pro' },
      group_id: 'group/1',
      replace_attributes: true,
    });

    const req = captured[0]!;
    expect(req.url).toBe('https://api.userflow.com/v2/users');
    expect(req.method).toBe('POST');
    expect(JSON.parse(req.body!)).toEqual({
      id: 'user/1',
      attributes: { plan: 'pro' },
      group_id: 'group/1',
      replace_attributes: true,
    });
  });

  test('getUser encodes slash in ID', async () => {
    await api.getUser('user/1');
    const req = captured[0]!;
    expect(req.url).toBe('https://api.userflow.com/v2/users/user%2F1');
    expect(req.method).toBe('GET');
  });

  test('deleteUser DELETEs encoded path', async () => {
    await api.deleteUser('user/1');
    const req = captured[0]!;
    expect(req.method).toBe('DELETE');
    expect(req.url).toContain('/v2/users/user%2F1');
  });

  test('addUserToGroup POSTs membership payload', async () => {
    await api.addUserToGroup({
      user_id: 'user/1',
      group_id: 'group/1',
      attributes: { role: 'admin' },
    });

    const req = captured[0]!;
    expect(req.url).toBe('https://api.userflow.com/v2/users/user%2F1/group');
    expect(JSON.parse(req.body!)).toEqual({
      group_id: 'group/1',
      attributes: { role: 'admin' },
    });
  });

  test('listUsers forwards pagination and search', async () => {
    await api.listUsers({
      limit: 25,
      starting_after: 'cursor-a',
      ending_before: 'cursor-b',
      q: 'ada',
    });

    const req = captured[0]!;
    const url = new URL(req.url);
    expect(url.pathname).toBe('/v2/users');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('starting_after')).toBe('cursor-a');
    expect(url.searchParams.get('ending_before')).toBe('cursor-b');
    expect(url.searchParams.get('q')).toBe('ada');
  });
});
