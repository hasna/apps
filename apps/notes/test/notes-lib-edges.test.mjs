// tools/notes-lib.mjs edge tests — agent-authored (SOL consult refused:
// fleet ChatGPT codex lane at capacity; see the task receipt).
//
// Pins the local markdown store's boundary behavior that the functional
// suite's happy paths do not reach: settings fallback rules, delete/get
// idempotence and case-insensitivity, trash purge legacy-retention fallback
// with an injectable clock, case-insensitive label rename/delete, the
// listNotes filter matrix (explicit status wins, offsets past the end, query
// fields), contentFingerprint truncation, and migrator edge inputs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assignLabel,
  contentFingerprint,
  deleteLabelEverywhere,
  deleteNote,
  getNote,
  listNotes,
  loadLabelList,
  loadSettings,
  migrateNoteTextToV2,
  purgeExpiredTrash,
  renameLabel,
  saveLabelList,
  saveNote,
  saveSettings,
  unassignLabel,
} from '../tools/notes-lib.mjs';

const uuidFor = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'notes-lib-edges-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}

test('loadSettings falls back to the 30-day default on missing, corrupt, zero, negative, and junk input', async (t) => {
  const root = await tempRoot(t);
  assert.deepEqual(await loadSettings(root), { trashRetentionDays: 30 });

  await writeFile(join(root, 'settings.json'), 'not json at all', 'utf8');
  assert.deepEqual(await loadSettings(root), { trashRetentionDays: 30 });

  for (const value of [0, -3, 'junk', {}]) {
    await writeFile(join(root, 'settings.json'), JSON.stringify({ trashRetentionDays: value }), 'utf8');
    assert.deepEqual(await loadSettings(root), { trashRetentionDays: 30 }, `trashRetentionDays ${JSON.stringify(value)} must fall back`);
  }
  // A fractional day is floored, not rounded.
  await writeFile(join(root, 'settings.json'), JSON.stringify({ trashRetentionDays: 7.9 }), 'utf8');
  assert.deepEqual(await loadSettings(root), { trashRetentionDays: 7 });
});

test('saveSettings normalizes and round-trips; undefined input yields the default', async (t) => {
  const root = await tempRoot(t);
  assert.deepEqual(await saveSettings({ trashRetentionDays: 7 }, root), { trashRetentionDays: 7 });
  assert.deepEqual(await loadSettings(root), { trashRetentionDays: 7 });
  assert.deepEqual(await saveSettings({}, root), { trashRetentionDays: 30 });
  assert.deepEqual(await saveSettings({ trashRetentionDays: -1 }, root), { trashRetentionDays: 30 });
  assert.deepEqual(await loadSettings(root), { trashRetentionDays: 30 });
});

test('deleteNote on a nonexistent id is a silent no-op and creates nothing', async (t) => {
  const root = await tempRoot(t);
  await assert.doesNotReject(deleteNote('00000000-0000-4000-8000-0000000000aa', root));
  assert.equal((await listNotes({}, root)).total, 0);
});

test('getNote matches ids case-insensitively against the on-disk lowercase filename', async (t) => {
  const root = await tempRoot(t);
  const id = 'ABCDEF00-0000-4000-8000-000000000001';
  const saved = await saveNote({ id, title: 'Case' }, root);
  assert.equal(saved.id, id.toLowerCase());
  assert.equal((await getNote(id.toUpperCase(), root)).title, 'Case');
  assert.equal((await getNote(saved.id, root)).title, 'Case');
  assert.equal(await getNote('00000000-0000-4000-8000-0000000000ff', root), null);
});

test('purgeExpiredTrash: legacy trash without an expiry stamp falls back to trashedAt + retention', async (t) => {
  const root = await tempRoot(t);
  await saveSettings({ trashRetentionDays: 30 }, root);
  // Legacy note: no trashExpiresAt — expiry derives from trashedAt + retention.
  await saveNote({
    id: uuidFor(1), title: 'Legacy', body: '', labels: [],
    status: 'trash', trashedAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', createdAt: '2026-06-01T00:00:00.000Z',
  }, root);

  // One day before the derived expiry: kept.
  const kept = await purgeExpiredTrash(root, new Date('2026-06-30T23:59:59.999Z'));
  assert.deepEqual(kept, { purged: [], count: 0 });
  assert.equal((await getNote(uuidFor(1), root)).status, 'trash');

  // Exactly at the derived expiry (trashedAt + 30 days): purged (<= now).
  const boundary = await purgeExpiredTrash(root, new Date('2026-07-01T00:00:00.000Z'));
  assert.deepEqual(boundary, { purged: [uuidFor(1)], count: 1 });
  assert.equal(await getNote(uuidFor(1), root), null);
});

test('purgeExpiredTrash: an explicit trashExpiresAt wins over the retention fallback', async (t) => {
  const root = await tempRoot(t);
  await saveSettings({ trashRetentionDays: 30 }, root);
  // trashedAt is 200 days before `now`, but the explicit expiry is far in the future.
  await saveNote({
    id: uuidFor(2), title: 'Kept', body: '', labels: [],
    status: 'trash', trashedAt: '2026-01-01T00:00:00.000Z', trashExpiresAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
  }, root);
  const result = await purgeExpiredTrash(root, new Date('2026-07-20T00:00:00.000Z'));
  assert.deepEqual(result, { purged: [], count: 0 });
  assert.equal((await getNote(uuidFor(2), root)).status, 'trash');
});

test('purgeExpiredTrash: active and archived notes are never purged, even when ancient', async (t) => {
  const root = await tempRoot(t);
  await saveSettings({ trashRetentionDays: 1 }, root);
  await saveNote({ id: uuidFor(3), title: 'Old active', body: '', labels: [], status: 'active', updatedAt: '2020-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' }, root);
  await saveNote({ id: uuidFor(4), title: 'Old archived', body: '', labels: [], status: 'archived', archivedAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' }, root);
  const result = await purgeExpiredTrash(root, new Date('2026-07-20T00:00:00.000Z'));
  assert.deepEqual(result, { purged: [], count: 0 });
  assert.equal((await listNotes({ includeArchived: true, includeTrash: true }, root)).total, 2);
});

test('renameLabel renames case-insensitively across the label list and every note', async (t) => {
  const root = await tempRoot(t);
  const id = uuidFor(5);
  await saveNote({ id, title: 'Work note', body: '', labels: ['Work', 'Errands'] }, root);
  await saveLabelList(['Work', 'Errands'], root);

  // The stored label is "Work"; renaming the lowercase form must still hit it.
  await renameLabel('work', 'Chores', root);

  const note = await getNote(id, root);
  assert.deepEqual(note.labels, ['Chores', 'Errands']);
  const labels = await loadLabelList(root);
  assert.ok(labels.includes('Chores'));
  assert.ok(!labels.some((l) => l.toLowerCase() === 'work'));
});

test('renameLabel and deleteLabelEverywhere are no-ops for labels that do not exist', async (t) => {
  const root = await tempRoot(t);
  const id = uuidFor(6);
  await saveNote({ id, title: 'x', body: '', labels: ['Keep'] }, root);
  await saveLabelList(['Keep'], root);

  await renameLabel('missing', 'New', root);
  await deleteLabelEverywhere('also-missing', root);
  assert.deepEqual((await getNote(id, root)).labels, ['Keep']);
  assert.deepEqual(await loadLabelList(root), ['Keep']);
});

test('deleteLabelEverywhere removes a label case-insensitively from notes and the list', async (t) => {
  const root = await tempRoot(t);
  const id = uuidFor(7);
  await saveNote({ id, title: 'x', body: '', labels: ['Work', 'Home'] }, root);
  await saveLabelList(['Work', 'Home'], root);
  await deleteLabelEverywhere('WORK', root);
  assert.deepEqual((await getNote(id, root)).labels, ['Home']);
  assert.deepEqual(await loadLabelList(root), ['Home']);
});

test('assignLabel rejects unknown notes and persists the label to the list; unassign is scoped', async (t) => {
  const root = await tempRoot(t);
  await assert.rejects(assignLabel('00000000-0000-4000-8000-0000000000ee', 'x', root), /note_not_found/);

  const id = uuidFor(8);
  await saveNote({ id, title: 'x', body: '', labels: ['A'] }, root);
  await assignLabel(id, 'B', root);
  assert.deepEqual((await getNote(id, root)).labels, ['A', 'B']);
  assert.ok((await loadLabelList(root)).includes('B'));

  await unassignLabel(id, 'b', root); // case-insensitive removal
  assert.deepEqual((await getNote(id, root)).labels, ['A']);

  await assert.rejects(unassignLabel('00000000-0000-4000-8000-0000000000ee', 'A', root), /note_not_found/);
});

test('listNotes: an explicit status filter wins over the default archived/trash exclusion', async (t) => {
  const root = await tempRoot(t);
  await saveNote({ id: uuidFor(9), title: 'Active', body: '', labels: [], status: 'active', updatedAt: '2026-07-01T00:00:00Z', createdAt: '2026-07-01T00:00:00Z' }, root);
  await saveNote({ id: uuidFor(10), title: 'Archived', body: '', labels: [], status: 'archived', updatedAt: '2026-07-02T00:00:00Z', createdAt: '2026-07-02T00:00:00Z' }, root);
  await saveNote({ id: uuidFor(11), title: 'Trashed', body: '', labels: [], status: 'trash', updatedAt: '2026-07-03T00:00:00Z', createdAt: '2026-07-03T00:00:00Z' }, root);

  assert.equal((await listNotes({}, root)).total, 1);
  assert.equal((await listNotes({ status: 'archived' }, root)).total, 1);
  assert.equal((await listNotes({ status: 'trash' }, root)).total, 1);
  assert.equal((await listNotes({ includeArchived: true }, root)).total, 2);
  assert.equal((await listNotes({ includeTrash: true }, root)).total, 2);
  assert.equal((await listNotes({ includeArchived: true, includeTrash: true }, root)).total, 3);
});

test('listNotes: label/machine filters are exact matches and query search is case-insensitive over title, body, and labels only', async (t) => {
  const root = await tempRoot(t);
  await saveNote({
    id: uuidFor(12), title: 'Quarterly Report', body: 'renewal notes inside', labels: ['Work'],
    folder: 'secret-project', machine: 'm1', status: 'active',
    updatedAt: '2026-07-01T00:00:00Z', createdAt: '2026-07-01T00:00:00Z',
  }, root);

  assert.equal((await listNotes({ label: 'Work' }, root)).total, 1);
  assert.equal((await listNotes({ label: 'work' }, root)).total, 0, 'label filter is exact-match on the stored casing');
  assert.equal((await listNotes({ machine: 'm1' }, root)).total, 1);
  assert.equal((await listNotes({ machine: 'M1' }, root)).total, 0);
  assert.equal((await listNotes({ query: 'RENEWAL' }, root)).total, 1, 'query matches body case-insensitively');
  assert.equal((await listNotes({ query: 'quarterly' }, root)).total, 1, 'query matches title case-insensitively');
  assert.equal((await listNotes({ query: 'work' }, root)).total, 1, 'query matches labels');
  assert.equal((await listNotes({ query: 'secret-project' }, root)).total, 0, 'folder is not a query field');
  assert.equal((await listNotes({ query: 'nomatch' }, root)).total, 0);
});

test('listNotes: pagination boundaries — limit 1 pages, offset past the end is empty with hasMore false', async (t) => {
  const root = await tempRoot(t);
  for (let i = 0; i < 3; i += 1) {
    await saveNote({
      id: uuidFor(20 + i), title: `Note ${i}`, body: '', labels: [], status: 'active',
      updatedAt: `2026-07-0${i + 1}T00:00:00Z`, createdAt: `2026-07-0${i + 1}T00:00:00Z`,
    }, root);
  }
  const page1 = await listNotes({ limit: 1 }, root);
  assert.equal(page1.items.length, 1);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.nextOffset, 1);
  assert.equal(page1.total, 3);

  const past = await listNotes({ limit: 1, offset: 5 }, root);
  assert.deepEqual(past.items, []);
  assert.equal(past.hasMore, false);
  assert.equal(past.nextOffset, 5);
});

test('contentFingerprint is deterministic, distinct per input, and truncated at 4000 chars', () => {
  assert.equal(contentFingerprint('hello world'), contentFingerprint('hello world'));
  assert.notEqual(contentFingerprint('hello world'), contentFingerprint('hello world!'));
  const long = 'x'.repeat(5000);
  assert.equal(contentFingerprint(long), contentFingerprint(long.slice(0, 4000)), 'bytes past 4000 must not affect the fingerprint');
  assert.equal(contentFingerprint(long).length, 16);
});

test('migrateNoteTextToV2 preserves CRLF bodies byte-for-byte', () => {
  const raw = '---\r\nid: 00000000-0000-4000-8000-0000000000aa\r\ntitle: T\r\n---\r\nline one\r\nline two\r\n';
  const result = migrateNoteTextToV2(raw);
  assert.equal(result.version, 'v1');
  assert.equal(result.changed, true);
  assert.ok(result.text.endsWith('line one\r\nline two\r\n'), 'the CRLF body must survive unnormalized');
});

test('migrateNoteTextToV2: unterminated frontmatter is bare, v2 files are untouched, empty rev migrates to rev 1', () => {
  const unterminated = '---\nid: 00000000-0000-4000-8000-0000000000aa\nno closing fence';
  assert.deepEqual(migrateNoteTextToV2(unterminated), { version: 'bare', changed: false, text: unterminated, dropped: [] });

  const v2 = '---\nid: 00000000-0000-4000-8000-0000000000aa\nrev: 3\n---\nbody';
  const v2result = migrateNoteTextToV2(v2);
  assert.equal(v2result.version, 'v2');
  assert.equal(v2result.changed, false);

  const emptyRev = '---\nid: 00000000-0000-4000-8000-0000000000aa\nrev:\n---\nbody';
  const migrated = migrateNoteTextToV2(emptyRev);
  assert.equal(migrated.version, 'v1');
  assert.ok(migrated.text.includes('\nrev: 1\n'), 'an empty rev: must be treated as v1 and normalized to rev 1');
});

test('migrateNoteTextToV2 fills deterministic defaults and reports dropped legacy keys', () => {
  const raw = '---\nid: 00000000-0000-4000-8000-0000000000aa\ntitle: Keep\ntags: [a, b]\ncontentType: plain\ntrashMachine: old-mac\n---\nbody';
  const result = migrateNoteTextToV2(raw);
  assert.equal(result.version, 'v1');
  assert.ok(result.text.includes('\nlabels: [a, b]\n'), 'legacy tags fold into labels');
  assert.ok(result.text.includes('\ncontentFormat: plain\n'), 'legacy contentType folds into contentFormat');
  assert.ok(result.text.includes('\nstatus: active\n'), 'missing keys get the deterministic default');
  assert.ok(result.text.includes('\nfolder: ""\n'));
  assert.deepEqual(result.dropped, ['trashMachine'], 'unfolded v1 keys are reported dropped');
});
