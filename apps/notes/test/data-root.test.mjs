// Canonical data-root regression tests for @hasna/notes.
//
// Fleet law: app data lives at ~/.hasna/<app>/ — never a nested
// ~/.hasna/apps/<app> segment, never a hidden dot-dir, never a config
// local-state dir. Path resolution routes through the @hasna/paths resolver
// (XDG / macOS home layout): the resolver data home (~/.local/share/hasna/notes
// on Linux) is adopted only when HASNA_DATA_HOME is set or the store has
// already been physically migrated there, otherwise the legacy ~/.hasna/notes
// root stays effective. These tests pin the canonical resolution, the gated
// resolver adoption, and the one-time copy-forward migration from the legacy
// nested root: copy-only (source preserved, never deleted), skips entries that
// already exist at the destination (resumable and idempotent), receipt marker,
// and never runs when an explicit HASNA_NOTES_* override is in use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataRoot, legacyDataRoot, migrateLegacyRootOnce } from '../tools/notes-lib.mjs';
import {
  DEFAULT_DB_PATH,
  LEGACY_DB_PATH,
  adoptResolverDataRoot,
  getDataRoot,
  getExactDataRoot,
  getLegacyDataRoot,
  getResolverDataRoot,
  migrateLegacyServerDb,
} from '../server/paths.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

let originalHome;
let originalNotesRoot;
let originalNotesHome;
let originalNotesHomeFallback;
let originalDataHome;

test.beforeEach(() => {
  originalHome = process.env.HOME;
  originalNotesRoot = process.env.HASNA_NOTES_ROOT;
  originalNotesHome = process.env.HASNA_NOTES_HOME;
  originalNotesHomeFallback = process.env.NOTES_HOME;
  originalDataHome = process.env.HASNA_DATA_HOME;
});

test.afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalNotesRoot === undefined) delete process.env.HASNA_NOTES_ROOT;
  else process.env.HASNA_NOTES_ROOT = originalNotesRoot;
  if (originalNotesHome === undefined) delete process.env.HASNA_NOTES_HOME;
  else process.env.HASNA_NOTES_HOME = originalNotesHome;
  if (originalNotesHomeFallback === undefined) delete process.env.NOTES_HOME;
  else process.env.NOTES_HOME = originalNotesHomeFallback;
  if (originalDataHome === undefined) delete process.env.HASNA_DATA_HOME;
  else process.env.HASNA_DATA_HOME = originalDataHome;
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

test('server default DB path is canonical ~/.hasna/notes/server.db (legacy until the resolver root is adopted)', () => {
  // In the pre-adoption default state the effective data root is the legacy
  // ~/.hasna/notes root, so the server default DB stays
  // ~/.hasna/notes/server.db (it follows the effective data root + server.db).
  assert.equal(DEFAULT_DB_PATH, join(getDataRoot(), 'server.db'));
  assert.equal(DEFAULT_DB_PATH.endsWith(join('.hasna', 'notes', 'server.db')), true, DEFAULT_DB_PATH);
  assert.equal(LEGACY_DB_PATH.endsWith(join('.hasna', 'apps', 'notes-server', 'server.db')), true, LEGACY_DB_PATH);
});

// --- @hasna/paths resolver adoption (XDG home migration, hotfixes plan 0f49f56a, task P3.3) ---

test('dataRoot stays at the legacy ~/.hasna/notes when the resolver root is not adopted', (t) => {
  const home = tempHome(t);
  process.env.HOME = home;
  delete process.env.HASNA_DATA_HOME;
  delete process.env.HASNA_NOTES_HOME;
  delete process.env.NOTES_HOME;
  delete process.env.HASNA_NOTES_ROOT;
  // Nothing at the resolver root and no HASNA_DATA_HOME -> not adopted.
  assert.equal(adoptResolverDataRoot(getResolverDataRoot()), false);
  assert.equal(getResolverDataRoot(), join(home, '.local', 'share', 'hasna', 'notes'));
  assert.equal(getLegacyDataRoot(), join(home, '.hasna', 'notes'));
  assert.equal(getDataRoot(), join(home, '.hasna', 'notes'));
  assert.equal(dataRoot(), join(home, '.hasna', 'notes'));
});

test('dataRoot resolves to the XDG data home when HASNA_DATA_HOME is set (operator opt-in)', (t) => {
  const home = tempHome(t);
  process.env.HOME = home;
  const xdg = join(home, 'xdg-data');
  process.env.HASNA_DATA_HOME = xdg;
  delete process.env.HASNA_NOTES_HOME;
  delete process.env.NOTES_HOME;
  delete process.env.HASNA_NOTES_ROOT;
  assert.equal(adoptResolverDataRoot(getResolverDataRoot()), true);
  assert.equal(getResolverDataRoot(), join(xdg, 'notes'));
  assert.equal(getDataRoot(), join(xdg, 'notes'));
  assert.equal(dataRoot(), join(xdg, 'notes'));
});

test('dataRoot adopts the resolver root when the store is already physically migrated there', (t) => {
  const home = tempHome(t);
  process.env.HOME = home;
  delete process.env.HASNA_DATA_HOME;
  delete process.env.HASNA_NOTES_HOME;
  delete process.env.NOTES_HOME;
  delete process.env.HASNA_NOTES_ROOT;
  const resolved = getResolverDataRoot();
  // Nothing at the resolver root yet -> not adopted.
  assert.equal(adoptResolverDataRoot(resolved), false);
  // The P4.3 store-migration phase has physically moved server.db there.
  writeNote(join(resolved, 'server.db'), 'migrated-db');
  assert.equal(adoptResolverDataRoot(resolved), true);
  assert.equal(getDataRoot(), resolved);
  assert.equal(dataRoot(), resolved);
});

test('an exact-app override wins unconditionally: HASNA_NOTES_HOME, then HASNA_NOTES_ROOT, then NOTES_HOME', (t) => {
  const home = tempHome(t);
  process.env.HOME = home;
  const a = join(home, 'exact-a');
  const b = join(home, 'exact-b');
  const c = join(home, 'exact-c');
  process.env.HASNA_NOTES_HOME = a;
  process.env.HASNA_NOTES_ROOT = b;
  process.env.NOTES_HOME = c;
  assert.equal(getExactDataRoot(), a);
  assert.equal(getDataRoot(), a);
  assert.equal(dataRoot(), a);
  delete process.env.HASNA_NOTES_HOME;
  assert.equal(getExactDataRoot(), b);
  assert.equal(dataRoot(), b);
  delete process.env.HASNA_NOTES_ROOT;
  assert.equal(getExactDataRoot(), c);
  assert.equal(dataRoot(), c);
});

test('an exact-app override skips the legacy-root migration entirely', (t) => {
  const home = tempHome(t);
  process.env.HOME = home;
  const explicit = join(home, 'explicit-store');
  process.env.HASNA_NOTES_HOME = explicit;
  const legacy = join(home, '.hasna', 'apps', 'notes');
  writeNote(join(legacy, 'notes', 'x.md'), 'x');

  assert.equal(dataRoot(), explicit);
  assert.equal(existsSync(join(explicit, 'notes')), false);
  assert.equal(existsSync(join(legacy, 'notes', 'x.md')), true);
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
