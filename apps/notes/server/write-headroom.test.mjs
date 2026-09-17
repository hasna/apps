import { describe, expect, test, spyOn } from 'bun:test';
import { createApp, resolveConfig } from './app.mjs';
import { openDb } from './db.mjs';

async function fixture(env = {}) {
  const db = openDb(':memory:');
  const config = { ...resolveConfig(env, []), devMode: true, log: () => {} };
  const app = await createApp({ db, config, testOnlySqlite: true });
  const call = (method, path, body, token) => app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { ip: '127.0.0.1' });
  const email = 'headroom-fixture@example.com';
  const pending = await (await call('POST', '/v1/auth/login', { email })).json();
  const verified = await call('POST', '/v1/auth/verify', { email, code: pending.devCode, requestId: pending.requestId });
  expect(verified.status).toBe(200);
  const { token } = await verified.json();
  return { db, call, token };
}

describe('authenticated note write budget', () => {
  test('allows a normal edit burst beyond the former 300/hour shared budget', async () => {
    const { db, call, token } = await fixture();
    try {
      expect((await call('POST', '/v1/notes', { title: 'denied' })).status).toBe(401);
      const created = await call('POST', '/v1/notes', { title: 'owned fixture', body: 'small fixture' }, token);
      expect(created.status).toBe(201);
      const payload = await created.json();
      const id = payload.id;
      expect(typeof id).toBe('string');
      const statuses = [];
      for (let i = 0; i < 310; i++) {
        const response = await call('PATCH', `/v1/notes/${id}`, { title: `edit ${i}` }, token);
        statuses.push(response.status);
        await response.arrayBuffer();
      }
      expect(statuses.filter((status) => status !== 200)).toEqual([]);
    } finally { db.close(); }
  });

  test('enforces an explicit shared create/update minute budget without blocking reads or relaxing OTP', async () => {
    const { db, call, token } = await fixture({ HASNA_NOTES_SERVER_NOTE_WRITE_RATE_LIMIT_MAX: '2' });
    let clock;
    try {
      const created = await call('POST', '/v1/notes', { title: 'owned fixture' }, token);
      expect(created.status).toBe(201);
      const payload = await created.json();
      const id = payload.id;
      expect((await call('PATCH', `/v1/notes/${id}`, { title: 'edit' }, token)).status).toBe(200);
      const blocked = await call('POST', '/v1/notes', { title: 'over budget' }, token);
      expect(blocked.status).toBe(429);
      expect((await blocked.json()).error.code).toBe('rate_limited');
      expect((await call('GET', `/v1/notes/${id}`, undefined, token)).status).toBe(200);
      for (let i = 0; i < 4; i++) expect((await call('POST', '/v1/auth/login', { email: 'headroom-fixture@example.com' })).status).toBe(200);
      expect((await call('POST', '/v1/auth/login', { email: 'headroom-fixture@example.com' })).status).toBe(429);
      const nextMinute = Date.now() + 60_001;
      clock = spyOn(Date, 'now').mockReturnValue(nextMinute);
      expect((await call('PATCH', `/v1/notes/${id}`, { title: 'next minute' }, token)).status).toBe(200);
      expect((await call('POST', '/v1/auth/login', { email: 'headroom-fixture@example.com' })).status).toBe(429);
    } finally { clock?.mockRestore(); db.close(); }
  });

  test('refuses invalid write budgets during configuration resolution', () => {
    expect(() => resolveConfig({ HASNA_NOTES_SERVER_NOTE_WRITE_RATE_LIMIT_MAX: 'NaN' }, [])).toThrow('HASNA_NOTES_SERVER_NOTE_WRITE_RATE_LIMIT_MAX');
  });
});
