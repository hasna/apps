// Real pinned Contracts verifier + in-memory PostgreSQL; no listener or service.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { ApiKeyStore, mintApiKey } from '@hasna/contracts/auth';
import { MigrationLedger } from '../src/generated/storage-kit/index.js';
import { notesPgMigrations } from '../server/pg-migrations.ts';
import { wrapPgExecutor } from '../server/pg-adapter.mjs';
import { createApp } from '../server/app.mjs';

describe('PostgreSQL API-key tenant boundary', () => {
  const signingSecret = randomBytes(32);
  const calls = [];
  let pg, app, store, a, b, absent, noteId;

  async function mint(tid, registered = true) {
    const key = mintApiKey({ app: 'notes', scopes: ['*'], signingSecret, ...(tid === undefined ? {} : { tid }) });
    if (registered) await store.insertMinted(key);
    return key;
  }

  // Only synthetic keys are re-signed, using this fixture's private bytes.
  function signClaims(claims) {
    const input = `hasna_notes_${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    return `${input}.${createHmac('sha256', signingSecret).update(input).digest('base64url')}`;
  }

  async function request(token, method, path, body) {
    calls.length = 0;
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { ip: '127.0.0.1' });
    return { status: res.status, json: await res.json() };
  }

  beforeAll(async () => {
    pg = new PGlite({ extensions: { pgcrypto } });
    const query = async (sql, params = []) => {
      calls.push({ sql, params });
      return pg.query(sql, params);
    };
    const client = {
      query,
      async get(sql, params = []) { return (await query(sql, params)).rows[0] ?? null; },
      async many(sql, params = []) { return (await query(sql, params)).rows; },
      async execute(sql, params = []) {
        if (params.length) return query(sql, params);
        calls.push({ sql, params });
        return pg.exec(sql);
      },
    };
    await new MigrationLedger(client, notesPgMigrations()).migrate();
    app = await createApp({
      db: wrapPgExecutor(client),
      config: { signingSecret, jwtSecret: randomBytes(32).toString('hex'), env: {}, log: () => {} },
    });
    for (const tid of ['tenant-a', 'tenant-b']) {
      await pg.query('INSERT INTO tenants (id, name, slug, created_at) VALUES ($1, $1, $1, $2)', [tid, new Date().toISOString()]);
    }
    store = new ApiKeyStore(client);
    a = await mint('tenant-a');
    b = await mint('tenant-b');
    absent = await mint(undefined);
    const created = await request(a.token, 'POST', '/v1/notes', { title: 'Only tenant A' });
    expect(created.status).toBe(201);
    noteId = created.json.id;
  });

  afterAll(async () => {
    try { await pg?.close(); } finally { signingSecret.fill(0); }
  });

  const protectedRoutes = [
    ['list', 'GET', () => '/v1/notes'],
    ['get', 'GET', () => `/v1/notes/${noteId}`],
    ['create', 'POST', () => '/v1/notes', { title: 'Must not be stored' }],
    ['update', 'PATCH', () => `/v1/notes/${noteId}`, { title: 'Must not change' }],
    ['delete', 'DELETE', () => `/v1/notes/${noteId}`],
    ['export', 'POST', () => '/v1/export'],
    ['whoami', 'GET', () => '/v1/auth/whoami'],
    ['key-list', 'GET', () => '/v1/api-keys'],
    ['key-mint', 'POST', () => '/v1/api-keys', {}],
    ['logout', 'POST', () => '/v1/auth/logout'],
    ['device-approve', 'POST', () => '/v1/auth/device/approve', {}],
  ];

  for (const [name, method, path, body] of protectedRoutes) {
    test(`authentic missing tid rejects ${name} before any SQL or last-used mutation`, async () => {
      const res = await request(absent.token, method, path(), body);
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ error: {
        code: 'forbidden', message: "Token carries no tenant id ('tid') and this service requires one.",
      } });
      expect(calls).toEqual([]);
      const row = (await pg.query('SELECT last_used_at FROM api_keys WHERE kid = $1', [absent.kid])).rows[0];
      expect(row.last_used_at).toBeNull();
    });
  }

  test('malformed and tampered tenants remain unauthenticated before SQL', async () => {
    const tampered = signClaims({ ...a.claims, tid: 'tenant-b' }).split('.')[0] + '.' + a.token.split('.')[1];
    for (const token of [signClaims({ ...a.claims, tid: null }), signClaims({ ...a.claims, tid: 'bad/tenant' }), tampered]) {
      const res = await request(token, 'GET', '/v1/notes');
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe('unauthorized');
      expect(calls).toEqual([]);
    }
  });

  test('keyStatus still rejects unknown, revoked, and ledger-expired keys before domain access', async () => {
    const unknown = await mint('tenant-a', false);
    const revoked = await mint('tenant-a');
    await store.revoke(revoked.kid, 'synthetic test');
    const expired = await mint('tenant-a');
    await pg.query("UPDATE api_keys SET expires_at = NOW() - INTERVAL '1 day' WHERE kid = $1", [expired.kid]);
    for (const key of [unknown, revoked, expired]) {
      const res = await request(key.token, 'GET', '/v1/notes');
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe('unauthorized');
      expect(calls.length).toBe(1);
      expect(calls[0].sql).toMatch(/^SELECT \* FROM api_keys WHERE kid = \$1$/);
      expect(calls[0].params[0] === key.kid).toBe(true);
    }
  });

  test('valid A/B keys retain separate CRUD, export, identity, and key-mint scope', async () => {
    const created = await request(b.token, 'POST', '/v1/notes', { title: 'Only tenant B' });
    expect(created.status).toBe(201);
    const bId = created.json.id;
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const res = await request(b.token, method, `/v1/notes/${noteId}`, method === 'PATCH' ? { title: 'Wrong tenant' } : undefined);
      expect(res.status).toBe(404);
      const domain = calls.filter(({ sql }) => /\bnotes\b/.test(sql));
      expect(domain.length).toBe(1);
      expect(domain[0].params).toEqual(['tenant-b', noteId]);
    }
    for (const [key, id, tid] of [[a, noteId, 'tenant-a'], [b, bId, 'tenant-b']]) {
      const listed = await request(key.token, 'GET', '/v1/notes');
      expect(listed.status).toBe(200);
      expect(listed.json.data.map(note => note.id)).toEqual([id]);
      const exported = await request(key.token, 'POST', '/v1/export');
      expect(exported.status).toBe(200);
      expect(exported.json.notes.map(note => note.id)).toEqual([id]);
      const whoami = await request(key.token, 'GET', '/v1/auth/whoami');
      expect(whoami.status).toBe(200);
      expect(whoami.json.tenant.id).toBe(tid);
      const minted = await request(key.token, 'POST', '/v1/api-keys', { tenantId: 'ignored-foreign-tenant' });
      expect(minted.status).toBe(201);
      const row = await store.findByKid(minted.json.api_key.id);
      expect(row.tid).toBe(tid);
      const lastUsed = (await pg.query('SELECT last_used_at FROM api_keys WHERE kid = $1', [key.kid])).rows[0];
      expect(lastUsed.last_used_at === null).toBe(false);
    }
    const updated = await request(b.token, 'PATCH', `/v1/notes/${bId}`, { title: 'B updated' });
    expect(updated.status).toBe(200);
    expect(updated.json.title).toBe('B updated');
    expect((await request(b.token, 'DELETE', `/v1/notes/${bId}`)).status).toBe(200);
    expect((await request(a.token, 'GET', `/v1/notes/${noteId}`)).json.title).toBe('Only tenant A');
  });
});
