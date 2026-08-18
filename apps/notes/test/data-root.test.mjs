// Canonical data-root regression tests for @hasna/notes.
//
// Fleet law: app data lives at ~/.hasna/<app>/ — never a nested
// ~/.hasna/apps/<app> segment, never a hidden dot-dir, never a config
// local-state dir. The notes store previously resolved to the pre-rename
// nested root ~/.hasna/apps/notes (and the server default DB to
// ~/.hasna/apps/notes-server/server.db). These tests pin the canonical
// resolution and the one-time copy-forward migration from the legacy root:
// copy-only (source preserved, never deleted), skips entries that already
// exist at the destination (resumable and idempotent), receipt marker, and
// never runs when HASNA_NOTES_ROOT is set explicitly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataRoot, legacyDataRoot, migrateLegacyRootOnce } from '../tools/notes-lib.mjs';
import { DEFAULT_DB_PATH, LEGACY_DB_PATH, migrateLegacyServerDb } from '../server/paths.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

let originalHome;
let originalNotesRoot;

test.beforeEach(() => {
  originalHome = process.env.HOME;
  originalNotesRoot = process.env.HASNA_NOTES_ROOT;
});

test.afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalNotesRoot === undefined) delete process.env.HASNA_NOTES_ROOT;
  else process.env.HASNA_NOTES_ROOT = originalNotesRoot;
});

function tempHome(t) {
  const dir = mkdtempSync(join(tmpdir(), 'notes-data-root-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

function writeNote(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test('dataRoot defaults to the canonical ~/.hasna/notes, never the nested apps segment', (t) => {
  const home = tempHome(t);
  process.env.HOME = home;
  delete process.env.HASNA_NOTES_ROOT;
  assert.equal(dataRoot(), join(home, '.hasna', 'notes'));
  assert.equal(legacyDataRoot(), join(home, '.hasna', 'apps', 'notes'));
});

test('HASNA_NOTES_ROOT overrides the canonical default', (t) => {
  const home = tempHome(t);
  const explicit = join(home, 'explicit-store');
  process.env.HOME = home;
  process.env.HASNA_NOTES_ROOT = explicit;
  assert.equal(dataRoot(), explicit);
});

test('first use migrates a legacy nested-apps store into the canonical root, source preserved', (t) => {
  const home = tempHome(t);
  process.env.HOME = home;
  delete process.env.HASNA_NOTES_ROOT;
  const legacy = join(home, '.hasna', 'apps', 'notes');
  const canonical = join(home, '.hasna', 'notes');
  writeNote(join(legacy, 'notes', '0f55b581-7aeb-424d-b94c-7e33258f7917.md'), '# legacy note\n');
  writeNote(join(legacy, 'events', 'notes-note-created', 'spool', 'one.json'), '{"n":1}');
  writeNote(join(legacy, 'labels.json'), '[]');

  assert.equal(dataRoot(), canonical);
  // Copied into the canonical root...
  assert.equal(readFileSync(join(canonical, 'notes', '0f55b581-7aeb-424d-b94c-7e33258f7917.md'), 'utf8'), '# legacy note\n');
  assert.equal(readFileSync(join(canonical, 'events', 'notes-note-created', 'spool', 'one.json'), 'utf8'), '{"n":1}');
  assert.equal(readFileSync(join(canonical, 'labels.json'), 'utf8'), '[]');
  // ...source preserved, never deleted...
  assert.equal(existsSync(join(legacy, 'notes', '0f55b581-7aeb-424d-b94c-7e33258f7917.md')), true);
  // ...receipt marker written...
  const receipt = JSON.parse(readFileSync(join(canonical, '.legacy-root-migration.json'), 'utf8'));
  assert.equal(receipt.migratedFrom, legacy);
  assert.equal(typeof receipt.migratedAt, 'string');
  // ...and a second call is a no-op.
  const before = readdirNames(canonical).sort();
  migrateLegacyRootOnce(canonical);
  assert.deepEqual(readdirNames(canonical).sort(), before);
});

test('migration never overwrites existing canonical entries', (t) => {
  const home = tempHome(t);
  process.env.HOME = home;
  delete process.env.HASNA_NOTES_ROOT;
  const legacy = join(home, '.hasna', 'apps', 'notes');
  const canonical = join(home, '.hasna', 'notes');
  writeNote(join(legacy, 'notes', 'abc.md'), 'legacy content');
  writeNote(join(canonical, 'notes', 'abc.md'), 'canonical content, newer');

  dataRoot();
  assert.equal(readFileSync(join(canonical, 'notes', 'abc.md'), 'utf8'), 'canonical content, newer');
});

test('migration is resumable: partially-copied canonical root receives only missing entries', (t) => {
  const home = tempHome(t);
  process.env.HOME = home;
  delete process.env.HASNA_NOTES_ROOT;
  const legacy = join(home, '.hasna', 'apps', 'notes');
  const canonical = join(home, '.hasna', 'notes');
  writeNote(join(legacy, 'notes', 'a.md'), 'a');
  writeNote(join(legacy, 'notes', 'b.md'), 'b');
  // Simulate a crash mid-copy: 'a.md' already landed, 'b.md' did not.
  writeNote(join(canonical, 'notes', 'a.md'), 'a');

  migrateLegacyRootOnce(dataRoot());
  assert.equal(existsSync(join(canonical, 'notes', 'b.md')), true);
  assert.equal(readFileSync(join(canonical, 'notes', 'a.md'), 'utf8'), 'a');
});

test('an explicit HASNA_NOTES_ROOT skips the migration entirely', (t) => {
  const home = tempHome(t);
  const explicit = join(home, 'explicit-store');
  process.env.HOME = home;
  process.env.HASNA_NOTES_ROOT = explicit;
  const legacy = join(home, '.hasna', 'apps', 'notes');
  writeNote(join(legacy, 'notes', 'x.md'), 'x');

  assert.equal(dataRoot(), explicit);
  assert.equal(existsSync(join(explicit, 'notes')), false);
  assert.equal(existsSync(join(legacy, 'notes', 'x.md')), true);
});

test('server default DB path is canonical ~/.hasna/notes/server.db', () => {
  assert.equal(DEFAULT_DB_PATH.endsWith(join('.hasna', 'notes', 'server.db')), true, DEFAULT_DB_PATH);
  assert.equal(LEGACY_DB_PATH.endsWith(join('.hasna', 'apps', 'notes-server', 'server.db')), true, LEGACY_DB_PATH);
});

test('server migration copies the legacy SQLite file once and verifies, source preserved', (t) => {
  const home = tempHome(t);
  const legacy = join(home, 'legacy-db', 'server.db');
  const canonical = join(home, 'canonical-db', 'server.db');
  writeNote(legacy, 'not-a-real-db');
  writeNote(`${legacy}-wal`, 'wal');

  const migrated = migrateLegacyServerDb(canonical, legacy);
  assert.equal(migrated, true);
  assert.equal(readFileSync(canonical, 'utf8'), 'not-a-real-db');
  assert.equal(readFileSync(`${canonical}-wal`, 'utf8'), 'wal');
  assert.equal(existsSync(legacy), true);
  // Idempotent: canonical now exists, so a second call does nothing.
  writeNote(canonical, 'canonical-db');
  assert.equal(migrateLegacyServerDb(canonical, legacy), false);
  assert.equal(readFileSync(canonical, 'utf8'), 'canonical-db');
});

function readdirNames(dir) {
  return readdirSync(dir);
}
