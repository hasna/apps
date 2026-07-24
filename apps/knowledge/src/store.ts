/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  readSync,
  renameSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { ensureParentDir, globalKnowledgeHome, legacyGlobalStorePath, workspaceForHome } from './workspace';
import {
  AnchoredDirectoryHandle,
  readAnchoredRegularFileSnapshot,
} from './anchored-fs';
import {
  MAX_INGEST_BATCH_ITEMS,
  MAX_INGEST_BODY_BYTES,
  cloneBoundedDataGraph,
  parseBoundedJsonData,
} from './input-limits';

export interface KnowledgeItem {
  id: string;
  short_id?: string | null;
  title: string;
  content: string;
  url: string | null;
  tags: string[];
  metadata?: Record<string, unknown>;
  archived?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Store {
  items: KnowledgeItem[];
}

export function defaultStorePath(): string {
  return workspaceForHome(globalKnowledgeHome()).jsonStorePath;
}

export function ensureStore(path: string): void {
  const active = activeStoreLock(path);
  const exists = active ? readLockedStoreText(active) !== undefined : existsSync(path);
  if (!exists) {
    if (!active) ensureParentDir(path);
    let initial: string;
    if (path === defaultStorePath() && existsSync(legacyGlobalStorePath())) {
      const legacy = readAnchoredRegularFileSnapshot(
        resolve(legacyGlobalStorePath()),
        MAX_INGEST_BODY_BYTES,
      );
      if (!legacy) throw new Error('Legacy knowledge store disappeared during migration.');
      parseBoundedJsonData(legacy.content, 'Legacy knowledge store');
      initial = legacy.content;
    } else {
      initial = JSON.stringify({ items: [] }, null, 2);
    }
    if (active) writeLockedStoreText(active, initial);
    else writeFileSync(path, initial);
  }
}

export function loadStoreIfExists(path: string): Store & { exists: boolean } {
  const active = activeStoreLock(path);
  if (!active && !existsSync(path)) return { exists: false, items: [] };
  const raw = active
    ? readLockedStoreText(active)
    : readAnchoredRegularFileSnapshot(resolve(path), MAX_INGEST_BODY_BYTES)?.content;
  if (raw === undefined) return { exists: false, items: [] };
  const parsed = parseBoundedJsonData<Store>(raw, 'Persisted knowledge store');
  if (!parsed || !Array.isArray(parsed.items)) {
    return { exists: true, items: [] };
  }
  return { exists: true, items: parsed.items };
}

function lockPath(path: string): string {
  return `${path}.lock`;
}

function logicalLockName(storePath: string): string {
  const digest = createHash('sha256').update(storePath).digest('hex');
  return `.knowledge-store-logical-${digest}.lock`;
}

const MAX_LOCK_BYTES = 65_536;
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 50;

interface LockRecord {
  readonly version: 1;
  readonly owner: string;
  readonly token: string;
  readonly pid: number;
}

interface LockFileIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly size: number;
}

interface LockSnapshot {
  readonly record: LockRecord;
  readonly text: string;
  readonly identity: LockFileIdentity;
}

interface CreatedLock extends LockSnapshot {
  readonly path: string;
  readonly name: string;
}

interface LockOwnership extends CreatedLock {
  readonly parent: AnchoredDirectoryHandle;
}

export type StoreLockTestEvent =
  | 'before-create'
  | 'after-create'
  | 'before-stale-remove'
  | 'before-witness-link'
  | 'before-owned-unlink'
  | 'before-store-final-verify'
  | 'before-release';

export interface StoreLockTestDetail {
  readonly path: string;
  readonly owner: string;
  readonly token: string;
  readonly pid: number;
}

interface StoreLockTestControl {
  readonly monotonicNow?: () => number;
  readonly wait?: (milliseconds: number) => void;
  readonly onEvent?: (event: StoreLockTestEvent, detail: StoreLockTestDetail) => void;
}

let storeLockTestControl: StoreLockTestControl | undefined;

interface ActiveStoreLock {
  readonly storePath: string;
  readonly storeName: string;
  readonly parent: AnchoredDirectoryHandle;
  readonly ownership: LockOwnership;
}

const activeStoreLocks = new Map<string, ActiveStoreLock>();

/** Deterministic lock race control for repository tests; never exported by the package root. */
export function setStoreLockTestControl(control: StoreLockTestControl | undefined): void {
  storeLockTestControl = control;
}

function lockErrno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function monotonicNow(): number {
  return storeLockTestControl?.monotonicNow?.()
    ?? Number(process.hrtime.bigint() / 1_000_000n);
}

function waitMonotonically(milliseconds: number): void {
  if (storeLockTestControl?.wait) {
    storeLockTestControl.wait(milliseconds);
    return;
  }
  const waitCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(waitCell, 0, 0, milliseconds);
}

function fireLockTestEvent(event: StoreLockTestEvent, record: LockRecord, path: string): void {
  storeLockTestControl?.onEvent?.(event, Object.freeze({
    path,
    owner: record.owner,
    token: record.token,
    pid: record.pid,
  }));
}

function activeStoreLock(path: string): ActiveStoreLock | undefined {
  return activeStoreLocks.get(resolve(path));
}

function awaitLogicalStoreLock(storePath: string): void {
  const start = monotonicNow();
  while (activeStoreLocks.has(storePath)) {
    const elapsed = monotonicNow() - start;
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new Error('Knowledge lock monotonic clock is invalid.');
    }
    if (elapsed >= LOCK_WAIT_MS) {
      throw new Error(`Could not acquire lock on ${storePath} after ${LOCK_WAIT_MS}ms`);
    }
    waitMonotonically(Math.min(LOCK_RETRY_MS, LOCK_WAIT_MS - elapsed));
  }
}

function assertStoreStat(stat: Stats, label: string): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`${label} must remain one exact non-symlink regular file.`);
  }
  if (stat.size < 0 || stat.size > MAX_INGEST_BODY_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_INGEST_BODY_BYTES} byte hard limit.`);
  }
}

function sameStoreStat(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function readLockedStoreText(active: ActiveStoreLock): string | undefined {
  const { parent, storeName } = active;
  parent.verify();
  const before = parent.lstat(storeName);
  if (!before) return undefined;
  assertStoreStat(before, 'Locked Knowledge store');
  let fd: number | undefined;
  try {
    fd = parent.open(storeName, constants.O_RDONLY);
    const opened = fstatSync(fd) as Stats;
    assertStoreStat(opened, 'Opened locked Knowledge store');
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('Locked Knowledge store identity changed while opening.');
    }
    const buffer = Buffer.alloc(opened.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
    const after = fstatSync(fd) as Stats;
    const named = parent.lstat(storeName);
    parent.verify();
    if (
      bytesRead !== opened.size
      || !named
      || !sameStoreStat(opened, after)
      || !sameStoreStat(opened, named)
    ) {
      throw new Error('Locked Knowledge store identity or contents changed during read.');
    }
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function verifyInstalledStore(
  active: ActiveStoreLock,
  temporaryFd: number,
  body: string,
  expectedLinks: number,
): void {
  const expected = Buffer.from(body);
  const temporary = fstatSync(temporaryFd) as Stats;
  if (
    !temporary.isFile()
    || temporary.isSymbolicLink()
    || temporary.nlink !== expectedLinks
    || (temporary.mode & 0o777) !== 0o600
    || temporary.size !== expected.byteLength
  ) {
    throw new Error('Installed store temporary inode changed before final verification.');
  }
  let fd: number | undefined;
  try {
    fd = active.parent.open(active.storeName, constants.O_RDONLY);
    const opened = fstatSync(fd) as Stats;
    const named = active.parent.lstat(active.storeName);
    if (
      !named
      || !opened.isFile()
      || opened.isSymbolicLink()
      || !named.isFile()
      || named.isSymbolicLink()
      || opened.dev !== temporary.dev
      || opened.ino !== temporary.ino
      || named.dev !== temporary.dev
      || named.ino !== temporary.ino
      || opened.nlink !== expectedLinks
      || named.nlink !== expectedLinks
      || (opened.mode & 0o777) !== 0o600
      || (named.mode & 0o777) !== 0o600
      || opened.size !== expected.byteLength
      || named.size !== expected.byteLength
    ) {
      throw new Error('Installed store identity, mode, or size does not match the intended inode.');
    }
    const actual = Buffer.alloc(expected.byteLength + 1);
    let bytesRead = 0;
    while (bytesRead < actual.length) {
      const count = readSync(fd, actual, bytesRead, actual.length - bytesRead, bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead !== expected.byteLength || !actual.subarray(0, bytesRead).equals(expected)) {
      throw new Error('Installed store contents do not match the intended inode.');
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function rollbackLockedStoreInstall(
  active: ActiveStoreLock,
  temporaryFd: number,
  temporary: string,
  backup: string,
): void {
  const intended = fstatSync(temporaryFd) as Stats;
  const named = active.parent.lstat(active.storeName);
  if (named) {
    if (named.dev === intended.dev && named.ino === intended.ino) {
      active.parent.unlink(active.storeName);
    } else {
      active.parent.rename(
        active.storeName,
        `.knowledge-conflict-${process.pid}-${randomUUID()}`,
      );
    }
  }
  if (backup && active.parent.lstat(backup) && !active.parent.lstat(active.storeName)) {
    active.parent.rename(backup, active.storeName);
  }
  if (temporary && active.parent.lstat(temporary)) active.parent.unlink(temporary);
  active.parent.sync();
}

function writeLockedStoreText(active: ActiveStoreLock, body: string): void {
  const { parent, storeName } = active;
  parent.verify();
  const current = parent.lstat(storeName);
  if (current) assertStoreStat(current, 'Locked Knowledge store replacement target');
  const temporary = `${storeName}.tmp.${process.pid}.${randomUUID()}`;
  const backup = current ? `${storeName}.backup.${process.pid}.${randomUUID()}` : '';
  let fd: number | undefined;
  let targetLinked = false;
  let installed = false;
  try {
    fd = parent.open(
      temporary,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    fchmodSync(fd, 0o600);
    writeFileSync(fd, body);
    fsyncSync(fd);
    parent.verify();
    if (current) {
      parent.rename(storeName, backup);
      const moved = parent.lstat(backup);
      if (!moved || moved.dev !== current.dev || moved.ino !== current.ino) {
        throw new Error('Locked Knowledge store replacement identity changed before install.');
      }
    }
    try {
      parent.link(temporary, storeName);
      targetLinked = true;
    } catch {
      throw new Error('Locked Knowledge store target changed before no-clobber install.');
    }
    fireLockTestEvent('before-store-final-verify', active.ownership.record, active.storePath);
    verifyInstalledStore(active, fd, body, 2);
    parent.unlink(temporary);
    verifyInstalledStore(active, fd, body, 1);
    if (backup) parent.unlink(backup);
    parent.sync();
    parent.verify();
    installed = true;
  } finally {
    if (fd !== undefined) {
      if (!installed && targetLinked) {
        try {
          parent.verifyDescriptor();
          rollbackLockedStoreInstall(active, fd, temporary, backup);
        } catch {}
      } else if (!installed) {
        try {
          parent.verifyDescriptor();
          if (temporary && parent.lstat(temporary)) parent.unlink(temporary);
          if (backup && parent.lstat(backup) && !parent.lstat(storeName)) {
            parent.rename(backup, storeName);
          }
        } catch {}
      }
      closeSync(fd);
    }
  }
}

function lockIdentity(stat: Stats): LockFileIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode & 0o777,
    size: stat.size,
  };
}

function sameLockIdentity(left: LockFileIdentity, right: LockFileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size;
}

function assertLockStat(
  stat: Stats,
  expectedLinks: number,
): void {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Knowledge lock must be an exact non-symlink regular file.');
  }
  if (stat.nlink !== expectedLinks) {
    throw new Error('Knowledge lock identity has an unexpected hard-link count.');
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error('Knowledge lock confidentiality mode must be exactly 0600.');
  }
  if (stat.size <= 0 || stat.size > MAX_LOCK_BYTES) {
    throw new Error(`Knowledge lock exceeds the ${MAX_LOCK_BYTES} byte hard limit.`);
  }
}

function parseLockRecord(text: string): LockRecord {
  const parsed = parseBoundedJsonData<Partial<LockRecord>>(text, 'Knowledge lock');
  if (
    !parsed
    || Object.keys(parsed).sort().join(',') !== 'owner,pid,token,version'
    || parsed.version !== 1
    || typeof parsed.owner !== 'string'
    || parsed.owner.length === 0
    || parsed.owner.length > 128
    || typeof parsed.token !== 'string'
    || parsed.token.length === 0
    || parsed.token.length > 128
    || !Number.isSafeInteger(parsed.pid)
    || (parsed.pid ?? 0) <= 0
  ) {
    throw new Error('Knowledge lock record is invalid.');
  }
  return Object.freeze({
    version: 1,
    owner: parsed.owner,
    token: parsed.token,
    pid: parsed.pid,
  }) as LockRecord;
}

function verifyLockParent(parent: AnchoredDirectoryHandle, requireNamedParent: boolean): void {
  if (requireNamedParent) parent.verify();
  else parent.verifyDescriptor();
}

function readLockSnapshot(
  parent: AnchoredDirectoryHandle,
  name: string,
  expectedLinks = 1,
  requireNamedParent = true,
): LockSnapshot | undefined {
  verifyLockParent(parent, requireNamedParent);
  let before;
  try {
    before = parent.lstat(name) as Stats | undefined;
    if (!before) return undefined;
  } catch (error) {
    if (lockErrno(error) === 'ENOENT') return undefined;
    throw error;
  }
  assertLockStat(before, expectedLinks);
  let fd: number | undefined;
  try {
    try {
      fd = parent.open(name, constants.O_RDONLY);
    } catch (error) {
      if (lockErrno(error) === 'ENOENT') return undefined;
      throw new Error('Knowledge lock could not be opened without following links.');
    }
    const opened = fstatSync(fd) as Stats;
    assertLockStat(opened, expectedLinks);
    if (!sameLockIdentity(lockIdentity(before), lockIdentity(opened))) {
      throw new Error('Knowledge lock identity changed while opening.');
    }
    const buffer = Buffer.alloc(opened.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
    const after = fstatSync(fd) as Stats;
    verifyLockParent(parent, requireNamedParent);
    const named = parent.lstat(name);
    if (!named) return undefined;
    assertLockStat(after, expectedLinks);
    assertLockStat(named, expectedLinks);
    const identity = lockIdentity(opened);
    if (
      bytesRead !== opened.size
      || !sameLockIdentity(identity, lockIdentity(after))
      || !sameLockIdentity(identity, lockIdentity(named))
    ) {
      throw new Error('Knowledge lock identity or contents changed during inspection.');
    }
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return Object.freeze({ record: parseLockRecord(text), text, identity });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function createLock(
  parent: AnchoredDirectoryHandle,
  name: string,
  path: string,
  owner: string,
  token: string,
): CreatedLock | undefined {
  const record = Object.freeze({ version: 1, owner, token, pid: process.pid }) as LockRecord;
  const text = `${JSON.stringify(record)}\n`;
  let fd: number | undefined;
  let createdIdentity: LockFileIdentity | undefined;
  let createdInode: { dev: number; ino: number } | undefined;
  try {
    fireLockTestEvent('before-create', record, path);
    parent.verify();
    try {
      fd = parent.open(
        name,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
    } catch (error) {
      if (lockErrno(error) === 'EEXIST') return undefined;
      throw error;
    }
    fchmodSync(fd, 0o600);
    const created = fstatSync(fd) as Stats;
    createdInode = { dev: created.dev, ino: created.ino };
    writeFileSync(fd, text);
    fsyncSync(fd);
    const opened = fstatSync(fd) as Stats;
    assertLockStat(opened, 1);
    createdIdentity = lockIdentity(opened);
    closeSync(fd);
    fd = undefined;
    const snapshot = readLockSnapshot(parent, name);
    if (
      !snapshot
      || !sameLockIdentity(snapshot.identity, createdIdentity)
      || snapshot.text !== text
    ) {
      throw new Error('Knowledge lock creation identity could not be verified.');
    }
    fireLockTestEvent('after-create', record, path);
    parent.verify();
    return Object.freeze({ ...snapshot, path, name });
  } catch (error) {
    if (createdInode) {
      try {
        const named = parent.lstat(name);
        if (
          named
          && named.isFile()
          && !named.isSymbolicLink()
          && named.dev === createdInode.dev
          && named.ino === createdInode.ino
        ) parent.unlink(name);
      } catch {}
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function processIsDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return lockErrno(error) === 'ESRCH';
  }
}

function removeExactLock(
  parent: AnchoredDirectoryHandle,
  name: string,
  path: string,
  expected: LockSnapshot,
  requireNamedParent = true,
): boolean {
  verifyLockParent(parent, requireNamedParent);
  const current = readLockSnapshot(parent, name, 1, requireNamedParent);
  if (
    !current
    || !sameLockIdentity(current.identity, expected.identity)
    || current.text !== expected.text
  ) return false;

  const witness = `${name}.witness.${process.pid}.${randomUUID()}`;
  let witnessed = false;
  try {
    fireLockTestEvent('before-witness-link', current.record, path);
    verifyLockParent(parent, requireNamedParent);
    try {
      parent.link(name, witness);
      witnessed = true;
    } catch (error) {
      if (lockErrno(error) === 'ENOENT' || lockErrno(error) === 'EEXIST') return false;
      throw error;
    }
    const named = readLockSnapshot(parent, name, 2, requireNamedParent);
    const linked = readLockSnapshot(parent, witness, 2, requireNamedParent);
    if (
      !named
      || !linked
      || !sameLockIdentity(named.identity, expected.identity)
      || !sameLockIdentity(linked.identity, expected.identity)
      || named.text !== expected.text
      || linked.text !== expected.text
    ) return false;
    fireLockTestEvent('before-owned-unlink', current.record, path);
    verifyLockParent(parent, requireNamedParent);
    parent.unlink(name);
    const remaining = readLockSnapshot(parent, witness, 1, requireNamedParent);
    if (
      !remaining
      || !sameLockIdentity(remaining.identity, expected.identity)
      || remaining.text !== expected.text
    ) {
      throw new Error('Knowledge lock ownership witness changed during removal.');
    }
    verifyLockParent(parent, requireNamedParent);
    parent.unlink(witness);
    witnessed = false;
    return true;
  } finally {
    if (witnessed) {
      try { parent.unlink(witness); } catch {}
    }
  }
}

function acquireLock(
  parent: AnchoredDirectoryHandle,
  name: string,
  path: string,
  owner: string,
  token: string,
): LockOwnership {
  const start = monotonicNow();
  for (;;) {
    parent.verify();
    const created = createLock(parent, name, path, owner, token);
    if (created) {
      parent.verify();
      return Object.freeze({ ...created, parent });
    }

    parent.verify();
    const current = readLockSnapshot(parent, name);
    if (current && processIsDead(current.record.pid)) {
      fireLockTestEvent('before-stale-remove', current.record, path);
      parent.verify();
      if (removeExactLock(parent, name, path, current)) continue;
    }

    const elapsed = monotonicNow() - start;
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new Error('Knowledge lock monotonic clock is invalid.');
    }
    if (elapsed >= LOCK_WAIT_MS) {
      throw new Error(`Could not acquire lock on ${path} after ${LOCK_WAIT_MS}ms`);
    }
    waitMonotonically(Math.min(LOCK_RETRY_MS, LOCK_WAIT_MS - elapsed));
  }
}

function releaseLock(ownership: LockOwnership): void {
  fireLockTestEvent('before-release', ownership.record, ownership.path);
  try {
    ownership.parent.verifyDescriptor();
    const current = readLockSnapshot(ownership.parent, ownership.name, 1, false);
    if (
      !current
      || current.record.owner !== ownership.record.owner
      || current.record.token !== ownership.record.token
      || current.record.pid !== ownership.record.pid
      || !sameLockIdentity(current.identity, ownership.identity)
      || current.text !== ownership.text
    ) return;
    removeExactLock(
      ownership.parent,
      ownership.name,
      ownership.path,
      current,
      false,
    );
  } catch {
    // Ownership loss is fail-closed: leave the current name untouched.
  }
}

export function loadStore(path: string): Store {
  ensureStore(path);
  const active = activeStoreLock(path);
  const raw = active
    ? readLockedStoreText(active)
    : readAnchoredRegularFileSnapshot(resolve(path), MAX_INGEST_BODY_BYTES)?.content;
  if (raw === undefined) return { items: [] };
  const parsed = parseBoundedJsonData<Store>(raw, 'Persisted knowledge store');
  if (!parsed || !Array.isArray(parsed.items)) {
    return { items: [] };
  }
  return parsed;
}

export function saveStore(path: string, store: Store): void {
  const bounded = cloneBoundedDataGraph(store, {
    label: 'Knowledge store',
    maxBytes: MAX_INGEST_BODY_BYTES,
  });
  if (!Array.isArray(bounded.items) || bounded.items.length > MAX_INGEST_BATCH_ITEMS) {
    throw new Error(`Knowledge store exceeds the ${MAX_INGEST_BATCH_ITEMS} item hard limit.`);
  }
  const encoded = JSON.stringify(bounded, null, 2);
  if (Buffer.byteLength(encoded) > MAX_INGEST_BODY_BYTES) {
    throw new Error(`Knowledge store exceeds the ${MAX_INGEST_BODY_BYTES} byte hard limit.`);
  }
  const active = activeStoreLock(path);
  if (active) {
    writeLockedStoreText(active, encoded);
    return;
  }
  const tmp = `${path}.tmp.${randomUUID()}`;
  writeFileSync(tmp, encoded);
  renameSync(tmp, path);
}

export function withLock<T>(path: string, fn: () => T, options: { createParent?: boolean } = {}): T {
  const owner = randomUUID();
  const token = randomUUID();
  const storePath = resolve(path);
  const lpath = lockPath(storePath);
  awaitLogicalStoreLock(storePath);
  if (options.createParent) ensureParentDir(lpath);
  const parentPath = dirname(lpath);
  const logicalParentPath = dirname(parentPath);
  const logicalName = logicalLockName(storePath);
  const logicalPath = resolve(logicalParentPath, logicalName);
  const logicalParent = new AnchoredDirectoryHandle(logicalParentPath);
  let parent: AnchoredDirectoryHandle | undefined;
  let logicalOwnership: LockOwnership | undefined;
  let ownership: LockOwnership | undefined;
  let active: ActiveStoreLock | undefined;
  try {
    // Pin the target parent before acquiring the external logical guard. If
    // the named parent is replaced while the guard is acquired, the verify
    // immediately below aborts instead of adopting the replacement.
    parent = new AnchoredDirectoryHandle(parentPath);
    // The logical guard lives one directory above the mutable store parent.
    // A rename/recreate of the named parent therefore cannot let another
    // process acquire the same absolute store path while this owner is live.
    logicalOwnership = acquireLock(
      logicalParent,
      logicalName,
      logicalPath,
      owner,
      token,
    );
    parent.verify();
    ownership = acquireLock(parent, basename(lpath), lpath, owner, token);
    active = Object.freeze({
      storePath,
      storeName: basename(storePath),
      parent,
      ownership,
    });
    activeStoreLocks.set(storePath, active);
    return fn();
  } finally {
    if (active && activeStoreLocks.get(storePath) === active) activeStoreLocks.delete(storePath);
    if (ownership) releaseLock(ownership);
    parent?.close();
    if (logicalOwnership) releaseLock(logicalOwnership);
    logicalParent.close();
  }
}

export function makeId(): string {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeShortId(id: string): string {
  return id.replace(/^k_/, '').slice(0, 12);
}
