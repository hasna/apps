// notes-server test suite — boots the real entrypoint, then exercises
// the personalnotes/v1 dialect surface in-process via Hono's app.request:
// auth (OTP + device flow + auto-approve), notes CRUD, and cursor
// pagination. The /api/v1/sync round-trip endpoint and its sync_batches
// table were removed (0.2.0).
// Run: cd server && bun test

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './db.mjs';
import { createApp, resolveConfig, SERVICE, VERSION } from './app.mjs';

const LOOPBACK = { ip: '127.0.0.1' };

async function makeApp(overrides = {}) {
  const db = openDb(':memory:');
  const config = { ...resolveConfig({}, []), devMode: true, log: () => {}, ...overrides };
  return { db, app: await createApp({ db, config, testOnlySqlite: true }) };
}

function call(app, method, path, { token, idem, body, env = LOOPBACK } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem) headers['idempotency-key'] = idem;
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
}

async function login(app, email = 'owner@example.com') {
  const started = await (await call(app, 'POST', '/api/v1/auth/login', { body: { email } })).json();
  const res = await call(app, 'POST', '/api/v1/auth/verify', { body: { email, code: started.devCode, requestId: started.requestId } });
  expect(res.status).toBe(200);
  return res.json(); // { token, user, tenant, apiKey? }
}

describe('boot', () => {
  test('real entrypoint fails closed before binding without server PostgreSQL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notes-server-boot-'));
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, 'index.mjs')], {
      env: { PATH: process.env.PATH, HOME: dir, HASNA_DATA_HOME: join(dir, 'xdg'), HASNA_NOTES_SERVER_PORT: '0' },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(code).toBe(1);
    expect(stdout).not.toContain('listening');
    expect(stderr).toContain('HASNA_NOTES_DATABASE_URL');
    expect(existsSync(join(dir, 'xdg'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 20000);

  test('file-backed database is created owner-only (0600 + 0700 dir)', () => {
    // The DB holds every tenant's note bodies, sessions, API-key hashes and
    // the persisted JWT signing secret — a world-readable file lets any local
    // user read all notes and mint sessions (P3 adversarial finding).
    const dir = join(mkdtempSync(join(tmpdir(), 'pn-server-perms-')), 'data');
    const path = join(dir, 'server.db');
    const db = openDb(path);
    try {
      db.exec("INSERT INTO meta (key, value) VALUES ('probe', 'x')"); // force WAL side files
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      for (const suffix of ['-wal', '-shm']) {
        expect(statSync(`${path}${suffix}`).mode & 0o077).toBe(0); // no group/world bits
      }
    } finally {
      db.close();
    }
  });
});

describe('auth', () => {
  test('unauthenticated API access gets the dialect error envelope', async () => {
    const { app } = await makeApp();
    const res = await call(app, 'GET', '/api/v1/notes');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
    expect(typeof body.error.message).toBe('string');
  });

  test('OTP first login provisions tenant + owner and returns the API key exactly once', async () => {
    const { app } = await makeApp();
    const first = await login(app, 'first@example.com');
    expect(first.token).toBeTruthy();
    expect(first.apiKey).toStartWith('pn_');
    expect(first.user.role).toBe('owner');
    expect(first.tenant.id).toBe(first.user.tenantId);

    const second = await login(app, 'first@example.com');
    expect(second.apiKey).toBeUndefined();
    expect(second.user.id).toBe(first.user.id);

    const viaKey = await (await call(app, 'GET', '/api/v1/auth/whoami', { token: first.apiKey })).json();
    expect(viaKey.auth.via).toBe('api_key');
    expect(viaKey.tenant.id).toBe(first.tenant.id);
    const viaSession = await (await call(app, 'GET', '/api/v1/auth/whoami', { token: first.token })).json();
    expect(viaSession.auth.via).toBe('session');
    expect(viaSession.user.email).toBe('first@example.com');
  });

  test('device flow: start → approve (session only) → token completes once, then 410 gone', async () => {
    const { app } = await makeApp();
    const { token, apiKey } = await login(app);

    const startRes = await call(app, 'POST', '/api/v1/auth/device/start', { body: {} });
    expect(startRes.status).toBe(201);
    const started = await startRes.json();
    expect(started.deviceCode).toStartWith('dc_');
    expect(started.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(started.interval).toBe(5);

    const pending = await (await call(app, 'POST', '/api/v1/auth/device/token', { body: { deviceCode: started.deviceCode } })).json();
    expect(pending).toMatchObject({ status: 'pending', approved: false });

    // API keys are rejected on approve — user session required.
    const viaKey = await call(app, 'POST', '/api/v1/auth/device/approve', { token: apiKey, body: { userCode: started.userCode } });
    expect(viaKey.status).toBe(403);

    const approved = await (await call(app, 'POST', '/api/v1/auth/device/approve', { token, body: { userCode: started.userCode } })).json();
    expect(approved.approved).toBe(true);
    expect(approved.exchangeToken).toStartWith('dt_');

    const done = await (await call(app, 'POST', '/api/v1/auth/device/token', { body: { deviceCode: started.deviceCode } })).json();
    expect(done.status).toBe('approved');
    expect(done.apiKey).toStartWith('pn_');

    const again = await call(app, 'POST', '/api/v1/auth/device/token', { body: { deviceCode: started.deviceCode } });
    expect(again.status).toBe(410);
    expect((await again.json()).error.code).toBe('gone');
    const exchanged = await call(app, 'POST', '/api/v1/auth/device/exchange', { body: { exchangeToken: approved.exchangeToken } });
    expect(exchanged.status).toBe(410);

    // The minted device key is a working full-scope credential.
    const whoami = await call(app, 'GET', '/api/v1/auth/whoami', { token: done.apiKey });
    expect(whoami.status).toBe(200);
  });

  test('--auto-approve completes loopback device logins without manual approval', async () => {
    const { app } = await makeApp({ autoApprove: true });
    const started = await (await call(app, 'POST', '/api/v1/auth/device/start', { body: {} })).json();
    const done = await (await call(app, 'POST', '/api/v1/auth/device/token', { body: { deviceCode: started.deviceCode } })).json();
    expect(done.status).toBe('approved');
    expect(done.apiKey).toStartWith('pn_');

    // Non-loopback requests stay pending even with the flag on.
    const remote = await (await call(app, 'POST', '/api/v1/auth/device/start', { body: {}, env: { ip: '203.0.113.9' } })).json();
    const poll = await (await call(app, 'POST', '/api/v1/auth/device/token', { body: { deviceCode: remote.deviceCode } })).json();
    expect(poll.status).toBe('pending');
  });

  test('logout revokes the session', async () => {
    const { app } = await makeApp();
    const { token } = await login(app, 'bye@example.com');
    expect((await call(app, 'POST', '/api/v1/auth/logout', { token })).status).toBe(200);
    expect((await call(app, 'GET', '/api/v1/auth/whoami', { token })).status).toBe(401);
  });
});

describe('notes CRUD', () => {
  test('create/get/patch/delete with revision bumps and soft-delete 404', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);

    const createRes = await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'crud-1', title: 'Hello', bodyMarkdown: 'World', labels: [' a ', 'a', 'b'] } });
    expect(createRes.status).toBe(201);
    const note = await createRes.json();
    expect(note).toMatchObject({ clientId: 'crud-1', title: 'Hello', revision: 1, source: 'hosted', labels: ['a', 'b'], deletedAt: null });
    expect(note.seq).toBe(1);

    const patched = await (await call(app, 'PATCH', `/api/v1/notes/${note.id}`, { token: apiKey, body: { title: 'Hello again' } })).json();
    expect(patched.revision).toBe(2);
    expect(patched.bodyMarkdown).toBe('World');
    expect(patched.contentHash).not.toBe(note.contentHash);

    const deleted = await (await call(app, 'DELETE', `/api/v1/notes/${note.id}`, { token: apiKey })).json();
    expect(deleted).toEqual({ deleted: true, id: note.id, revision: 3 });
    expect((await call(app, 'GET', `/api/v1/notes/${note.id}`, { token: apiKey })).status).toBe(404);

    const withDeleted = await (await call(app, 'GET', '/api/v1/notes?include_deleted=1', { token: apiKey })).json();
    expect(withDeleted.data).toHaveLength(1);
    expect(withDeleted.data[0].deletedAt).not.toBeNull();
    const withoutDeleted = await (await call(app, 'GET', '/api/v1/notes', { token: apiKey })).json();
    expect(withoutDeleted.data).toHaveLength(0);
  });

  test('PATCH on a soft-deleted note restores it (deleted_at cleared, note.restored event)', async () => {
    // Cloud-only clients (macOS app NotesBridge) restore a trashed note by
    // PATCHing it back — the REST surface has no dedicated restore verb, and
    // GAP-2's 404 on deleted rows made REST restore impossible. Last-write-wins
    // PATCH therefore clears the soft-delete tombstone (the updateRow `restore`
    // path and emitTransitionEvents' note.restored already anticipate this).
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const created = await (await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'restore-1', title: 'Trash me' } })).json();

    await call(app, 'DELETE', `/api/v1/notes/${created.id}`, { token: apiKey });

    const restored = await (await call(app, 'PATCH', `/api/v1/notes/${created.id}`, { token: apiKey, body: { archived: false, title: 'Trash me' } })).json();
    expect(restored.deletedAt).toBeNull();
    expect(restored.archived).toBe(false);
    expect(restored.title).toBe('Trash me');

    // The note is visible again in the default (non-deleted) list.
    const list = await (await call(app, 'GET', '/api/v1/notes', { token: apiKey })).json();
    expect(list.data.map((n) => n.id)).toContain(created.id);

    // A second PATCH on the restored note is an ordinary update (no error).
    const again = await (await call(app, 'PATCH', `/api/v1/notes/${created.id}`, { token: apiKey, body: { title: 'Restored again' } })).json();
    expect(again.title).toBe('Restored again');
    expect(again.deletedAt).toBeNull();
  });

  test('duplicate clientId maps to 409 conflict', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'dup-1' } });
    const dup = await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'dup-1' } });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('conflict');
  });

  test('export returns non-deleted notes with an exportId', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'e1', title: 'Keep' } });
    const drop = await (await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'e2', title: 'Drop' } })).json();
    await call(app, 'DELETE', `/api/v1/notes/${drop.id}`, { token: apiKey });
    const exported = await (await call(app, 'POST', '/api/v1/export', { token: apiKey, body: {} })).json();
    expect(exported.exportId).toBeTruthy();
    expect(exported.notes.map((n) => n.clientId)).toEqual(['e1']);
  });
});

describe('version label', () => {
  // I38-00565: /version reported the hardcoded server constant (0.1.0) while
  // the source app manifest is at 0.3.0 — the deployed server
  // /version lied about the running image. The version must track the app
  // manifest that ships in the image (/app/package.json in the Docker build).
  test('VERSION matches the app manifest version and /version reports it', async () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(manifest.version);
    const { app } = await makeApp();
    const res = await call(app, 'GET', '/version');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: manifest.version, service: SERVICE });
  });
});

describe('cursor pagination', () => {
  async function seed(app, apiKey, count = 250) {
    for (let i = 0; i < count; i += 1) {
      const res = await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: `p${String(i).padStart(3, '0')}`, title: `Note ${i}` } });
      expect(res.status).toBe(201);
    }
  }

  test('GET /api/v1/notes pages with cursor + nextCursor (list superset)', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    await seed(app, apiKey);

    const page1 = await (await call(app, 'GET', '/api/v1/notes?limit=200', { token: apiKey })).json();
    expect(page1.data).toHaveLength(200);
    expect(page1.nextCursor).toMatch(/^s:\d+$/);
    const page2 = await (await call(app, 'GET', `/api/v1/notes?limit=200&cursor=${page1.nextCursor}`, { token: apiKey })).json();
    expect(page2.data).toHaveLength(50);
    expect(page2.nextCursor).toBeNull();
    const ids = new Set([...page1.data, ...page2.data].map((n) => n.id));
    expect(ids.size).toBe(250);
  });
});
