// personalnotes-server test suite — boots the real entrypoint, then exercises
// the personalnotes/v1 dialect surface in-process via Hono's app.request:
// auth (OTP + device flow + auto-approve), notes CRUD, sync round-trip,
// idempotent replay, tombstone/purge/restore, and cursor pagination.
// Run: cd server && bun test

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './db.mjs';
import { createApp, resolveConfig } from './app.mjs';

const LOOPBACK = { ip: '127.0.0.1' };

function makeApp(overrides = {}) {
  const db = openDb(':memory:');
  const config = { ...resolveConfig({}, []), devMode: true, log: () => {}, ...overrides };
  return { db, app: createApp({ db, config }) };
}

function call(app, method, path, { token, idem, body, env = LOOPBACK } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem) headers['idempotency-key'] = idem;
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
}

async function login(app, email = 'owner@example.com') {
  const started = await (await call(app, 'POST', '/api/v1/auth/login', { body: { email } })).json();
  const res = await call(app, 'POST', '/api/v1/auth/verify', { body: { email, code: started.devCode } });
  expect(res.status).toBe(200);
  return res.json(); // { token, user, tenant, apiKey? }
}

let idemCounter = 0;
async function sync(app, token, body, idem = `test-${++idemCounter}`) {
  return call(app, 'POST', '/api/v1/sync', { token, idem, body });
}

describe('boot', () => {
  test('bun index.mjs boots, serves /health and dialect discovery', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pn-server-boot-'));
    const proc = Bun.spawn(['bun', join(import.meta.dir, 'index.mjs')], {
      env: { ...process.env, PERSONALNOTES_SERVER_PORT: '0', PERSONALNOTES_SERVER_DB: join(dir, 'server.db') },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      let out = '';
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      while (!/listening on (http:\/\/\S+)/.test(out)) {
        const { value, done } = await reader.read();
        if (done) break;
        out += decoder.decode(value);
      }
      const url = /listening on (http:\/\/\S+)/.exec(out)?.[1];
      expect(url).toBeTruthy();
      const health = await (await fetch(`${url}/health`)).json();
      expect(health).toEqual({ status: 'healthy', service: 'personalnotes-server', version: expect.any(String) });
      const discovery = await (await fetch(`${url}/api/v1`)).json();
      expect(discovery.dialect).toBe('personalnotes/v1');
      expect(discovery.service).toBe('personalnotes-server');
    } finally {
      proc.kill();
    }
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
    const { app } = makeApp();
    const res = await call(app, 'GET', '/api/v1/notes');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
    expect(typeof body.error.message).toBe('string');
  });

  test('OTP first login provisions tenant + owner and returns the API key exactly once', async () => {
    const { app } = makeApp();
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
    const { app } = makeApp();
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
    const { app } = makeApp({ autoApprove: true });
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
    const { app } = makeApp();
    const { token } = await login(app, 'bye@example.com');
    expect((await call(app, 'POST', '/api/v1/auth/logout', { token })).status).toBe(200);
    expect((await call(app, 'GET', '/api/v1/auth/whoami', { token })).status).toBe(401);
  });
});

describe('notes CRUD', () => {
  test('create/get/patch/delete with revision bumps and soft-delete 404', async () => {
    const { app } = makeApp();
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

  test('duplicate clientId maps to 409 conflict', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);
    await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'dup-1' } });
    const dup = await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'dup-1' } });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('conflict');
  });

  test('export returns non-deleted notes with an exportId', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);
    await sync(app, apiKey, { items: [{ clientId: 'e1', title: 'Keep' }, { clientId: 'e2', title: 'Drop' }] });
    await sync(app, apiKey, { items: [{ clientId: 'e2', deleted: true }] });
    const exported = await (await call(app, 'POST', '/api/v1/export', { token: apiKey, body: {} })).json();
    expect(exported.exportId).toBeTruthy();
    expect(exported.notes.map((n) => n.clientId)).toEqual(['e1']);
  });
});

describe('sync round-trip', () => {
  test('push, pull, guarded update, and conflict with full current row', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);

    const push = await (await sync(app, apiKey, { items: [{ clientId: 'n1', title: 'First', bodyMarkdown: 'body', source: 'local' }] })).json();
    expect(push.applied).toEqual([{ clientId: 'n1', id: expect.any(String), revision: 1 }]);
    expect(push.conflicts).toEqual([]);
    expect(push.cursor).toBe('s:1');
    expect(push.hasMore).toBe(false);

    // Fresh device pulls everything from an empty cursor.
    const pull = await (await sync(app, apiKey, { items: [], cursor: '' })).json();
    expect(pull.changes).toHaveLength(1);
    expect(pull.changes[0]).toMatchObject({ clientId: 'n1', title: 'First', revision: 1, seq: 1, source: 'local', deletedAt: null });

    const update = await (await sync(app, apiKey, { items: [{ clientId: 'n1', baseRevision: 1, title: 'Second' }] })).json();
    expect(update.applied[0].revision).toBe(2);

    // Stale baseRevision → conflict carrying the full current row; not applied.
    const stale = await (await sync(app, apiKey, { items: [{ clientId: 'n1', baseRevision: 1, title: 'Loser' }] })).json();
    expect(stale.applied).toEqual([]);
    expect(stale.conflicts).toHaveLength(1);
    expect(stale.conflicts[0].clientId).toBe('n1');
    expect(stale.conflicts[0].current).toMatchObject({ title: 'Second', revision: 2 });
  });

  test('validation: missing Idempotency-Key, missing clientId, non-array items', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);
    const noKey = await call(app, 'POST', '/api/v1/sync', { token: apiKey, body: { items: [] } });
    expect(noKey.status).toBe(400);
    const noClientId = await sync(app, apiKey, { items: [{ title: 'nope' }] });
    expect(noClientId.status).toBe(400);
    expect((await noClientId.json()).error.message).toContain('clientId');
    const notArray = await sync(app, apiKey, { items: 'nope' });
    expect(notArray.status).toBe(400);
  });
});

describe('idempotent replay', () => {
  test('same key + same body replays the stored response verbatim without re-applying', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);
    const body = { items: [{ clientId: 'idem-1', title: 'Once' }] };

    const first = await (await sync(app, apiKey, body, 'batch-1')).json();
    const replay = await (await sync(app, apiKey, body, 'batch-1')).json();
    expect(replay).toEqual(first); // includes the ORIGINAL cursor/changes snapshot (§5.4)

    // Nothing was re-applied: revision still 1.
    const state = await (await sync(app, apiKey, { items: [], cursor: '' }, 'peek-1')).json();
    expect(state.changes[0].revision).toBe(1);
  });

  test('same key + different body → 409 idempotency_conflict', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);
    await sync(app, apiKey, { items: [{ clientId: 'idem-2', title: 'A' }] }, 'batch-2');
    const clash = await sync(app, apiKey, { items: [{ clientId: 'idem-2', title: 'B' }] }, 'batch-2');
    expect(clash.status).toBe(409);
    expect((await clash.json()).error.code).toBe('idempotency_conflict');
  });
});

describe('tombstone, purge, restore', () => {
  test('tombstone propagates via changes; purge scrubs content; upsert restores', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);

    const created = await (await sync(app, apiKey, { items: [{ clientId: 't1', title: 'Secret', bodyMarkdown: 'sensitive' }] })).json();
    const noteId = created.applied[0].id;

    const del = await (await sync(app, apiKey, { items: [{ clientId: 't1', baseRevision: 1, deleted: true }] })).json();
    expect(del.applied).toEqual([{ clientId: 't1', id: noteId, revision: 2, deleted: true }]);
    expect((await call(app, 'GET', `/api/v1/notes/${noteId}`, { token: apiKey })).status).toBe(404);

    // The tombstone (still full content — GAP-1 dialect behavior) flows to other devices.
    const pull = await (await sync(app, apiKey, { items: [], cursor: '' })).json();
    expect(pull.changes).toHaveLength(1);
    expect(pull.changes[0].deletedAt).not.toBeNull();
    expect(pull.changes[0].bodyMarkdown).toBe('sensitive');

    // Restore = sync upsert with the tombstone's revision (§7).
    const restored = await (await sync(app, apiKey, { items: [{ clientId: 't1', baseRevision: 2, title: 'Secret' }] })).json();
    expect(restored.applied[0].revision).toBe(3);
    const afterRestore = await (await sync(app, apiKey, { items: [], cursor: '' })).json();
    expect(afterRestore.changes[0].deletedAt).toBeNull();

    // Purge (S2 superset): content scrubbed, tombstone kept and propagated.
    const purge = await (await sync(app, apiKey, { items: [{ clientId: 't1', purged: true }] })).json();
    expect(purge.applied[0]).toMatchObject({ clientId: 't1', deleted: true, purged: true });
    const afterPurge = await (await sync(app, apiKey, { items: [], cursor: '' })).json();
    const tomb = afterPurge.changes[0];
    expect(tomb.title).toBe('');
    expect(tomb.bodyMarkdown).toBe('');
    expect(tomb.frontmatterJson).toEqual({});
    expect(tomb.labels).toEqual([]);
    expect(tomb.deletedAt).not.toBeNull();
    expect(tomb.purgedAt).not.toBeNull();
  });

  test('deleting or purging a never-seen clientId is silently ignored (no tombstone fabricated)', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);
    const res = await (await sync(app, apiKey, { items: [{ clientId: 'ghost', deleted: true }, { clientId: 'ghost2', purged: true }] })).json();
    expect(res.applied).toEqual([]);
    expect(res.conflicts).toEqual([]);
    expect(res.changes).toEqual([]);
  });
});

describe('cursor pagination', () => {
  async function seed(app, apiKey, count = 250) {
    for (let offset = 0; offset < count; offset += 100) {
      const items = [];
      for (let i = offset; i < Math.min(offset + 100, count); i += 1) {
        items.push({ clientId: `p${String(i).padStart(3, '0')}`, title: `Note ${i}` });
      }
      const res = await sync(app, apiKey, { items });
      expect(res.status).toBe(200);
    }
  }

  test('sync pull pages by seq with hasMore until drained; incremental cursor picks up later edits', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);
    await seed(app, apiKey);

    const seen = new Map();
    let cursor = '';
    let rounds = 0;
    let lastSeq = 0;
    for (;;) {
      const page = await (await sync(app, apiKey, { items: [], cursor })).json();
      for (const change of page.changes) {
        expect(change.seq).toBeGreaterThan(lastSeq); // strict seq ASC ordering
        lastSeq = change.seq;
        seen.set(change.clientId, change);
      }
      rounds += 1;
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(rounds).toBe(3); // 100 + 100 + 50
    expect(seen.size).toBe(250);

    // Incremental: one edit → exactly one change past the drained cursor.
    await sync(app, apiKey, { items: [{ clientId: 'p007', baseRevision: 1, title: 'Edited' }] });
    const delta = await (await sync(app, apiKey, { items: [], cursor })).json();
    expect(delta.changes.map((c) => c.clientId)).toEqual(['p007']);
    expect(delta.changes[0].revision).toBe(2);
    expect(delta.hasMore).toBe(false);
  });

  test('ISO timestamp cursors are accepted with overlap-rewind (hosted-platform backcompat)', async () => {
    const { app } = makeApp();
    const { apiKey } = await login(app);
    await seed(app, apiKey, 120);

    const oldCursor = await (await sync(app, apiKey, { items: [], cursor: '2000-01-01T00:00:00.000Z' })).json();
    expect(oldCursor.changes).toHaveLength(100);
    expect(oldCursor.hasMore).toBe(true);
    expect(oldCursor.cursor).toMatch(/^s:\d+$/); // client is upgraded to seq paging

    // A "now" ISO cursor still returns just-written rows thanks to the ≥5s
    // rewind (everything seeded above is inside the window, so drain pages).
    await sync(app, apiKey, { items: [{ clientId: 'p001', baseRevision: 1, title: 'Fresh' }] });
    const seen = [];
    let page = await (await sync(app, apiKey, { items: [], cursor: new Date().toISOString() })).json();
    seen.push(...page.changes);
    while (page.hasMore) {
      page = await (await sync(app, apiKey, { items: [], cursor: page.cursor })).json();
      seen.push(...page.changes);
    }
    expect(seen.find((c) => c.clientId === 'p001')?.revision).toBe(2);

    // Unparseable cursors degrade to a full pull instead of erroring.
    const garbage = await (await sync(app, apiKey, { items: [], cursor: 'not-a-cursor' })).json();
    expect(garbage.changes).toHaveLength(100);
    expect(garbage.hasMore).toBe(true);
  });

  test('GET /api/v1/notes pages with cursor + nextCursor (list superset)', async () => {
    const { app } = makeApp();
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
