import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteNote,
  getNote,
  loadNotes,
  saveNote,
  trashNote,
  restoreNote,
} from '../tools/notes-lib.mjs';
import { PersonalNotesClient } from '../sync/client.mjs';
import {
  loadSyncState,
  runSync,
  saveSyncState,
  summaryLine,
  syncStatePath,
} from '../sync/engine.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binPath = join(repoRoot, 'bin', 'personalnotes.mjs');
const API_KEY = 'pn_test_0000000000000000000000000000';

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'personalnotes-sync-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}

function runNode(script, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------
// In-process mock server implementing the /api/v1/sync contract of
// /docs/sync.md §server-algorithm (hosted-platform flavor by default, or the
// self-hosted ordered feed with `feed: 'ordered'`). Deliberately independent
// from the S2 server implementation so this suite tests the client alone.
// ---------------------------------------------------------------------------
async function createMockServer(t, { pageSize = 100, feed = 'hosted' } = {}) {
  const notes = new Map(); // clientKey -> row
  const batches = new Map(); // idempotencyKey -> { requestHash, response }
  const devices = new Map(); // deviceCode -> { approved }
  let clock = Date.parse('2026-07-02T00:00:00.000Z');
  const now = () => { clock += 10_000; return new Date(clock).toISOString(); };
  const state = { dropNextPushResponse: false, rateLimitNext: 0, syncCalls: 0 };
  let seq = 0; // per-tenant monotonic change counter (feed: 'seq' — the real S2 server shape)

  function upsert(item) {
    const existing = notes.get(item.clientId);
    if (existing) {
      for (const key of ['slug', 'bodyMarkdown', 'frontmatterJson', 'labels', 'pinned', 'archived', 'source']) {
        if (item[key] !== undefined) existing[key] = item[key];
      }
      // Platform merge quirk the client must design around (dialect §5.2):
      // an empty title is treated as absent — `input.title?.trim() || current.title`.
      if (item.title !== undefined) existing.title = String(item.title).trim() || existing.title;
      if (item.folder !== undefined) existing.folder = item.folder;
      existing.revision += 1;
      existing.updatedAt = now();
      existing.deletedAt = null; // implicit restore
      existing.seq = ++seq;
      return { clientId: item.clientId, id: existing.id, revision: existing.revision };
    }
    const created = {
      id: randomUUID(),
      clientId: item.clientId,
      slug: item.slug ?? null,
      title: item.title ?? 'Untitled',
      bodyMarkdown: item.bodyMarkdown ?? '',
      frontmatterJson: item.frontmatterJson ?? {},
      folder: item.folder ?? null,
      labels: item.labels ?? [],
      pinned: !!item.pinned,
      archived: !!item.archived,
      revision: 1,
      source: item.source ?? 'local',
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
      seq: ++seq,
    };
    notes.set(item.clientId, created);
    return { clientId: item.clientId, id: created.id, revision: 1 };
  }

  function changesSince(cursor) {
    if (feed === 'seq') {
      // Real self-hosted (S2) shape: opaque `s:<seq>` cursor over a monotonic
      // per-tenant counter; ISO cursors (hosted back-compat) fall back to
      // timestamp filtering — which re-feeds history when the timestamp is old.
      const m = /^s:(\d+)$/.exec(cursor || '');
      const sinceSeq = m ? Number(m[1]) : null;
      const sinceTs = !m && cursor ? Date.parse(cursor) : 0;
      const rows = [...notes.values()].filter(r => (sinceSeq != null
        ? (r.seq || 0) > sinceSeq
        : Date.parse(r.updatedAt) > sinceTs || (r.deletedAt && Date.parse(r.deletedAt) > sinceTs)));
      rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));
      const page = rows.slice(0, pageSize).map(r => ({ ...r }));
      const last = page[page.length - 1];
      return { changes: page, hasMore: rows.length > pageSize, cursor: last ? `s:${last.seq}` : (m ? cursor : `s:${seq}`) };
    }
    const since = cursor ? Date.parse(cursor) : 0;
    const rows = [...notes.values()].filter(r =>
      Date.parse(r.updatedAt) > since || (r.deletedAt && Date.parse(r.deletedAt) > since));
    if (feed === 'ordered') {
      rows.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
      const page = rows.slice(0, pageSize).map(r => ({ ...r }));
      const last = page[page.length - 1];
      return { changes: page, hasMore: rows.length > pageSize, cursor: last ? last.updatedAt : (cursor || new Date(clock).toISOString()) };
    }
    rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { changes: rows.slice(0, pageSize).map(r => ({ ...r })), cursor: now() };
  }

  function handleSync(req, raw, res) {
    if (req.headers.authorization !== `Bearer ${API_KEY}`) return json(res, 401, { error: { code: 'unauthorized', message: 'bad key' } });
    const key = req.headers['idempotency-key'];
    if (!key) return json(res, 400, { error: { code: 'bad_request', message: 'idempotency key required' } });
    // Both real backends cap the request body at 2 MiB (413, rejected before
    // anything is applied) — the client must never park such a batch as pending.
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) {
      return json(res, 413, { error: { code: 'payload_too_large', message: 'sync body exceeds configured size limit' } });
    }
    if (state.rateLimitNext > 0) {
      state.rateLimitNext -= 1;
      return json(res, 429, { error: { code: 'rate_limited', message: 'slow down' } });
    }
    const requestHash = createHash('sha256').update(raw).digest('hex');
    const stored = batches.get(key);
    if (stored) {
      if (stored.requestHash !== requestHash) return json(res, 409, { error: { code: 'idempotency_conflict', message: 'key reuse with different body' } });
      return json(res, 200, stored.response); // replay, nothing re-applied
    }
    const body = JSON.parse(raw);
    state.syncCalls += 1;
    const applied = [];
    const conflicts = [];
    for (const item of body.items || []) {
      if (!item.clientId) return json(res, 400, { error: { code: 'bad_request', message: 'clientId required' } });
      const row = notes.get(item.clientId);
      if (row && item.baseRevision != null && row.revision !== item.baseRevision) {
        conflicts.push({ clientId: item.clientId, id: row.id, current: { ...row } });
        continue;
      }
      if (item.deleted) {
        if (!row) continue; // no tombstone for never-seen notes
        row.deletedAt = now();
        row.revision += 1;
        row.seq = ++seq;
        applied.push({ clientId: item.clientId, id: row.id, revision: row.revision, deleted: true });
        continue;
      }
      applied.push(upsert(item));
    }
    const page = changesSince(body.cursor);
    const response = { applied, conflicts, cursor: page.cursor, changes: page.changes, ...(feed === 'ordered' || feed === 'seq' ? { hasMore: page.hasMore } : {}) };
    batches.set(key, { requestHash, response: JSON.parse(JSON.stringify(response)) });
    if (state.dropNextPushResponse && (body.items || []).length > 0) {
      state.dropNextPushResponse = false;
      res.socket.destroy();
      return;
    }
    return json(res, 200, response);
  }

  function json(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  }

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      try {
        if (req.method === 'POST' && req.url === '/api/v1/sync') return handleSync(req, raw, res);
        if (req.method === 'GET' && req.url === '/health') return json(res, 200, { status: 'healthy', service: 'mock', version: '0.0.0' });
        if (req.method === 'POST' && req.url === '/api/v1/auth/device/start') {
          const deviceCode = `dc_${randomUUID()}`;
          devices.set(deviceCode, { approved: false });
          return json(res, 201, { deviceCode, userCode: 'ABCD-1234', verificationUri: 'mock/device', expiresAt: now(), interval: 0 });
        }
        if (req.method === 'POST' && req.url === '/api/v1/auth/device/token') {
          const { deviceCode } = JSON.parse(raw);
          const device = devices.get(deviceCode);
          if (!device) return json(res, 404, { error: { code: 'not_found', message: 'unknown device code' } });
          if (!device.approved) return json(res, 200, { status: 'pending', approved: false, message: 'waiting for approval' });
          return json(res, 200, { status: 'approved', approved: true, apiKey: API_KEY });
        }
        return json(res, 404, { error: { code: 'not_found', message: req.url } });
      } catch (err) {
        return json(res, 500, { error: { code: 'internal_error', message: String(err?.message || err) } });
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    notes,
    batches,
    state,
    row: clientId => notes.get(clientId),
    approveDevice: deviceCode => { devices.get(deviceCode).approved = true; },
    // Server-side mutation that does NOT touch updatedAt: models the hosted
    // in-flight-commit race where the change feed misses a committed write.
    mutateQuiet: (clientId, fields) => {
      const row = notes.get(clientId);
      Object.assign(row, fields);
      row.revision += 1;
    },
    client: () => new PersonalNotesClient({ apiUrl: url, apiKey: API_KEY }),
  };
}

function fixtureNote(overrides = {}) {
  return {
    id: randomUUID(),
    title: 'Grocery run',
    body: 'milk, eggs',
    labels: ['errands'],
    status: 'active',
    machine: 'linux-box',
    author: 'tester',
    agent: 'personalnotes-app',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    ...overrides,
  };
}

async function sync(mock, root, options = {}) {
  return runSync({ root, client: mock.client(), retryDelayMs: 5, ...options });
}

test('push: local markdown notes become sync items; second run is a no-op', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  const a = await saveNote(fixtureNote({ title: 'Grocery run' }), root);
  const b = await saveNote(fixtureNote({ id: randomUUID(), title: 'Standup notes', body: 'demo Friday', labels: [] }), root);

  const summary = await sync(mock, root);
  assert.equal(summary.pushed.created, 2);
  assert.equal(summary.conflicts.length, 0);
  const row = mock.row(a.id);
  assert.equal(row.title, 'Grocery run');
  assert.equal(row.bodyMarkdown, 'milk, eggs');
  assert.deepEqual(row.labels, ['errands']);
  assert.equal(row.frontmatterJson.machine, 'linux-box');
  assert.equal(row.frontmatterJson.rev, a.rev);
  assert.equal(row.revision, 1);

  const state = await loadSyncState(root, mock.url);
  assert.equal(state.notes[a.id].serverRevision, 1);
  assert.equal(state.notes[a.id].syncedRev, a.rev);
  assert.ok(state.cursor);

  // Unchanged store: nothing pushed, no batches sent.
  const again = await sync(mock, root);
  assert.equal(again.pushed.created + again.pushed.updated + again.pushed.purged, 0);
  assert.equal(again.batches, 0);

  // Local edit pushes an update with the acked baseRevision.
  const edited = await saveNote({ ...b, body: 'demo Friday, bring slides' }, root);
  const third = await sync(mock, root);
  assert.equal(third.pushed.updated, 1);
  assert.equal(mock.row(b.id).revision, 2);
  assert.equal(mock.row(b.id).bodyMarkdown, 'demo Friday, bring slides');
  assert.equal((await loadSyncState(root, mock.url)).notes[b.id].syncedRev, edited.rev);
});

test('pull: server rows land on disk with machine attribution preserved', async (t) => {
  const mock = await createMockServer(t);
  const studio = await tempRoot(t);
  const linux = await tempRoot(t);

  const note = await saveNote(fixtureNote({ title: 'Recording ideas', body: 'try the new mic', machine: 'studio-mac', machineFriendlyName: 'Studio Mac' }), studio);
  await sync(mock, studio);

  const pulled = await sync(mock, linux);
  assert.equal(pulled.pulled.created, 1);
  const local = await getNote(note.id, linux);
  assert.equal(local.title, 'Recording ideas');
  assert.equal(local.body, 'try the new mic');
  assert.equal(local.machine, 'studio-mac', 'attribution must survive the round trip');
  assert.equal(local.machineFriendlyName, 'Studio Mac');
  assert.deepEqual(local.labels, ['errands']);

  // Foreign rows (born on the server, no frontmatterJson) still map sanely.
  mock.notes.set('web-note', {
    id: randomUUID(), clientId: null, slug: null, title: 'From the web', bodyMarkdown: 'hello',
    frontmatterJson: {}, folder: null, labels: [], pinned: false, archived: true, revision: 1,
    source: 'hosted', deletedAt: null, createdAt: '2026-07-02T01:00:00.000Z', updatedAt: '2026-07-02T09:00:00.000Z',
  });
  const second = await sync(mock, linux);
  assert.equal(second.pulled.created, 1);
  const foreign = (await loadNotes(linux)).find(n => n.title === 'From the web');
  assert.equal(foreign.status, 'archived');
  assert.equal(foreign.machine, 'hosted');
});

test('tombstones: purge blanks server content and never resurrects on any machine', async (t) => {
  const mock = await createMockServer(t);
  const linux = await tempRoot(t);
  const studio = await tempRoot(t);

  const note = await saveNote(fixtureNote({ title: 'Secret draft', body: 'delete me' }), linux);
  await sync(mock, linux);
  await sync(mock, studio);
  assert.ok(await getNote(note.id, studio), 'studio pulled the note');

  // Local purge (file gone) -> blanking upsert + deleted:true tombstone.
  await deleteNote(note.id, linux);
  const purged = await sync(mock, linux);
  assert.equal(purged.pushed.purged, 1);
  const row = mock.row(note.id);
  assert.ok(row.deletedAt, 'server row soft-deleted');
  // The platform merge ignores an empty title ('' .trim() is falsy and keeps
  // the current value), so the scrub blanks to the platform default instead —
  // the sensitive title must NOT survive.
  assert.equal(row.title, 'Untitled', 'sensitive title scrubbed before delete');
  assert.equal(row.bodyMarkdown, '');
  assert.equal((await loadSyncState(linux, mock.url)).tombstones[note.id].serverRevision, row.revision);

  // The other machine applies the tombstone.
  const studioPull = await sync(mock, studio);
  assert.equal(studioPull.pulled.purged, 1);
  assert.equal(await getNote(note.id, studio), null);
  assert.ok(!existsSync(join(studio, 'notes', `${note.id}.md`)));

  // Resurrection attempt: full re-delivery from epoch (stale rows) must be
  // blocked by the recorded tombstone.
  const state = await loadSyncState(studio, mock.url);
  state.cursor = '';
  await saveSyncState(state, studio);
  const replayed = await sync(mock, studio);
  assert.equal(await getNote(note.id, studio), null, 'tombstone blocks resurrection');
  assert.equal(replayed.pulled.created, 0);

  // Same for the purging machine itself.
  const linuxState = await loadSyncState(linux, mock.url);
  linuxState.cursor = '';
  await saveSyncState(linuxState, linux);
  await sync(mock, linux);
  assert.equal(await getNote(note.id, linux), null);
});

test('conflicts: concurrent edits keep both versions on every machine', async (t) => {
  const mock = await createMockServer(t);
  const linux = await tempRoot(t);
  const studio = await tempRoot(t);

  const note = await saveNote(fixtureNote({ title: 'Plan', body: 'v1' }), linux);
  await sync(mock, linux);
  await sync(mock, studio);

  // Both machines edit without syncing in between.
  const onLinux = await getNote(note.id, linux);
  await saveNote({ ...onLinux, body: 'linux edit' }, linux);
  const onStudio = await getNote(note.id, studio);
  await saveNote({ ...onStudio, body: 'studio edit' }, studio);

  await sync(mock, linux); // linux wins the first push
  const studioSummary = await sync(mock, studio);

  // Studio pulls the newer server row while dirty -> keep both.
  assert.equal(studioSummary.conflicts.length, 1);
  assert.equal(studioSummary.conflicts[0].resolution, 'kept-both');
  const studioNotes = await loadNotes(studio);
  assert.equal(studioNotes.length, 2);
  const original = await getNote(note.id, studio);
  assert.equal(original.body, 'linux edit', 'server version keeps the note id');
  const copy = studioNotes.find(n => n.id !== note.id);
  assert.equal(copy.body, 'studio edit', 'local edit preserved as conflict copy');
  assert.match(copy.title, /\(conflict copy\)$/);

  // The copy was pushed in the same run; linux converges on the next sync.
  assert.ok(mock.row(copy.id), 'conflict copy pushed to server');
  await sync(mock, linux);
  assert.equal((await loadNotes(linux)).length, 2);
  assert.equal((await getNote(copy.id, linux)).body, 'studio edit');
});

test('conflicts: a push rejected with baseRevision mismatch resolves keep-both', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  const note = await saveNote(fixtureNote({ title: 'Race', body: 'base' }), root);
  await sync(mock, root);

  // Server-side commit the pull cannot see (updatedAt untouched): the push
  // must hit the server conflict path, not the pull path.
  mock.mutateQuiet(note.id, { bodyMarkdown: 'remote race edit' });
  const local = await getNote(note.id, root);
  await saveNote({ ...local, body: 'local race edit' }, root);

  const summary = await sync(mock, root);
  assert.equal(summary.conflicts.length, 1);
  assert.equal(summary.conflicts[0].resolution, 'kept-both');
  const notes = await loadNotes(root);
  assert.equal(notes.length, 2);
  assert.equal((await getNote(note.id, root)).body, 'remote race edit');
  assert.ok(notes.some(n => n.body === 'local race edit' && /\(conflict copy\)$/.test(n.title)));
  // The copy reached the server too (follow-up push round in the same run).
  const copy = notes.find(n => n.id !== note.id);
  assert.ok(mock.row(copy.id));
});

test('conflicts: a purge racing a newer server edit is dropped (data safety)', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  const note = await saveNote(fixtureNote({ title: 'Contested', body: 'v1' }), root);
  await sync(mock, root);

  // Another machine edits (invisible to the pull), we purge locally.
  mock.mutateQuiet(note.id, { bodyMarkdown: 'edited elsewhere' });
  await deleteNote(note.id, root);

  const summary = await sync(mock, root);
  assert.ok(summary.conflicts.some(c => c.resolution === 'purge-dropped'));
  const back = await getNote(note.id, root);
  assert.equal(back.body, 'edited elsewhere', 'note comes back from the server');
  assert.ok(!mock.row(note.id).deletedAt, 'server note not deleted');
});

test('pull: a remote purge over dirty local edits keeps the edits as a copy', async (t) => {
  const mock = await createMockServer(t);
  const linux = await tempRoot(t);
  const studio = await tempRoot(t);

  const note = await saveNote(fixtureNote({ title: 'Doomed', body: 'v1' }), linux);
  await sync(mock, linux);
  await sync(mock, studio);

  // Studio edits without syncing; linux purges and syncs the tombstone.
  const onStudio = await getNote(note.id, studio);
  await saveNote({ ...onStudio, body: 'unsaved studio work' }, studio);
  await deleteNote(note.id, linux);
  await sync(mock, linux);

  const summary = await sync(mock, studio);
  assert.equal(await getNote(note.id, studio), null, 'original purged');
  assert.equal(summary.pulled.purged, 1);
  const copy = (await loadNotes(studio)).find(n => /\(conflict copy\)$/.test(n.title));
  assert.equal(copy.body, 'unsaved studio work', 'dirty edits survive the purge');
  assert.ok(mock.row(copy.id), 'copy pushed back to the server');
});

test('idempotency: replaying the same batch never double-applies', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  const note = await saveNote(fixtureNote(), root);
  const client = mock.client();

  const body = { items: [{ clientId: note.id, title: 'Once', bodyMarkdown: 'only once' }], cursor: '' };
  const key = randomUUID();
  const first = await client.sync(body, key);
  const replay = await client.sync(body, key);
  assert.deepEqual(replay.applied, first.applied, 'stored response returned verbatim');
  assert.equal(mock.row(note.id).revision, 1, 'no double apply');
  // Same key + different body is a hard idempotency error.
  await assert.rejects(
    client.sync({ items: [{ clientId: note.id, title: 'Different' }], cursor: '' }, key),
    err => err.status === 409 && err.code === 'idempotency_conflict',
  );
});

test('resume: a crash after the server applied the batch replays with the same key', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  const note = await saveNote(fixtureNote({ title: 'Crash test' }), root);

  // Server applies the push but the response never arrives (network death).
  mock.state.dropNextPushResponse = true;
  await assert.rejects(sync(mock, root));
  assert.equal(mock.row(note.id).revision, 1, 'server applied the batch');
  const pendingState = await loadSyncState(root, mock.url);
  assert.ok(pendingState.pending, 'pending batch persisted before send');
  assert.ok(pendingState.pending.idempotencyKey);

  // Next run resends the SAME key/body: server replays, nothing re-applied.
  const resumed = await sync(mock, root);
  assert.equal(resumed.resumed, true);
  assert.equal(mock.row(note.id).revision, 1, 'replay did not bump the revision');
  const state = await loadSyncState(root, mock.url);
  assert.equal(state.pending, null);
  assert.equal(state.notes[note.id].serverRevision, 1);

  // Fully converged afterwards.
  const after = await sync(mock, root);
  assert.equal(after.batches, 0);
});

test('rate limit: 429 retries the same batch after backoff', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  const note = await saveNote(fixtureNote({ title: 'Patience' }), root);
  mock.state.rateLimitNext = 1;
  const summary = await sync(mock, root);
  assert.equal(summary.pushed.created, 1);
  assert.equal(mock.row(note.id).revision, 1);
});

test('pull drains multi-page feeds (self-hosted ordered cursor + hasMore)', async (t) => {
  const mock = await createMockServer(t, { pageSize: 3, feed: 'ordered' });
  const seedRoot = await tempRoot(t);
  const root = await tempRoot(t);
  for (let i = 0; i < 8; i += 1) {
    await saveNote(fixtureNote({ id: randomUUID(), title: `Note ${i}`, machine: 'studio-mac' }), seedRoot);
  }
  await sync(mock, seedRoot, { pageSize: 3 });

  const summary = await sync(mock, root, { pageSize: 3 });
  assert.equal(summary.pulled.created, 8, 'all pages drained');
  assert.ok(summary.pullRounds >= 3);
  assert.equal((await loadNotes(root)).length, 8);
});

// P3 integration regression (2026-07-02, todos 9dd60465): the REAL self-hosted
// server paginates with an opaque `s:<seq>` cursor — not the ISO timestamps the
// 'ordered' mock above uses. V8's lenient Date.parse() parses "s:100" as a
// year-100 date (Date.parse('s:100') === -59011465464000), so the old
// overlapRewindCursor() NaN-guard mangled the opaque cursor into
// "0099-12-31T22:15:31.000Z"; the server fell back to timestamp filtering and
// re-fed the tenant's history from the beginning, the client stale-skipped page
// one forever, burned MAX_PULL_ROUNDS, and never advanced past the first page
// (a 172-note store stalled at exactly 100 notes on the second device, live).
// Fixed by guarding the rewind with an ISO-8601 shape check: opaque cursors
// now pass through untouched.
test('pull drains multi-page feeds through the real opaque s:<seq> cursor shape', async (t) => {
  const mock = await createMockServer(t, { pageSize: 3, feed: 'seq' });
  const seedRoot = await tempRoot(t);
  const root = await tempRoot(t);
  for (let i = 0; i < 8; i += 1) {
    await saveNote(fixtureNote({ id: randomUUID(), title: `Note ${i}`, machine: 'studio-mac' }), seedRoot);
  }
  await sync(mock, seedRoot, { pageSize: 3 });

  const summary = await sync(mock, root, { pageSize: 3 });
  assert.equal(summary.pulled.created, 8, 'all pages drained through opaque seq cursors');
  assert.equal((await loadNotes(root)).length, 8);
  assert.ok(summary.pullRounds <= 4, `no cursor-stall thrash (got ${summary.pullRounds} rounds)`);
  const state = await loadSyncState(root, mock.url);
  assert.match(state.cursor, /^s:\d+$/, 'opaque cursor stored untouched');
});

test('oversized note: skipped and reported, never blocks the other notes', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  // 3 MiB body — over the 2 MiB request cap on both real backends; a single
  // note can never be split, so it must be skip-and-reported (P3 finding #2:
  // it used to become a poisoned pending batch that wedged the device forever).
  const big = await saveNote(fixtureNote({ id: randomUUID(), title: 'Pasted log', body: 'x'.repeat(3 * 1024 * 1024) }), root);
  const small = await saveNote(fixtureNote({ id: randomUUID(), title: 'Meeting notes' }), root);

  const summary = await sync(mock, root);
  assert.equal(summary.pushed.created, 1, 'the well-formed note still pushes');
  assert.ok(mock.row(small.id), 'small note reached the server');
  assert.equal(mock.row(big.id), undefined, 'oversized note not sent');
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].code, 'oversized_note');
  assert.equal(summary.errors[0].noteId, big.id);
  assert.match(summaryLine(summary), /Skipped 1 too large/);
  assert.equal((await loadSyncState(root, mock.url)).pending, null, 'no poisoned pending batch on disk');

  // Later runs stay healthy: the oversized note keeps being reported, edits
  // to other notes keep syncing.
  const edited = await saveNote({ ...small, body: 'now with an agenda' }, root);
  const again = await sync(mock, root);
  assert.equal(again.pushed.updated, 1);
  assert.equal(mock.row(small.id).bodyMarkdown, 'now with an agenda');
  assert.equal(again.errors[0]?.code, 'oversized_note');
  assert.equal((await getNote(edited.id, root)).body, 'now with an agenda');
});

test('a pending batch the server 413s is dropped, not resent head-of-line forever', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  const note = await saveNote(fixtureNote({ title: 'Healthy note' }), root);
  await sync(mock, root);

  // Model a poisoned pending batch left by an older client (or a server that
  // lowered its cap): the resume path must drop it after the 413 instead of
  // wedging every future run.
  const state = await loadSyncState(root, mock.url);
  state.pending = {
    idempotencyKey: randomUUID(),
    body: { items: [{ clientId: randomUUID(), title: 'Huge', bodyMarkdown: 'y'.repeat(3 * 1024 * 1024) }], cursor: '' },
    meta: { revs: {}, hashes: {}, kinds: {} },
  };
  await saveSyncState(state, root);
  await saveNote({ ...note, body: 'edit made while wedged' }, root);

  const summary = await sync(mock, root);
  assert.equal(summary.resumed, true);
  assert.ok(summary.errors.some(e => e.code === 'payload_too_large'), 'drop is reported');
  assert.equal(summary.pushed.updated, 1, 'the edit still pushes in the same run');
  assert.equal(mock.row(note.id).bodyMarkdown, 'edit made while wedged');
  assert.equal((await loadSyncState(root, mock.url)).pending, null, 'poison cleared');
});

test('stale rows never clobber local notes', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  const note = await saveNote(fixtureNote({ body: 'current' }), root);
  await sync(mock, root);

  // Force a full re-delivery from epoch: our own acked row comes back but is
  // stale (revision <= acked serverRevision) and must not touch the file.
  const before = await getNote(note.id, root);
  const state = await loadSyncState(root, mock.url);
  state.cursor = '';
  await saveSyncState(state, root);
  const summary = await sync(mock, root);
  assert.ok(summary.skippedStale >= 1);
  const after = await getNote(note.id, root);
  assert.equal(after.rev, before.rev, 'file untouched');
  assert.equal(after.body, 'current');
});

test('trash, archive, and restore propagate as note state across machines', async (t) => {
  const mock = await createMockServer(t);
  const linux = await tempRoot(t);
  const studio = await tempRoot(t);

  const note = await saveNote(fixtureNote({ title: 'Lifecycle' }), linux);
  await sync(mock, linux);
  await sync(mock, studio);

  await trashNote(note.id, {}, linux);
  await sync(mock, linux);
  await sync(mock, studio);
  const trashed = await getNote(note.id, studio);
  assert.equal(trashed.status, 'trash');
  assert.ok(trashed.trashedAt);
  assert.ok(trashed.trashExpiresAt);

  await restoreNote(note.id, studio);
  await sync(mock, studio);
  await sync(mock, linux);
  const restored = await getNote(note.id, linux);
  assert.equal(restored.status, 'active');
  assert.equal(restored.trashedAt, '');
  assert.ok(restored.restoredAt);
});

test('device auth flow works against any server speaking the dialect', async (t) => {
  const mock = await createMockServer(t);
  const client = new PersonalNotesClient({ apiUrl: mock.url });
  const started = await client.startDeviceLogin();
  assert.match(started.deviceCode, /^dc_/);
  const pending = await client.pollDeviceLogin(started.deviceCode);
  assert.equal(pending.status, 'pending');
  mock.approveDevice(started.deviceCode);
  const approved = await client.pollDeviceLogin(started.deviceCode);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.apiKey, API_KEY);
});

test('CLI: personalnotes sync pushes/pulls with --json and --dry-run', async (t) => {
  const mock = await createMockServer(t);
  const root = await tempRoot(t);
  const note = await saveNote(fixtureNote({ title: 'CLI note' }), root);
  const env = {
    PERSONALNOTES_ROOT: root,
    PERSONALNOTES_API_URL: mock.url,
    PERSONALNOTES_API_KEY: API_KEY,
    PERSONALNOTES_CONFIG: join(root, 'client-config.json'),
  };

  // Dry run: reports the plan, writes nothing.
  const dry = await runNode(binPath, ['sync', '--dry-run', '--json'], env);
  assert.equal(dry.code, 0, dry.stderr);
  const dryOut = JSON.parse(dry.stdout);
  assert.equal(dryOut.dryRun, true);
  assert.equal(dryOut.pushed.created, 1);
  assert.equal(mock.row(note.id), undefined, 'dry run must not push');
  assert.ok(!existsSync(syncStatePath(root)), 'dry run must not write state');

  const real = await runNode(binPath, ['sync', '--json'], env);
  assert.equal(real.code, 0, real.stderr);
  const realOut = JSON.parse(real.stdout);
  assert.equal(realOut.pushed.created, 1);
  assert.ok(mock.row(note.id));

  // Human summary line (no --json) and the deprecated `cloud sync` alias.
  const human = await runNode(binPath, ['cloud', 'sync'], env);
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /Pushed 0 .* Pulled 0 .* Conflicts 0/);

  // Unauthenticated: clear error, non-zero exit.
  const anon = await runNode(binPath, ['sync'], { ...env, PERSONALNOTES_API_KEY: '' });
  assert.equal(anon.code, 1);
  assert.match(anon.stderr, /Not signed in/);
});

test('summaryLine formats the human output', () => {
  const line = summaryLine({
    dryRun: false,
    pushed: { created: 2, updated: 1, purged: 1 },
    pulled: { created: 3, updated: 0, purged: 2 },
    conflicts: [{ resolution: 'kept-both' }],
    resumed: false,
  });
  assert.equal(line, 'Pushed 4 (2 new, 1 updated, 1 purged) · Pulled 5 (3 new, 0 updated, 2 purged) · Conflicts 1 (1 kept both)');
});
