import { createHash } from 'node:crypto';
import {
  constants as fsConstants,
  copyFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { getHomeDir, getLegacyDataRoot, getResolverDataRoot } from '../server/paths.mjs';

const RECEIPT = '.notes-data-migration.json';

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function lstatIfPresent(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function assertSafeDestinationPath(destination, target) {
  const rel = relative(destination, target);
  if (!rel || rel.startsWith('..')) throw new Error('notes: migration target escapes the XDG destination.');
  let cursor = destination;
  for (const segment of rel.split('/').slice(0, -1)) {
    cursor = join(cursor, segment);
    const stat = lstatIfPresent(cursor);
    if (stat?.isSymbolicLink()) throw new Error(`notes: data migration refuses destination symbolic links (${relative(destination, cursor)}).`);
    if (stat && !stat.isDirectory()) throw new Error(`notes: data migration destination parent is not a directory (${relative(destination, cursor)}).`);
  }
}

function sourceRoot(kind, env) {
  if (kind === 'legacy') return getLegacyDataRoot(env);
  if (kind === 'nested') return join(getHomeDir(env), '.hasna', 'apps', 'notes');
  if (kind === 'server-nested') return join(getHomeDir(env), '.hasna', 'apps', 'notes-server');
  throw new Error('notes: migration source must be legacy, nested, or server-nested.');
}

function inspect(source, destination, path, entries, conflicts, skipped) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`notes: data migration refuses symbolic links (${relative(source, path)}).`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path).sort()) inspect(source, destination, join(path, name), entries, conflicts, skipped);
    return;
  }
  if (!stat.isFile()) throw new Error(`notes: data migration supports regular files only (${relative(source, path)}).`);
  const rel = relative(source, path);
  if (!rel || rel === RECEIPT) return;
  if (rel.endsWith('-shm')) {
    skipped.push(rel);
    return;
  }
  const target = join(destination, rel);
  assertSafeDestinationPath(destination, target);
  let state = 'copy';
  const targetStat = lstatIfPresent(target);
  if (targetStat) {
    if (targetStat.isSymbolicLink()) throw new Error(`notes: data migration refuses destination symbolic links (${rel}).`);
    if (!targetStat.isFile()) state = 'conflict';
    else state = stat.size === targetStat.size && digest(path) === digest(target) ? 'identical' : 'conflict';
  }
  if (state === 'conflict') conflicts.push(rel);
  entries.push({ rel, source: path, target, bytes: stat.size, state });
}

/** Build a read-only, content-safe migration plan. File contents and hashes are never returned. */
export function planNotesDataMigration({ env = process.env, source = 'legacy' } = {}) {
  const from = resolve(sourceRoot(source, env));
  const to = resolve(getResolverDataRoot(env));
  if (from === to) throw new Error('notes: migration source and XDG destination resolve to the same path.');
  if (existsSync(to) && lstatSync(to).isSymbolicLink()) {
    throw new Error('notes: data migration refuses a symbolic-link XDG destination.');
  }
  const entries = [];
  const conflicts = [];
  const skipped = [];
  if (existsSync(from)) inspect(from, to, from, entries, conflicts, skipped);
  return {
    source,
    from,
    to,
    sourcePresent: existsSync(from),
    files: entries.length,
    copyFiles: entries.filter((entry) => entry.state === 'copy').length,
    identicalFiles: entries.filter((entry) => entry.state === 'identical').length,
    conflictFiles: conflicts.length,
    skippedVolatileFiles: skipped.length,
    bytesToCopy: entries.filter((entry) => entry.state === 'copy').reduce((sum, entry) => sum + entry.bytes, 0),
    conflicts,
    entries,
  };
}

/** Copy a reviewed plan into the XDG root. Source data is preserved and existing files are never overwritten. */
export function applyNotesDataMigration(plan) {
  if (!plan?.sourcePresent) throw new Error('notes: migration source is absent.');
  if (plan.conflictFiles) throw new Error('notes: migration has destination conflicts; no files were copied.');
  const receiptPath = join(plan.to, RECEIPT);
  if (plan.copyFiles === 0 && existsSync(receiptPath)) {
    return {
      ok: true,
      copiedFiles: 0,
      identicalFiles: plan.identicalFiles,
      bytesCopied: 0,
      sourcePreserved: true,
      receipt: receiptPath,
    };
  }
  for (const entry of plan.entries) {
    if (entry.state !== 'copy') continue;
    const sourceStat = lstatIfPresent(entry.source);
    if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`notes: migration source changed after planning (${entry.rel}).`);
    }
    assertSafeDestinationPath(plan.to, entry.target);
    if (lstatIfPresent(entry.target)) throw new Error(`notes: migration destination changed after planning (${entry.rel}).`);
    mkdirSync(dirname(entry.target), { recursive: true, mode: 0o700 });
    copyFileSync(entry.source, entry.target, fsConstants.COPYFILE_EXCL);
    if (digest(entry.source) !== digest(entry.target)) {
      throw new Error(`notes: migration verification failed for ${entry.rel}.`);
    }
  }
  mkdirSync(plan.to, { recursive: true, mode: 0o700 });
  writeFileSync(receiptPath, JSON.stringify({
    schema: 'hasna.notes.data-migration.v1',
    source: plan.source,
    from: plan.from,
    to: plan.to,
    copiedFiles: plan.copyFiles,
    identicalFiles: plan.identicalFiles,
    completedAt: new Date().toISOString(),
    sourcePreserved: true,
  }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(receiptPath, 0o600);
  return {
    ok: true,
    copiedFiles: plan.copyFiles,
    identicalFiles: plan.identicalFiles,
    bytesCopied: plan.bytesToCopy,
    sourcePreserved: true,
    receipt: receiptPath,
  };
}
