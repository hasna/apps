// HTTP API surface — the PRIMARY communication surface.
// Drives the fetch router in-process against a temp data root: public probes,
// the OpenAPI document, a full CRUD roundtrip, and fail-closed API-key auth.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouter } from '../src/server/router.mjs';

async function withRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'pn-server-'));
  const prev = process.env.HASNA_NOTES_ROOT;
  process.env.HASNA_NOTES_ROOT = root;
  t.after(async () => {
    if (prev === undefined) delete process.env.HASNA_NOTES_ROOT;
    else process.env.HASNA_NOTES_ROOT = prev;
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

const req = (method, path, body, headers = {}) =>
  new Request(`http://127.0.0.1${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

test('public probes: /health, /version, /openapi.json, /ready', async (t) => {
  await withRoot(t);
  const handle = createRouter({ version: '9.9.9' });

  const health = await handle(req('GET', '/health'));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const version = await handle(req('GET', '/version'));
  assert.equal((await version.json()).version, '9.9.9');

  const openapi = await (await handle(req('GET', '/openapi.json'))).json();
  assert.equal(openapi.openapi, '3.1.0');
  assert.ok(openapi.paths['/v1/notes'], 'openapi documents /v1/notes');
  assert.equal(openapi.info.version, '9.9.9');

  const ready = await handle(req('GET', '/ready'));
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, 'ready');
});

test('CRUD + lifecycle + labels + settings roundtrip', async (t) => {
  await withRoot(t);
  const handle = createRouter({ version: '0.0.0' });
  const now = new Date().toISOString();

  // create
  const created = await (
    await handle(req('POST', '/v1/notes', { title: 'Hello', body: 'World', labels: ['x'], status: 'active', createdAt: now, updatedAt: now }))
  ).json();
  assert.ok(created.id, 'note gets an id');
  assert.equal(created.title, 'Hello');

  // list
  const list = await (await handle(req('GET', '/v1/notes?limit=10'))).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].id, created.id);

  // get
  const got = await (await handle(req('GET', `/v1/notes/${created.id}`))).json();
  assert.equal(got.title, 'Hello');

  // 404 for unknown
  assert.equal((await handle(req('GET', '/v1/notes/does-not-exist'))).status, 404);

  // assign / unassign label
  const labeled = await (await handle(req('POST', `/v1/notes/${created.id}/labels`, { label: 'urgent' }))).json();
  assert.ok(labeled.labels.includes('urgent'));
  const unlabeled = await (await handle(req('DELETE', `/v1/notes/${created.id}/labels/urgent`))).json();
  assert.ok(!unlabeled.labels.includes('urgent'));

  // label list persistence (loadLabelList unions the persisted list with labels in use)
  await handle(req('PUT', '/v1/labels', { labels: ['ideas', 'work'] }));
  const labels = await (await handle(req('GET', '/v1/labels'))).json();
  assert.ok(labels.includes('ideas') && labels.includes('work'), `labels: ${labels}`);

  // settings
  const savedSettings = await (await handle(req('PUT', '/v1/settings', { trashRetentionDays: 7 }))).json();
  assert.equal(savedSettings.trashRetentionDays, 7);
  assert.equal((await (await handle(req('GET', '/v1/settings'))).json()).trashRetentionDays, 7);

  // trash -> restore -> delete
  const trashed = await (await handle(req('POST', `/v1/notes/${created.id}/trash`, { retentionDays: 3 }))).json();
  assert.equal(trashed.status, 'trash');
  const restored = await (await handle(req('POST', `/v1/notes/${created.id}/restore`))).json();
  assert.notEqual(restored.status, 'trash');
  const del = await handle(req('DELETE', `/v1/notes/${created.id}`));
  assert.equal((await del.json()).ok, true);
  assert.equal((await (await handle(req('GET', '/v1/notes'))).json()).items.length, 0);
});

test('fail-closed API-key auth on /v1 (probes stay open)', async (t) => {
  await withRoot(t);
  const handle = createRouter({ version: '0.0.0', apiKey: 'secret-key' });

  // probes never require auth
  assert.equal((await handle(req('GET', '/health'))).status, 200);

  // /v1 without key -> 401
  const noKey = await handle(req('GET', '/v1/notes'));
  assert.equal(noKey.status, 401);
  assert.equal((await noKey.json()).error, 'unauthorized');

  // wrong key -> 401
  assert.equal((await handle(req('GET', '/v1/notes', undefined, { 'x-api-key': 'nope' }))).status, 401);

  // correct key -> 200
  const ok = await handle(req('GET', '/v1/notes', undefined, { 'x-api-key': 'secret-key' }));
  assert.equal(ok.status, 200);
});

test('server writes to its own data root', async (t) => {
  const root = await withRoot(t);
  const handle = createRouter({ version: '0.0.0' });
  const now = new Date().toISOString();
  await handle(req('POST', '/v1/notes', { title: 'Persisted', body: 'b', createdAt: now, updatedAt: now }));
  const files = await readdir(join(root, 'notes'));
  assert.equal(files.filter((f) => f.endsWith('.md')).length, 1, 'note persisted as markdown on disk');
});
