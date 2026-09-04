import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataRoot } from '../tools/notes-lib.mjs';
import { applyNotesDataMigration, planNotesDataMigration } from '../tools/data-migration.mjs';
import { getDataRoot, getExactDataRoot, getLegacyDataRoot, getResolverDataRoot } from '../server/paths.mjs';

const fixtureHomes = [];
afterEach(() => {
  for (const home of fixtureHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'notes-xdg-')));
  fixtureHomes.push(home);
  return {
    home,
    env: { HOME: home, HASNA_DATA_HOME: join(home, 'xdg') },
    legacy: join(home, '.hasna', 'notes'),
    nested: join(home, '.hasna', 'apps', 'notes'),
    destination: join(home, 'xdg', 'notes'),
  };
}

function write(path, content) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

test('default data root is always the resolver XDG root, never a legacy root', () => {
  const { env, legacy } = fixture();
  assert.equal(getDataRoot(env), getResolverDataRoot(env));
  assert.notEqual(getDataRoot(env), legacy);
  assert.equal(getLegacyDataRoot(env), legacy);
});

test('exact overrides retain their established precedence', () => {
  const { env, home } = fixture();
  const withAll = {
    ...env,
    NOTES_HOME: join(home, 'fallback'),
    HASNA_NOTES_ROOT: join(home, 'root'),
    HASNA_NOTES_HOME: join(home, 'home'),
  };
  assert.equal(getExactDataRoot(withAll), join(home, 'home'));
  delete withAll.HASNA_NOTES_HOME;
  assert.equal(getDataRoot(withAll), join(home, 'root'));
  delete withAll.HASNA_NOTES_ROOT;
  assert.equal(getDataRoot(withAll), join(home, 'fallback'));
});

test('ordinary local-library path resolution performs no implicit migration', () => {
  const { home, legacy, destination } = fixture();
  write(join(legacy, 'notes', 'one.md'), 'legacy');
  const before = { ...process.env };
  try {
    process.env.HOME = home;
    process.env.HASNA_DATA_HOME = join(home, 'xdg');
    delete process.env.HASNA_NOTES_HOME;
    delete process.env.HASNA_NOTES_ROOT;
    delete process.env.NOTES_HOME;
    assert.equal(dataRoot(), destination);
    assert.equal(existsSync(destination), false);
    assert.equal(readFileSync(join(legacy, 'notes', 'one.md'), 'utf8'), 'legacy');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
});

test('migration planning is read-only and apply copies, verifies, and preserves source', () => {
  const { env, legacy, destination } = fixture();
  write(join(legacy, 'notes', 'one.md'), 'one\n');
  write(join(legacy, 'labels.json'), '[]\n');
  const plan = planNotesDataMigration({ env, source: 'legacy' });
  assert.equal(plan.copyFiles, 2);
  assert.equal(plan.conflictFiles, 0);
  assert.equal(existsSync(destination), false);

  const result = applyNotesDataMigration(plan);
  assert.equal(result.copiedFiles, 2);
  assert.equal(result.sourcePreserved, true);
  assert.equal(readFileSync(join(destination, 'notes', 'one.md'), 'utf8'), 'one\n');
  assert.equal(readFileSync(join(legacy, 'notes', 'one.md'), 'utf8'), 'one\n');
  const receipt = JSON.parse(readFileSync(join(destination, '.notes-data-migration.json'), 'utf8'));
  assert.equal(receipt.schema, 'hasna.notes.data-migration.v2');
  assert.equal(receipt.planFingerprint, plan.fingerprint);
  assert.equal(receipt.sourcePreserved, true);
  assert.equal(lstatSync(join(destination, '.notes-data-migration.json')).mode & 0o077, 0);

  const rerun = applyNotesDataMigration(planNotesDataMigration({ env, source: 'legacy' }));
  assert.equal(rerun.copiedFiles, 0);
  assert.equal(rerun.identicalFiles, 2);
});

test('destination conflict blocks the entire migration before any copy', () => {
  const { env, legacy, destination } = fixture();
  write(join(legacy, 'a.md'), 'source-a');
  write(join(legacy, 'b.md'), 'source-b');
  write(join(destination, 'a.md'), 'different');
  const plan = planNotesDataMigration({ env, source: 'legacy' });
  assert.equal(plan.conflictFiles, 1);
  assert.throws(() => applyNotesDataMigration(plan), /conflict/);
  assert.equal(existsSync(join(destination, 'b.md')), false);
});

test('symlink sources and destinations are rejected', () => {
  const { env, legacy, destination } = fixture();
  mkdirSync(legacy, { recursive: true });
  write(join(legacy, 'real.md'), 'real');
  symlinkSync(join(legacy, 'real.md'), join(legacy, 'link.md'));
  assert.throws(() => planNotesDataMigration({ env, source: 'legacy' }), /symbolic links/);
  rmSync(join(legacy, 'link.md'));
  mkdirSync(join(destination, '..'), { recursive: true });
  symlinkSync(legacy, destination);
  assert.throws(() => planNotesDataMigration({ env, source: 'legacy' }), /symbolic-link/);
});

test('nested source is supported only when selected explicitly', () => {
  const { env, nested } = fixture();
  write(join(nested, 'notes', 'old.md'), 'old');
  assert.equal(planNotesDataMigration({ env, source: 'legacy' }).sourcePresent, false);
  const plan = planNotesDataMigration({ env, source: 'nested' });
  assert.equal(plan.source, 'nested');
  assert.equal(plan.copyFiles, 1);
});

test('legacy nested server DB is explicit and SQLite shared memory is skipped', () => {
  const { env, home } = fixture();
  const server = join(home, '.hasna', 'apps', 'notes-server');
  write(join(server, 'server.db'), 'db');
  write(join(server, 'server.db-wal'), 'wal');
  write(join(server, 'server.db-shm'), 'volatile');
  const plan = planNotesDataMigration({ env, source: 'server-nested' });
  assert.equal(plan.copyFiles, 2);
  assert.equal(plan.skippedVolatileFiles, 1);
  assert.deepEqual(plan.entries.map((entry) => entry.rel), ['server.db', 'server.db-wal']);
});

test('reviewed plan is immutable and source-byte mutation is rejected before copying', () => {
  const { env, legacy, destination } = fixture();
  const source = join(legacy, 'one.md');
  write(source, 'one\n');
  const plan = planNotesDataMigration({ env, source: 'legacy' });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.entries[0].sourceBinding), true);
  assert.throws(() => { plan.entries[0].target = join(destination, 'escape'); }, TypeError);

  // Same-size replacement defeats size-only plans; the digest/metadata binding
  // must reject it before any destination is created.
  writeFileSync(source, 'two\n');
  assert.throws(() => applyNotesDataMigration(plan), /changed after planning|directory identity changed/);
  assert.equal(existsSync(destination), false);
});

test('destination-root replacement after review is rejected without writing attacker data', () => {
  const { env, legacy, destination, home } = fixture();
  write(join(legacy, 'one.md'), 'one');
  mkdirSync(destination, { recursive: true });
  const plan = planNotesDataMigration({ env, source: 'legacy' });
  const reviewedRoot = join(home, 'reviewed-root');
  renameSync(destination, reviewedRoot);
  mkdirSync(destination, { recursive: true });

  assert.throws(() => applyNotesDataMigration(plan), /identity changed/);
  assert.equal(existsSync(join(destination, 'one.md')), false);
  assert.equal(existsSync(join(reviewedRoot, 'one.md')), false);
});

test('destination parent swapped to a symlink after review is rejected', () => {
  const { env, legacy, destination, home } = fixture();
  write(join(legacy, 'notes', 'one.md'), 'one');
  const parent = join(destination, 'notes');
  const attacker = join(home, 'attacker');
  mkdirSync(parent, { recursive: true });
  mkdirSync(attacker, { recursive: true });
  const plan = planNotesDataMigration({ env, source: 'legacy' });
  renameSync(parent, join(destination, 'reviewed-notes-parent'));
  symlinkSync(attacker, parent);

  assert.throws(() => applyNotesDataMigration(plan), /unsafe path|identity changed/);
  assert.equal(existsSync(join(attacker, 'one.md')), false);
});

for (const target of ['root', 'parent']) {
  test(`descriptor-relative copy cannot follow a ${target} symlink swapped at the final open`, () => {
    const { env, legacy, destination, home } = fixture();
    write(join(legacy, 'notes', 'one.md'), 'reviewed');
    mkdirSync(join(destination, 'notes'), { recursive: true });
    const attacker = join(home, 'attacker');
    mkdirSync(attacker);
    const plan = planNotesDataMigration({ env });
    let injected = false;
    assert.throws(() => applyNotesDataMigration(plan, { checkpoint(event) {
      if (event !== 'before-copy-open' || injected) return;
      injected = true;
      const replaced = target === 'root' ? destination : join(destination, 'notes');
      renameSync(replaced, join(home, 'reviewed-directory'));
      symlinkSync(attacker, replaced);
    } }), /unsafe|changed/);
    assert.equal(injected, true);
    assert.equal(existsSync(join(attacker, 'one.md')), false);
    assert.equal(existsSync(join(attacker, 'notes', 'one.md')), false);
    assert.equal(existsSync(join(attacker, '.notes-data-migration.json')), false);
    assert.equal(readFileSync(join(legacy, 'notes', 'one.md'), 'utf8'), 'reviewed');
  });
}

for (const kind of ['regular', 'symlink']) {
  test(`receipt ${kind} introduced at final open is never overwritten`, () => {
    const { env, legacy, destination, home } = fixture();
    write(join(legacy, 'one.md'), 'reviewed');
    const victim = join(home, 'victim');
    write(victim, 'untouched');
    const plan = planNotesDataMigration({ env });
    assert.throws(() => applyNotesDataMigration(plan, { checkpoint(event) {
      if (event !== 'before-receipt-open') return;
      const receipt = join(destination, '.notes-data-migration.json');
      if (kind === 'symlink') symlinkSync(victim, receipt);
      else writeFileSync(receipt, 'existing receipt');
    } }), /no overwrite/);
    assert.equal(readFileSync(victim, 'utf8'), 'untouched');
    if (kind === 'regular') assert.equal(readFileSync(join(destination, '.notes-data-migration.json'), 'utf8'), 'existing receipt');
  });
}

test('source mutation at the snapshot boundary cannot copy unreviewed bytes', () => {
  const { env, legacy, destination } = fixture();
  const source = join(legacy, 'one.md');
  write(source, 'reviewed');
  const plan = planNotesDataMigration({ env });
  assert.throws(() => applyNotesDataMigration(plan, { checkpoint(event) {
    if (event === 'source-staged') writeFileSync(source, 'attacker');
  } }), /source changed/);
  assert.equal(existsSync(destination), false);
});

test('tampered summary cannot bypass the conflict gate or change receipt counts', () => {
  const { env, legacy, destination } = fixture();
  write(join(legacy, 'one.md'), 'reviewed');
  const plan = planNotesDataMigration({ env });
  assert.throws(() => applyNotesDataMigration({ ...plan, copyFiles: 0 }), /invalid or changed/);
  assert.equal(existsSync(destination), false);
});

test('new source files after planning invalidate the reviewed inventory', () => {
  const { env, legacy, destination } = fixture();
  write(join(legacy, 'one.md'), 'reviewed');
  const plan = planNotesDataMigration({ env });
  write(join(legacy, 'two.md'), 'unreviewed');
  assert.throws(() => applyNotesDataMigration(plan), /source directory contents changed/);
  assert.equal(existsSync(destination), false);
});

test('a changed verified destination cannot receive a success receipt', () => {
  const { env, legacy, destination } = fixture();
  write(join(legacy, 'one.md'), 'reviewed');
  const plan = planNotesDataMigration({ env });
  assert.throws(() => applyNotesDataMigration(plan, { checkpoint(event) {
    if (event === 'before-receipt-open') writeFileSync(join(destination, 'one.md'), 'changed');
  } }), /destination file changed/);
  assert.equal(existsSync(join(destination, '.notes-data-migration.json')), false);
});

test('unrelated regular receipt is refused even when files are identical', () => {
  const { env, legacy, destination } = fixture();
  write(join(legacy, 'one.md'), 'reviewed');
  write(join(destination, 'one.md'), 'reviewed');
  writeFileSync(join(destination, '.notes-data-migration.json'), '{}', { mode: 0o600 });
  const plan = planNotesDataMigration({ env });
  assert.throws(() => applyNotesDataMigration(plan), /does not match/);
  assert.equal(readFileSync(join(destination, '.notes-data-migration.json'), 'utf8'), '{}');
});

test('unsafe existing receipt is never followed or overwritten', () => {
  const { env, legacy, destination, home } = fixture();
  write(join(legacy, 'one.md'), 'one');
  write(join(destination, 'one.md'), 'one');
  const attacker = join(home, 'receipt-target');
  write(attacker, 'attacker-owned');
  symlinkSync(attacker, join(destination, '.notes-data-migration.json'));
  const plan = planNotesDataMigration({ env, source: 'legacy' });

  assert.throws(() => applyNotesDataMigration(plan), /receipt is unsafe/);
  assert.equal(readFileSync(attacker, 'utf8'), 'attacker-owned');
});
