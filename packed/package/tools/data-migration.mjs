import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  readSync,
  readdirSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';
import { getHomeDir, getLegacyDataRoot, getResolverDataRoot } from '../server/paths.mjs';
import { directorySession, openAt, sameDirectory } from './migration-fs.mjs';

const RECEIPT = '.notes-data-migration.json';
const PLAN_SCHEMA = 'hasna.notes.data-migration-plan.v2';
const COPY_BUFFER_BYTES = 64 * 1024;
// Stage reviewed bytes before writing anything; large offline archives require
// a separately reviewed import instead of unbounded process memory.
const MAX_STAGED_BYTES = 256 * 1024 * 1024;

function lstatIfPresent(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function identity(stat) {
  return {
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    mode: Number(stat.mode),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs),
  };
}

function sameIdentity(a, b) {
  return !!a && !!b && Object.keys(a).every((key) => a[key] === b[key]);
}

function directoryIdentity(stat) {
  return { dev: Number(stat.dev), ino: Number(stat.ino), mode: Number(stat.mode) };
}

function digestFd(fd) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
  let position = 0;
  while (true) {
    const count = readSync(fd, buffer, 0, buffer.length, position);
    if (!count) break;
    hash.update(buffer.subarray(0, count));
    position += count;
  }
  return hash.digest('hex');
}

function inspectRegularFile(path, label) {
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`notes: data migration requires a regular ${label}.`);
  }
  const directories = directorySession();
  let fd;
  try {
    const parent = directories.open(dirname(path));
    fd = openAt(parent, basename(path), constants.O_RDONLY | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    const sha256 = digestFd(fd);
    const after = fstatSync(fd);
    if (!sameIdentity(identity(before), identity(opened)) || !sameIdentity(identity(opened), identity(after))) {
      throw new Error(`notes: ${label} changed while it was inspected.`);
    }
    return { identity: identity(opened), sha256 };
  } finally {
    if (fd !== undefined) closeSync(fd);
    directories.close();
  }
}

function directoryChain(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  const chain = [];
  let cursor = root;
  for (const part of parts) {
    cursor = join(cursor, part);
    const stat = lstatIfPresent(cursor);
    if (!stat) {
      chain.push({ path: cursor, identity: null });
      continue;
    }
    if (stat.isSymbolicLink()) throw new Error(`notes: data migration refuses symbolic-link path components (${cursor}).`);
    if (!stat.isDirectory()) throw new Error(`notes: data migration path component is not a directory (${cursor}).`);
    chain.push({ path: cursor, identity: directoryIdentity(stat) });
  }
  return chain;
}

function validateDirectoryChain(chain, { allowCreated = false } = {}) {
  for (const item of chain) {
    const stat = lstatIfPresent(item.path);
    if (!stat) {
      if (item.identity) throw new Error('notes: data migration directory was removed after planning.');
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('notes: data migration directory was replaced by an unsafe path after planning.');
    }
    if (item.identity && !sameDirectory(item.identity, stat)) {
      throw new Error('notes: data migration directory identity changed after planning.');
    }
    if (!item.identity && !allowCreated) {
      throw new Error('notes: data migration destination appeared after planning.');
    }
  }
}

function relativeParentStates(root, target) {
  const rel = relative(root, dirname(target));
  if (!rel) return [];
  if (rel.startsWith('..') || resolve(target) === resolve(root)) {
    throw new Error('notes: migration target escapes the XDG destination.');
  }
  const states = [];
  let cursor = root;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    const stat = lstatIfPresent(cursor);
    if (!stat) states.push({ path: cursor, identity: null });
    else {
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`notes: data migration refuses unsafe destination parents (${relative(root, cursor)}).`);
      }
      states.push({ path: cursor, identity: directoryIdentity(stat) });
    }
  }
  return states;
}

function sourceRoot(kind, env) {
  if (kind === 'legacy') return getLegacyDataRoot(env);
  if (kind === 'nested') return join(getHomeDir(env), '.hasna', 'apps', 'notes');
  if (kind === 'server-nested') return join(getHomeDir(env), '.hasna', 'apps', 'notes-server');
  throw new Error('notes: migration source must be legacy, nested, or server-nested.');
}

function inspectTree(source, destination, path, entries, conflicts, skipped, sourceTree) {
  const stat = lstatSync(path);
  const rel = relative(source, path);
  if (stat.isSymbolicLink()) throw new Error(`notes: data migration refuses symbolic links (${rel}).`);
  if (stat.isDirectory()) {
    sourceTree.push({ path, identity: identity(stat) });
    for (const name of readdirSync(path).sort()) {
      inspectTree(source, destination, join(path, name), entries, conflicts, skipped, sourceTree);
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`notes: data migration supports regular files only (${rel}).`);
  if (!rel || rel === RECEIPT) return;
  if (rel.endsWith('-shm')) {
    skipped.push(rel);
    return;
  }

  const target = join(destination, rel);
  const sourceBinding = inspectRegularFile(path, `source file ${rel}`);
  const targetStat = lstatIfPresent(target);
  let state = 'copy';
  let targetBinding = null;
  if (targetStat) {
    if (targetStat.isSymbolicLink()) throw new Error(`notes: data migration refuses destination symbolic links (${rel}).`);
    if (!targetStat.isFile()) state = 'conflict';
    else {
      targetBinding = inspectRegularFile(target, `destination file ${rel}`);
      state = sourceBinding.identity.size === targetBinding.identity.size && sourceBinding.sha256 === targetBinding.sha256
        ? 'identical'
        : 'conflict';
    }
  }
  if (state === 'conflict') conflicts.push(rel);
  entries.push({
    rel,
    source: path,
    target,
    bytes: sourceBinding.identity.size,
    state,
    sourceBinding,
    sourceParents: directoryChain(dirname(path)),
    targetBinding,
    targetParents: relativeParentStates(destination, target),
  });
}

function planPayload(plan) {
  const { fingerprint, ...payload } = plan;
  return payload;
}

function planDigest(plan) {
  return createHash('sha256').update(JSON.stringify(planPayload(plan))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

/** Build a read-only plan bound to source bytes/metadata and destination identities. */
export function planNotesDataMigration({ env = process.env, source = 'legacy' } = {}) {
  const from = resolve(sourceRoot(source, env));
  const to = resolve(getResolverDataRoot(env));
  if (from === to) throw new Error('notes: migration source and XDG destination resolve to the same path.');
  const sourcePresent = existsSync(from);
  const sourceDirectories = sourcePresent ? directoryChain(from) : directoryChain(dirname(from));
  const destinationDirectories = directoryChain(to);
  const entries = [];
  const conflicts = [];
  const skipped = [];
  const sourceTree = [];
  if (sourcePresent) inspectTree(from, to, from, entries, conflicts, skipped, sourceTree);
  const plan = {
    schema: PLAN_SCHEMA,
    source,
    from,
    to,
    sourcePresent,
    sourceDirectories,
    sourceTree,
    destinationDirectories,
    files: entries.length,
    copyFiles: entries.filter((entry) => entry.state === 'copy').length,
    identicalFiles: entries.filter((entry) => entry.state === 'identical').length,
    conflictFiles: conflicts.length,
    bytesToCopy: entries.filter((entry) => entry.state === 'copy').reduce((sum, entry) => sum + entry.bytes, 0),
    conflicts,
    skippedVolatileFiles: skipped.length,
    entries,
  };
  plan.fingerprint = planDigest(plan);
  return deepFreeze(plan);
}

function openBoundFile(directories, path, binding, label) {
  const parent = directories.open(dirname(path));
  const fd = openAt(parent, basename(path), constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || !sameIdentity(binding.identity, identity(before)) || digestFd(fd) !== binding.sha256
      || !sameIdentity(binding.identity, identity(fstatSync(fd)))) {
      throw new Error(`notes: ${label} changed after planning.`);
    }
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}

function sourceDigest(plan) {
  return createHash('sha256').update(JSON.stringify(plan.entries.map(({ rel, sourceBinding }) => ({ rel, sourceBinding })))).digest('hex');
}

function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(fd, buffer, offset, buffer.length - offset);
    if (!written) throw new Error('notes: migration write made no progress.');
    offset += written;
  }
  fchmodSync(fd, 0o600);
  fsyncSync(fd);
}

/** Apply only reviewed bytes. Hooks are internal deterministic race-test seams;
 * they cannot substitute IO or disable validation and are not package exports.
 * An interrupted operation may leave verified copies but never overwrites data.
 */
export function applyNotesDataMigration(plan, { checkpoint = () => {} } = {}) {
  if (!plan || plan.schema !== PLAN_SCHEMA || plan.fingerprint !== planDigest(plan)) {
    throw new Error('notes: migration plan is invalid or changed after review.');
  }
  if (!plan.sourcePresent) throw new Error('notes: migration source is absent.');
  if (plan.entries.some((entry) => entry.state === 'conflict')) {
    throw new Error('notes: migration has destination conflicts; no files were copied.');
  }
  if (plan.entries.reduce((sum, entry) => sum + entry.bytes, 0) > MAX_STAGED_BYTES) {
    throw new Error('notes: migration exceeds the 256 MiB reviewed-snapshot limit; use a separately reviewed offline import.');
  }
  validateDirectoryChain(plan.sourceDirectories);
  validateDirectoryChain(plan.destinationDirectories);
  for (const entry of plan.entries) {
    validateDirectoryChain(entry.sourceParents);
    validateDirectoryChain(entry.targetParents);
    if (entry.state === 'copy' && lstatIfPresent(entry.target)) {
      throw new Error('notes: migration destination changed after planning.');
    }
  }

  const sources = directorySession([...plan.sourceDirectories, ...plan.entries.flatMap((entry) => entry.sourceParents)]);
  const targets = directorySession([...plan.destinationDirectories, ...plan.entries.flatMap((entry) => entry.targetParents)]);
  const staged = [];
  const verifiedTargets = [];
  const receiptPath = join(plan.to, RECEIPT);
  try {
    // Read and verify every source before creating any destination. The snapshot
    // is immutable to outside writers; mutations can never change copied bytes.
    for (const entry of plan.entries) {
      const fd = openBoundFile(sources, entry.source, entry.sourceBinding, `source file ${entry.rel}`);
      staged.push({ entry, fd, bytes: Buffer.alloc(entry.bytes) });
      const item = staged.at(-1);
      let position = 0;
      while (position < item.bytes.length) {
        const count = readSync(fd, item.bytes, position, item.bytes.length - position, position);
        if (!count) throw new Error('notes: source changed during migration snapshot.');
        position += count;
      }
      checkpoint('source-staged', entry.rel);
      if (!sameIdentity(entry.sourceBinding.identity, identity(fstatSync(fd)))
        || createHash('sha256').update(item.bytes).digest('hex') !== entry.sourceBinding.sha256
        || digestFd(fd) !== entry.sourceBinding.sha256) {
        throw new Error('notes: source changed during migration snapshot.');
      }
      if (entry.state === 'identical') {
        const targetFd = openBoundFile(targets, entry.target, entry.targetBinding, `destination file ${entry.rel}`);
        closeSync(targetFd);
        verifiedTargets.push({ path: entry.target, binding: entry.targetBinding });
      }
    }
    const validateSources = () => {
      sources.assertLinked();
      for (const directory of plan.sourceTree) {
        if (!sameIdentity(directory.identity, identity(fstatSync(sources.open(directory.path))))) {
          throw new Error('notes: source directory contents changed after planning.');
        }
      }
      for (const { entry, fd } of staged) {
        if (!sameIdentity(entry.sourceBinding.identity, identity(fstatSync(fd))) || digestFd(fd) !== entry.sourceBinding.sha256) {
          throw new Error('notes: source changed during migration.');
        }
        // Also detect replacing the name while the original FD remains open.
        const current = openBoundFile(sources, entry.source, entry.sourceBinding, 'source file');
        closeSync(current);
      }
    };
    const validateTargets = () => {
      targets.assertLinked();
      for (const { path, binding } of verifiedTargets) {
        const fd = openBoundFile(targets, path, binding, 'destination file');
        closeSync(fd);
      }
    };
    validateSources();

    const existingReceipt = lstatIfPresent(receiptPath);
    if (existingReceipt) {
      if (existingReceipt.isSymbolicLink() || !existingReceipt.isFile() || (existingReceipt.mode & 0o077)) {
        throw new Error('notes: migration receipt is unsafe; refusing to overwrite or follow it.');
      }
      if (plan.copyFiles) throw new Error('notes: a migration receipt already exists; refusing an incremental overwrite.');
      const fd = openAt(targets.open(plan.to), RECEIPT, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 16384) throw new Error('notes: unsafe migration receipt.');
        const data = Buffer.alloc(stat.size);
        if (readSync(fd, data, 0, data.length, 0) !== data.length) throw new Error('notes: incomplete migration receipt.');
        let receipt;
        try { receipt = JSON.parse(data.toString()); } catch { throw new Error('notes: invalid migration receipt.'); }
        if (receipt.schema !== 'hasna.notes.data-migration.v2' || receipt.sourceDigest !== sourceDigest(plan)
          || receipt.from !== plan.from || receipt.to !== plan.to || receipt.sourcePreserved !== true) {
          throw new Error('notes: existing migration receipt does not match this source snapshot.');
        }
      } finally { closeSync(fd); }
      validateTargets();
      return { ok: true, copiedFiles: 0, identicalFiles: plan.identicalFiles, bytesCopied: 0, sourcePreserved: true, receipt: receiptPath };
    }

    const rootFd = targets.open(plan.to, true);
    checkpoint('destination-opened');
    targets.assertLinked();
    for (const { entry, bytes } of staged) {
      if (entry.state !== 'copy') continue;
      const parentFd = targets.open(dirname(entry.target), true);
      validateSources();
      targets.assertLinked();
      checkpoint('before-copy-open', entry.rel);
      // Exclusive descriptor-relative creation: no leaf or ancestor symlink can
      // redirect this write, even if names change immediately after validation.
      const fd = openAt(parentFd, basename(entry.target), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        writeAll(fd, bytes);
        if (digestFd(fd) !== entry.sourceBinding.sha256) throw new Error('notes: migration copy verification failed.');
        verifiedTargets.push({ path: entry.target, binding: { identity: identity(fstatSync(fd)), sha256: entry.sourceBinding.sha256 } });
      } finally { closeSync(fd); }
      targets.assertLinked();
    }
    validateSources();
    validateTargets();
    const receipt = Buffer.from(JSON.stringify({
      schema: 'hasna.notes.data-migration.v2',
      planFingerprint: plan.fingerprint,
      sourceDigest: sourceDigest(plan),
      source: plan.source, from: plan.from, to: plan.to,
      copiedFiles: plan.copyFiles, identicalFiles: plan.identicalFiles,
      completedAt: new Date().toISOString(), sourcePreserved: true,
    }, null, 2) + '\n');
    checkpoint('before-receipt-open');
    validateSources();
    validateTargets();
    const fd = openAt(rootFd, RECEIPT, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { writeAll(fd, receipt); } finally { closeSync(fd); }
    validateTargets();
    validateSources();
    return { ok: true, copiedFiles: plan.copyFiles, identicalFiles: plan.identicalFiles,
      bytesCopied: plan.bytesToCopy, sourcePreserved: true, receipt: receiptPath };
  } finally {
    for (const { fd } of staged) closeSync(fd);
    sources.close();
    targets.close();
  }
}
