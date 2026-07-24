// SDK surface — the generated typed HTTP client drives a REAL server over the wire.
// Boots `personalnotes-serve` (Bun.serve) on a random port, then exercises the
// generated PersonalNotesClient end-to-end. Requires the Bun runtime (Bun.serve).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server/index.mjs';
import { PersonalNotesClient, ApiError } from '../src/sdk/index.ts';

async function boot(t, { apiKey } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pn-sdk-'));
  const prev = process.env.HASNA_NOTES_ROOT;
  process.env.HASNA_NOTES_ROOT = root;
  const server = startServer({ port: 0, version: '1.2.3', apiKey });
  t.after(async () => {
    server.stop(true);
    if (prev === undefined) delete process.env.HASNA_NOTES_ROOT;
    else process.env.HASNA_NOTES_ROOT = prev;
    await rm(root, { recursive: true, force: true });
  });
  return { baseUrl: `http://${server.hostname}:${server.port}`, apiKey };
}

test('generated SDK performs a full CRUD roundtrip over HTTP', async (t) => {
  const { baseUrl } = await boot(t);
  const client = new PersonalNotesClient({ baseUrl });
  const now = new Date().toISOString();

  const created = await client.saveNote({ id: undefined, title: 'SDK note', body: 'hi', createdAt: now, updatedAt: now });
  assert.ok(created.id);

  const page = await client.listNotes({ limit: 5 });
  assert.equal(page.items.length, 1);

  const got = await client.getNote(created.id);
  assert.equal(got.title, 'SDK note');

  const labeled = await client.assignLabel(created.id, { label: 'sdk' });
  assert.ok(labeled.labels.includes('sdk'));

  await client.saveLabelList({ labels: ['a', 'b'] });
  const allLabels = await client.loadLabelList();
  assert.ok(allLabels.includes('a') && allLabels.includes('b'), `labels: ${allLabels}`);

  const del = await client.deleteNote(created.id);
  assert.equal(del.ok, true);
});

test('generated SDK surfaces ApiError on unknown note (404)', async (t) => {
  const { baseUrl } = await boot(t);
  const client = new PersonalNotesClient({ baseUrl });
  await assert.rejects(
    () => client.getNote('nope'),
    (err) => err instanceof ApiError && err.status === 404,
  );
});

test('generated SDK sends x-api-key when auth is required', async (t) => {
  const { baseUrl } = await boot(t, { apiKey: 'k3y' });
  const anon = new PersonalNotesClient({ baseUrl });
  await assert.rejects(() => anon.listNotes(), (err) => err instanceof ApiError && err.status === 401);

  const authed = new PersonalNotesClient({ baseUrl, apiKey: 'k3y' });
  const page = await authed.listNotes();
  assert.ok(Array.isArray(page.items));
});
