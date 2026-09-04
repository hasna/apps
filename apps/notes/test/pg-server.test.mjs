// Regression tests for the notes server running on the PostgreSQL backend.
//
// Boots the real Hono app (createApp) against an in-process Postgres
// (pglite) wrapped in the same storage-neutral query surface the server uses
// in production, with the real migration set applied. Proves:
//   - OTP login + verify issues a @hasna/contracts api key (hasna_notes_...)
//     minted with the signing secret (HASNA_NOTES_API_SIGNING_KEY with the
//     documented fallbacks),
//   - that key authenticates the notes CRUD routes over the wire dialect,
//   - a legacy pn_ key is rejected on the PostgreSQL backend (401),
//   - session (JWT) auth still works,
//   - isolated legacy SQLite fixtures elsewhere retain their historical dialect.

import { afterEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { MigrationLedger } from '../src/generated/storage-kit/index.js';
import { notesPgMigrations } from '../server/pg-migrations.ts';
import { wrapPgExecutor } from '../server/pg-adapter.mjs';
import { createApp, resolveConfig, SERVICE } from '../server/app.mjs';

const databases = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

async function bootPgServer(env = {}) {
  // pgcrypto contrib matches production PostgreSQL (the extension migration).
  const pglite = new PGlite({ extensions: { pgcrypto } });
  databases.push(pglite);
  const client = {
    async query(sql, params = []) {
      const result = await pglite.query(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    async many(sql, params = []) {
      return (await pglite.query(sql, params)).rows;
    },
    async get(sql, params = []) {
      return (await pglite.query(sql, params)).rows[0] ?? null;
    },
    async one(sql, params = []) {
      const row = (await pglite.query(sql, params)).rows[0];
      if (!row) throw new Error('no rows');
      return row;
    },
    async execute(sql, params = []) {
      // Multi-statement migrations run through pglite.exec (pglite.query
      // rejects them); parameterized executes use query.
      if (params.length === 0) await pglite.exec(sql);
      else await pglite.query(sql, params);
    },
  };
  const ledger = new MigrationLedger(client, notesPgMigrations());
  await ledger.migrate();
  const db = wrapPgExecutor(client, { applicationName: 'notes-test' });
  const config = resolveConfig(env, ['--dev']);
  config.log = () => {};
  const app = await createApp({ db, config });
  return { app, db, pglite };
}

async function request(app, method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, { ip: '127.0.0.1' });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body (e.g. /health shape is json; leave null)
  }
  return { status: res.status, json };
}

const SIGNING = 'notes-test-signing-secret-with-32-bytes!';

describe('notes server on PostgreSQL backend', () => {
  test('OTP login + verify issues a contracts api key minted with the signing secret', async () => {
    const { app } = await bootPgServer({ HASNA_NOTES_API_SIGNING_KEY: SIGNING });
    const login = await request(app, 'POST', '/api/v1/auth/login', { body: { email: 'pg@example.test' } });
    expect(login.status).toBe(200);
    const code = login.json.devCode;
    expect(typeof code).toBe('string');
    const verify = await request(app, 'POST', '/api/v1/auth/verify', { body: { email: 'pg@example.test', code, name: 'Pg User' } });
    expect(verify.status).toBe(200);
    expect(verify.json.apiKey).toStartWith('hasna_notes_');
    expect(verify.json.token).toBeTruthy();
  });

  test('signing secret fallbacks: API_KEY_SIGNING_SECRET and HASNA_API_SIGNING_KEY', async () => {
    for (const env of [
      { API_KEY_SIGNING_SECRET: SIGNING },
      { HASNA_API_SIGNING_KEY: SIGNING },
    ]) {
      const { app } = await bootPgServer(env);
      const login = await request(app, 'POST', '/api/v1/auth/login', { body: { email: 'pg2@example.test' } });
      const verify = await request(app, 'POST', '/api/v1/auth/verify', { body: { email: 'pg2@example.test', code: login.json.devCode, name: 'Pg2' } });
      expect(verify.status).toBe(200);
      expect(verify.json.apiKey).toStartWith('hasna_notes_');
    }
  });

  test('server refuses to start the postgres backend without a signing secret', async () => {
    await expect(bootPgServer({})).rejects.toThrow(/signing secret|HASNA_NOTES_API_SIGNING_KEY/i);
  });

  test('contracts api key authenticates notes CRUD over the wire dialect', async () => {
    const { app } = await bootPgServer({ HASNA_NOTES_API_SIGNING_KEY: SIGNING });
    const login = await request(app, 'POST', '/api/v1/auth/login', { body: { email: 'crud@example.test' } });
    const verify = await request(app, 'POST', '/api/v1/auth/verify', { body: { email: 'crud@example.test', code: login.json.devCode, name: 'Crud' } });
    const apiKey = verify.json.apiKey;

    const created = await request(app, 'POST', '/api/v1/notes', { token: apiKey, body: { title: 'PG note', bodyMarkdown: 'hello postgres' } });
    expect(created.status).toBe(201);
    expect(created.json.title).toBe('PG note');

    const listed = await request(app, 'GET', '/api/v1/notes', { token: apiKey });
    expect(listed.status).toBe(200);
    expect(listed.json.data.length).toBe(1);
    expect(listed.json.data[0].bodyMarkdown).toBe('hello postgres');

    const got = await request(app, 'GET', `/api/v1/notes/${created.json.id}`, { token: apiKey });
    expect(got.status).toBe(200);
    expect(got.json.contentHash).toBeTruthy();

    const updated = await request(app, 'PATCH', `/api/v1/notes/${created.json.id}`, { token: apiKey, body: { title: 'PG note v2' } });
    expect(updated.status).toBe(200);
    expect(updated.json.revision).toBe(2);

    const deleted = await request(app, 'DELETE', `/api/v1/notes/${created.json.id}`, { token: apiKey });
    expect(deleted.status).toBe(200);
    expect(deleted.json.deleted).toBe(true);
  });

  test('legacy pn_ api keys are rejected on the postgres backend', async () => {
    const { app } = await bootPgServer({ HASNA_NOTES_API_SIGNING_KEY: SIGNING });
    const res = await request(app, 'GET', '/api/v1/notes', { token: 'pn_test_0000000000000000000000000000' });
    expect(res.status).toBe(401);
  });

  test('session (JWT) auth works on postgres', async () => {
    const { app } = await bootPgServer({ HASNA_NOTES_API_SIGNING_KEY: SIGNING });
    const login = await request(app, 'POST', '/api/v1/auth/login', { body: { email: 'session@example.test' } });
    const verify = await request(app, 'POST', '/api/v1/auth/verify', { body: { email: 'session@example.test', code: login.json.devCode, name: 'Session' } });
    const token = verify.json.token;
    const whoami = await request(app, 'GET', '/api/v1/auth/whoami', { token });
    expect(whoami.status).toBe(200);
    expect(whoami.json.user.email).toBe('session@example.test');
  });

  test('api-keys listing works on postgres (contracts table shape)', async () => {
    const { app } = await bootPgServer({ HASNA_NOTES_API_SIGNING_KEY: SIGNING });
    const login = await request(app, 'POST', '/api/v1/auth/login', { body: { email: 'keys@example.test' } });
    const verify = await request(app, 'POST', '/api/v1/auth/verify', { body: { email: 'keys@example.test', code: login.json.devCode, name: 'Keys' } });
    const apiKey = verify.json.apiKey;
    const res = await request(app, 'GET', '/api/v1/api-keys', { token: apiKey });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.data)).toBe(true);
    expect(res.json.data.length).toBeGreaterThanOrEqual(1);
  });

  test('ready endpoint reports the postgres backend without leaking the DSN', async () => {
    const { app } = await bootPgServer({ HASNA_NOTES_API_SIGNING_KEY: SIGNING });
    const res = await request(app, 'GET', '/ready');
    expect(res.status).toBe(200);
    expect(res.json.service).toBe(SERVICE);
    expect(JSON.stringify(res.json)).toContain('postgresql');
    expect(JSON.stringify(res.json)).not.toMatch(/postgres:\/\//);
  });

  test('sync endpoint is unavailable on postgres (sync_batches dropped)', async () => {
    const { app } = await bootPgServer({ HASNA_NOTES_API_SIGNING_KEY: SIGNING });
    const login = await request(app, 'POST', '/api/v1/auth/login', { body: { email: 'sync@example.test' } });
    const verify = await request(app, 'POST', '/api/v1/auth/verify', { body: { email: 'sync@example.test', code: login.json.devCode, name: 'Sync' } });
    const res = await request(app, 'POST', '/api/v1/sync', {
      token: verify.json.apiKey,
      body: { items: [], cursor: null },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
