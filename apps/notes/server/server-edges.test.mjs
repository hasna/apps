// notes-server edge test suite — agent-authored (SOL consult refused: the
// fleet ChatGPT codex lane was at capacity; see the task receipt).
//
// Covers gaps the existing server.test.mjs leaves open: OTP failure paths and
// rate limiting, scoped API keys and the requireScope 403 matrix, cross-tenant
// isolation (including per-tenant seq counters), notes CRUD edge conditions
// (empty titles, label cap, folder:null, pinned/archived, revisions, hashes),
// the payload size guard, and the http.mjs helper contracts.
// Run: bun test (from the app root or this directory).

import { describe, expect, test } from 'bun:test';
import { openDb } from './db.mjs';
import { createApp, resolveConfig } from './app.mjs';
import { sha256 } from './auth.mjs';
import { ApiError, errorBody, mapError, bearer, parseLimit } from './http.mjs';

const LOOPBACK = { ip: '127.0.0.1' };

async function makeApp(overrides = {}) {
  const db = openDb(':memory:');
  const config = { ...resolveConfig({}, []), devMode: true, log: () => {}, ...overrides };
  return { db, app: await createApp({ db, config }) };
}

function call(app, method, path, { token, body, env = LOOPBACK } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
}

async function login(app, email = 'owner@example.com') {
  const started = await (await call(app, 'POST', '/api/v1/auth/login', { body: { email } })).json();
  const res = await call(app, 'POST', '/api/v1/auth/verify', { body: { email, code: started.devCode } });
  expect(res.status).toBe(200);
  return res.json(); // { token, user, tenant, apiKey? }
}

describe('http helpers', () => {
  test('parseLimit: fallback on junk, clamp at max, floor at the integer', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('abc')).toBe(50);
    expect(parseLimit('0')).toBe(50);
    expect(parseLimit('-5')).toBe(50);
    expect(parseLimit('12.7')).toBe(12);
    expect(parseLimit('500')).toBe(200);
    expect(parseLimit('200')).toBe(200);
    expect(parseLimit('7', 10)).toBe(7);
  });

  test('bearer: only a Bearer scheme yields a token', () => {
    expect(bearer(undefined)).toBe('');
    expect(bearer('')).toBe('');
    expect(bearer('Basic dXNlcjpwYXNz')).toBe('');
    expect(bearer('Bearer tok')).toBe('tok');
    expect(bearer('bearer tok')).toBe('tok');
    expect(bearer('Bearer')).toBe('');
    expect(bearer('Bearer  tok  ')).toBe('tok');
  });

  test('mapError: ApiError passthrough, sqlite/postgres conflicts -> 409, unknown -> 500', () => {
    expect(mapError(new ApiError('not_found', 'note not found', 404))).toEqual({
      code: 'not_found', message: 'note not found', status: 404, details: undefined,
    });
    const sqlite = new Error('UNIQUE constraint failed');
    sqlite.code = 'SQLITE_CONSTRAINT_UNIQUE';
    expect(mapError(sqlite)).toEqual({ code: 'conflict', message: 'resource already exists', status: 409 });
    const pg = new Error('duplicate key');
    pg.code = '23505';
    expect(mapError(pg)).toEqual({ code: 'conflict', message: 'resource already exists', status: 409 });
    expect(mapError(new Error('boom'))).toEqual({ code: 'internal_error', message: 'internal server error', status: 500 });
  });

  test('errorBody: details ride along only when defined', () => {
    expect(errorBody('bad_request', 'nope')).toEqual({ error: { code: 'bad_request', message: 'nope' } });
    expect(errorBody('bad_request', 'nope', { why: 1 })).toEqual({ error: { code: 'bad_request', message: 'nope', details: { why: 1 } } });
  });
});

describe('OTP login edges', () => {
  test('invalid email -> 400 before any code is issued', async () => {
    const { app } = await makeApp();
    for (const email of ['', 'not-an-email', 'a@b']) {
      const res = await call(app, 'POST', '/api/v1/auth/login', { body: { email } });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('bad_request');
    }
  });

  test('wrong code -> 401', async () => {
    const { app } = await makeApp();
    const started = await (await call(app, 'POST', '/api/v1/auth/login', { body: { email: 'wrong@example.com' } })).json();
    const res = await call(app, 'POST', '/api/v1/auth/verify', { body: { email: 'wrong@example.com', code: '000000' } });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
    expect(started.devCode).not.toBe('000000');
  });

  test('expired request -> 401 (invalid or expired login code)', async () => {
    const { db, app } = await makeApp();
    const email = 'expired@example.com';
    const code = '123456';
    db.query(
      'INSERT INTO otp_login_requests (id, email, code_hash, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('00000000-0000-4000-8000-00000000dead', email, sha256(`${email}:${code}`), 'pending', '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
    const res = await call(app, 'POST', '/api/v1/auth/verify', { body: { email, code } });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
  });

  test('a consumed code cannot be replayed', async () => {
    const { app } = await makeApp();
    const started = await (await call(app, 'POST', '/api/v1/auth/login', { body: { email: 'once@example.com' } })).json();
    const first = await call(app, 'POST', '/api/v1/auth/verify', { body: { email: 'once@example.com', code: started.devCode } });
    expect(first.status).toBe(200);
    const replay = await call(app, 'POST', '/api/v1/auth/verify', { body: { email: 'once@example.com', code: started.devCode } });
    expect(replay.status).toBe(401);
  });

  test('email lookup is case-insensitive: same user, api key issued exactly once', async () => {
    const { app } = await makeApp();
    const first = await login(app, 'Mixed@Example.com');
    const second = await login(app, 'mixed@example.com');
    expect(second.user.id).toBe(first.user.id);
    expect(second.apiKey).toBeUndefined();
    expect(first.apiKey).toStartWith('pn_');
  });

  test('OTP login is rate limited per IP after 5 requests; other IPs unaffected', async () => {
    const { app } = await makeApp();
    let last = null;
    for (let i = 0; i < 5; i += 1) {
      last = await call(app, 'POST', '/api/v1/auth/login', { body: { email: 'rl@example.com' } });
      expect(last.status).toBe(200);
    }
    const sixth = await call(app, 'POST', '/api/v1/auth/login', { body: { email: 'rl@example.com' } });
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe('rate_limited');
    const otherIp = await call(app, 'POST', '/api/v1/auth/login', { body: { email: 'rl@example.com' }, env: { ip: '127.0.0.2' } });
    expect(otherIp.status).toBe(200);
  });

  test('the OTP code never reaches the server log by default (regression for #1542)', async () => {
    const lines = [];
    const { app } = await makeApp({ log: (line) => lines.push(String(line)) });
    const email = 'noleak@example.com';
    const started = await (await call(app, 'POST', '/api/v1/auth/login', { body: { email } })).json();
    expect(started.devCode).toMatch(/^\d{6}$/);
    const output = lines.join('\n');
    // A non-secret reference is still logged (observability), but never the code.
    expect(output).toContain(email);
    expect(output).toContain('login code requested');
    expect(output).not.toContain(started.devCode);
    expect(output).not.toMatch(/\b\d{6}\b/);
  });

  test('console delivery of login codes requires the explicit HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES opt-in', async () => {
    expect(resolveConfig({ HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES: '1' }, []).consoleCodes).toBe(true);
    expect(resolveConfig({}, []).consoleCodes).toBe(false);
    const lines = [];
    const { app } = await makeApp({ consoleCodes: true, log: (line) => lines.push(String(line)) });
    const email = 'optin@example.com';
    const started = await (await call(app, 'POST', '/api/v1/auth/login', { body: { email } })).json();
    expect(lines.join('\n')).toContain(started.devCode);
  });

  test('device login pairing codes are never written to the server log', async () => {
    const lines = [];
    const { app } = await makeApp({ log: (line) => lines.push(String(line)) });
    const started = await (await call(app, 'POST', '/api/v1/auth/device/start', { body: {} })).json();
    expect(started.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const output = lines.join('\n');
    expect(output).not.toContain(started.userCode);
    expect(output).not.toMatch(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
  });
});

describe('api key scopes', () => {
  async function makeScopedKey(app, sessionToken, scopes) {
    const res = await call(app, 'POST', '/api/v1/api-keys', {
      token: sessionToken,
      body: { name: 'scoped', scopes },
    });
    expect(res.status).toBe(201);
    return (await res.json()).key;
  }

  test('notes_read key can list but not write, and cannot administer keys', async () => {
    const { app } = await makeApp();
    const { token } = await login(app);
    const key = await makeScopedKey(app, token, ['notes_read']);

    const list = await call(app, 'GET', '/api/v1/notes', { token: key });
    expect(list.status).toBe(200);
    const write = await call(app, 'POST', '/api/v1/notes', { token: key, body: { title: 'x' } });
    expect(write.status).toBe(403);
    expect((await write.json()).error.code).toBe('forbidden');
    const admin = await call(app, 'GET', '/api/v1/api-keys', { token: key });
    expect(admin.status).toBe(403);
  });

  test('notes_write key can write but not read', async () => {
    const { app } = await makeApp();
    const { token } = await login(app);
    const key = await makeScopedKey(app, token, ['notes_write']);
    const write = await call(app, 'POST', '/api/v1/notes', { token: key, body: { clientId: 'w-1', title: 'w' } });
    expect(write.status).toBe(201);
    const read = await call(app, 'GET', '/api/v1/notes', { token: key });
    expect(read.status).toBe(403);
  });

  test('admin/full keys list and mint keys; whoami reports the exact scopes', async () => {
    const { app } = await makeApp();
    const { token, apiKey } = await login(app);
    const adminKey = await makeScopedKey(app, token, ['admin']);
    const list = await call(app, 'GET', '/api/v1/api-keys', { token: adminKey });
    expect(list.status).toBe(200);
    const whoamiRead = await (await call(app, 'GET', '/api/v1/auth/whoami', { token: apiKey })).json();
    expect(whoamiRead.auth).toEqual({ via: 'api_key', scopes: ['full'] });
    const whoamiScoped = await (await call(app, 'GET', '/api/v1/auth/whoami', { token: adminKey })).json();
    expect(whoamiScoped.auth.scopes).toEqual(['admin']);
  });
});

describe('tenant isolation', () => {
  test('a tenant can never see, patch, or delete another tenant’s note; seq counters are per tenant', async () => {
    const { app } = await makeApp();
    const a = await login(app, 'a@example.com');
    const b = await login(app, 'b@example.com');

    const created = await (await call(app, 'POST', '/api/v1/notes', { token: a.apiKey, body: { clientId: 'iso-1', title: 'A secret' } })).json();
    expect(created.seq).toBe(1);

    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const res = await call(app, method, `/api/v1/notes/${created.id}`, {
        token: b.apiKey,
        body: method === 'PATCH' ? { title: 'hijack' } : undefined,
      });
      expect(res.status).toBe(404, `${method} from another tenant must 404`);
    }
    const aList = await (await call(app, 'GET', '/api/v1/notes', { token: a.apiKey })).json();
    expect(aList.data).toHaveLength(1);
    const bList = await (await call(app, 'GET', '/api/v1/notes', { token: b.apiKey })).json();
    expect(bList.data).toHaveLength(0);

    // Per-tenant seq: B's first note starts at 1, not 2.
    const bNote = await (await call(app, 'POST', '/api/v1/notes', { token: b.apiKey, body: { clientId: 'iso-b', title: 'B' } })).json();
    expect(bNote.seq).toBe(1);
  });
});

describe('notes CRUD edges', () => {
  test('nonexistent ids 404 on get/patch/delete with the dialect envelope', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const id = '00000000-0000-4000-8000-0000000000ff';
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const res = await call(app, method, `/api/v1/notes/${id}`, {
        token: apiKey,
        body: method === 'PATCH' ? { title: 'x' } : undefined,
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('not_found');
    }
  });

  test('updating a soft-deleted note restores it (GAP-2 closure: PATCH clears the tombstone)', async () => {
    // The dialect contract (§notes server/notes.mjs updateNote) makes PATCH
    // the REST restore path: last-write-wins PATCH clears deleted_at and logs
    // note.restored, so a trashed note can come back. 404 would make REST
    // restore impossible; server.test.mjs pins the same contract.
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const note = await (await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'del-1', title: 'x' } })).json();
    await call(app, 'DELETE', `/api/v1/notes/${note.id}`, { token: apiKey });
    const restored = await (await call(app, 'PATCH', `/api/v1/notes/${note.id}`, { token: apiKey, body: { title: 'y' } })).json();
    expect(restored.deletedAt).toBeNull();
    expect(restored.title).toBe('y');
    // A second PATCH on the restored note is an ordinary update.
    const again = await (await call(app, 'PATCH', `/api/v1/notes/${note.id}`, { token: apiKey, body: { title: 'z' } })).json();
    expect(again.deletedAt).toBeNull();
    expect(again.title).toBe('z');
  });

  test('whitespace-only title falls back to Untitled; labels are trimmed, deduped, and capped at 50', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const labels = Array.from({ length: 60 }, (_, i) => `label-${i % 10}-${i}`);
    const note = await (await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'edge-1', title: '   ', labels } })).json();
    expect(note.title).toBe('Untitled');
    expect(note.labels).toHaveLength(50);
    expect(new Set(note.labels).size).toBe(50);
  });

  test('folder:null clears the folder while absent folder keeps the current value', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const note = await (await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'f-1', title: 'x', folder: 'work' } })).json();
    expect(note.folder).toBe('work');
    const kept = await (await call(app, 'PATCH', `/api/v1/notes/${note.id}`, { token: apiKey, body: { title: 'x2' } })).json();
    expect(kept.folder).toBe('work');
    const cleared = await (await call(app, 'PATCH', `/api/v1/notes/${note.id}`, { token: apiKey, body: { folder: null } })).json();
    expect(cleared.folder).toBeNull();
  });

  test('pinned/archived flags round-trip and revision/contentHash move on every patch', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const note = await (await call(app, 'POST', '/api/v1/notes', { token: apiKey, body: { clientId: 'pa-1', title: 'x', pinned: true, archived: true } })).json();
    expect(note.pinned).toBe(true);
    expect(note.archived).toBe(true);
    expect(note.revision).toBe(1);

    const patched = await (await call(app, 'PATCH', `/api/v1/notes/${note.id}`, { token: apiKey, body: { archived: false, bodyMarkdown: 'new body' } })).json();
    expect(patched.archived).toBe(false);
    expect(patched.pinned).toBe(true);
    expect(patched.revision).toBe(2);
    expect(patched.contentHash).not.toBe(note.contentHash);

    const renamed = await (await call(app, 'PATCH', `/api/v1/notes/${note.id}`, { token: apiKey, body: { title: 'renamed' } })).json();
    expect(renamed.revision).toBe(3);
    expect(renamed.contentHash).not.toBe(patched.contentHash);
  });
});

describe('request guards', () => {
  test('content-length above the 2 MiB cap is refused with 413 before any route logic', async () => {
    const { app } = await makeApp();
    const res = await app.request('/health', {
      method: 'GET',
      headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
    }, LOOPBACK);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('payload_too_large');
  });
});
