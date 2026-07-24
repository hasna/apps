import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, normalize, resolve, sep } from 'node:path';

export class AnchoredFilesystemError extends Error {
  readonly name = 'AnchoredFilesystemError';
}

export interface AnchoredIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
}

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
export const MAX_ANCHORED_CONFIG_BYTES = 1_048_576;
export const MAX_ANCHORED_ARTIFACT_BYTES = 8_388_608;
export const MAX_ANCHORED_ARTIFACT_NODES = 4_096;

export const ANCHORED_FILESYSTEM_SUPPORT = Object.freeze({
  supportedPlatforms: ['linux', 'darwin'] as const,
  unsupportedBehavior: 'fail-closed-before-filesystem-io' as const,
});

function fail(detail: string): never {
  throw new AnchoredFilesystemError(detail);
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

export function assertAnchoredFilesystemPlatform(
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'linux' && platform !== 'darwin') {
    fail(`directory-FD anchoring is unsupported on ${platform}; local filesystem access is disabled`);
  }
}

function fdBase(): string {
  assertAnchoredFilesystemPlatform();
  if (
    typeof constants.O_NOFOLLOW !== 'number'
    || typeof constants.O_DIRECTORY !== 'number'
  ) {
    return fail('directory-FD anchoring is unavailable on this platform');
  }
  if (existsSync('/proc/self/fd')) return '/proc/self/fd';
  if (existsSync('/dev/fd')) return '/dev/fd';
  return fail('directory-FD anchoring is unavailable on this platform');
}

export type AnchoredFsTestEvent =
  | 'config-before-parent-check'
  | 'config-before-target-move'
  | 'config-before-final-verify'
  | 'snapshot-before-read'
  | 'snapshot-after-read'
  | 'artifact-before-read'
  | 'artifact-before-component-open'
  | 'artifact-before-final-verify'
  | 'database-before-constructor'
  | 'database-before-migration';

let anchoredFsTestHook: ((event: AnchoredFsTestEvent, detail: string) => void) | undefined;

/** Deterministic race injection for repository tests; never exported by the package root. */
export function setAnchoredFsTestHook(
  hook: ((event: AnchoredFsTestEvent, detail: string) => void) | undefined,
): void {
  anchoredFsTestHook = hook;
}

function fireTestHook(event: AnchoredFsTestEvent, detail: string): void {
  anchoredFsTestHook?.(event, detail);
}

function fdPath(fd: number, name?: string): string {
  const base = `${fdBase()}/${fd}`;
  return name === undefined ? base : `${base}/${name}`;
}

function identity(stat: Stats): AnchoredIdentity {
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777 };
}

function sameIdentity(left: AnchoredIdentity, right: AnchoredIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameIdentityAndMode(left: AnchoredIdentity, right: AnchoredIdentity): boolean {
  return sameIdentity(left, right) && left.mode === right.mode;
}

function assertDirectoryStat(stat: Stats, detail: string): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(detail);
}

function assertRegularStat(stat: Stats, detail: string): void {
  if (!stat.isFile() || stat.isSymbolicLink()) fail(detail);
}

function absoluteSegments(path: string): string[] {
  if (!isAbsolute(path) || normalize(path) !== path || resolve(path) !== path) {
    return fail('anchored path must be absolute and traversal-free');
  }
  return path.split(sep).filter(Boolean);
}

function relativeSegments(path: string): string[] {
  if (!path || isAbsolute(path) || path.includes('\0')) {
    return fail('anchored relative path is invalid');
  }
  const segments = path.replace(/\\/g, '/').split('/');
  if (segments.some((part) => !part || part === '.' || part === '..')) {
    return fail('anchored relative path contains an unsafe component');
  }
  return segments;
}

function openDirectoryPath(path: string, create: boolean, mode = 0o700): number {
  assertAnchoredFilesystemPlatform();
  const segments = absoluteSegments(path);
  let current: number | undefined;
  try {
    current = openSync('/', DIRECTORY_FLAGS);
    for (const segment of segments) {
      const child = fdPath(current, segment);
      if (create) {
        try {
          mkdirSync(child, { mode });
        } catch (error) {
          if (errno(error) !== 'EEXIST') throw error;
        }
      }
      let next: number;
      try {
        next = openSync(child, DIRECTORY_FLAGS);
      } catch (error) {
        if (errno(error) === 'ENOENT') throw error;
        return fail('directory component could not be opened without following links');
      }
      assertDirectoryStat(fstatSync(next), 'opened path component is not a directory');
      closeSync(current);
      current = next;
    }
    const result = current;
    current = undefined;
    return result;
  } finally {
    if (current !== undefined) closeSync(current);
  }
}

function pathDirectoryIdentity(path: string): AnchoredIdentity | undefined {
  let fd: number | undefined;
  try {
    fd = openDirectoryPath(path, false);
    return identity(fstatSync(fd));
  } catch (error) {
    if (errno(error) === 'ENOENT') return undefined;
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function assertDirectoryName(path: string, expected: AnchoredIdentity): void {
  const current = pathDirectoryIdentity(path);
  if (!current || !sameIdentityAndMode(current, expected)) {
    fail('anchored directory identity or confidentiality mode changed during the operation');
  }
}

function assertExactMode(stat: Stats, expectedMode: number, detail: string): void {
  if ((stat.mode & 0o777) !== expectedMode) fail(detail);
}

function assertArtifactFileStat(stat: Stats, detail: string): void {
  assertRegularStat(stat, detail);
  if (stat.nlink !== 1) fail('artifact file has multiple hard links');
  assertExactMode(stat, 0o600, 'artifact file confidentiality mode must be exactly 0600');
}

function lstatChild(fd: number, name: string): Stats | undefined {
  try {
    return lstatSync(fdPath(fd, name));
  } catch (error) {
    if (errno(error) === 'ENOENT') return undefined;
    throw error;
  }
}

function openChildDirectory(parentFd: number, name: string, create: boolean): number {
  const child = fdPath(parentFd, name);
  if (create) {
    try {
      mkdirSync(child, { mode: 0o700 });
    } catch (error) {
      if (errno(error) !== 'EEXIST') throw error;
    }
  }
  fireTestHook('artifact-before-component-open', name);
  try {
    const fd = openSync(child, DIRECTORY_FLAGS);
    const opened = fstatSync(fd);
    assertDirectoryStat(opened, 'artifact path component is not a directory');
    assertExactMode(opened, 0o700, 'artifact directory confidentiality mode must be exactly 0700');
    return fd;
  } catch (error) {
    if (error instanceof AnchoredFilesystemError || errno(error) === 'ENOENT') throw error;
    return fail('artifact path component could not be opened without following links');
  }
}

function openRelativeParent(rootFd: number, parts: readonly string[], create: boolean): number {
  // `/proc/self/fd/<n>` is itself a magic symlink. Addressing its `.` child
  // duplicates the opened directory without relaxing O_NOFOLLOW on components.
  let current = openSync(fdPath(rootFd, '.'), DIRECTORY_FLAGS);
  try {
    for (const part of parts) {
      const next = openChildDirectory(current, part, create);
      closeSync(current);
      current = next;
    }
    const result = current;
    current = -1;
    return result;
  } finally {
    if (current >= 0) closeSync(current);
  }
}

function openVerifiedRegular(parentFd: number, name: string, flags: number): number {
  const before = lstatChild(parentFd, name);
  if (!before) {
    const missing = new Error(`ENOENT: no such file, open '${name}'`) as NodeJS.ErrnoException;
    missing.code = 'ENOENT';
    throw missing;
  }
  assertRegularStat(before, 'anchored file must be a non-symlink regular file');
  let fd: number | undefined;
  try {
    fd = openSync(fdPath(parentFd, name), flags | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    assertRegularStat(opened, 'opened file must be regular');
    const named = lstatChild(parentFd, name);
    if (!named || !sameIdentity(identity(opened), identity(named))) {
      fail('file identity changed while it was opened');
    }
    const result = fd;
    fd = undefined;
    return result;
  } catch (error) {
    if (error instanceof AnchoredFilesystemError || errno(error) === 'ENOENT') throw error;
    return fail('file could not be opened without following links');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function createTemporary(parentFd: number, mode: number): { fd: number; name: string } {
  const name = `.knowledge-tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(
    fdPath(parentFd, name),
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    mode,
  );
  fchmodSync(fd, mode);
  return { fd, name };
}

function readExactFileDescriptor(fd: number, size: number): Buffer {
  const buffer = Buffer.alloc(size + 1);
  let bytesRead = 0;
  while (bytesRead < buffer.length) {
    const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
    if (count === 0) break;
    bytesRead += count;
  }
  if (bytesRead !== size) fail('installed file content size changed during final verification');
  return buffer.subarray(0, bytesRead);
}

function verifyInstalledTemporary(
  parentFd: number,
  name: string,
  temporaryFd: number,
  expectedBody: string | Uint8Array,
  expectedMode: number,
  expectedLinks: number,
): Stats {
  const temporary = fstatSync(temporaryFd);
  assertRegularStat(temporary, 'temporary install inode is not a regular file');
  assertExactMode(temporary, expectedMode, 'temporary install mode changed');
  if (temporary.nlink !== expectedLinks) fail('temporary install hard-link count changed');
  const expected = typeof expectedBody === 'string' ? Buffer.from(expectedBody) : Buffer.from(expectedBody);
  if (temporary.size !== expected.byteLength) fail('temporary install size changed');

  let finalFd: number | undefined;
  try {
    finalFd = openVerifiedRegular(parentFd, name, FILE_READ_FLAGS);
    const opened = fstatSync(finalFd);
    const named = lstatChild(parentFd, name);
    if (
      !named
      || !opened.isFile()
      || opened.isSymbolicLink()
      || !named.isFile()
      || named.isSymbolicLink()
      || opened.nlink !== expectedLinks
      || named.nlink !== expectedLinks
      || !sameIdentity(identity(temporary), identity(opened))
      || !sameIdentity(identity(temporary), identity(named))
      || (opened.mode & 0o777) !== expectedMode
      || (named.mode & 0o777) !== expectedMode
      || opened.size !== expected.byteLength
      || named.size !== expected.byteLength
    ) {
      fail('installed file identity, type, mode, or size does not match the intended temporary inode');
    }
    const actual = readExactFileDescriptor(finalFd, opened.size);
    const after = fstatSync(finalFd);
    if (
      !actual.equals(expected)
      || !sameIdentity(identity(opened), identity(after))
      || after.size !== opened.size
      || after.nlink !== expectedLinks
    ) {
      fail('installed file content does not match the intended temporary inode');
    }
    return named;
  } finally {
    if (finalFd !== undefined) closeSync(finalFd);
  }
}

function rollbackTemporaryInstall(
  parentFd: number,
  target: string,
  temporaryFd: number,
  backup: string,
): void {
  const temporary = fstatSync(temporaryFd);
  const current = lstatChild(parentFd, target);
  if (current && sameIdentity(identity(current), identity(temporary))) {
    try { unlinkSync(fdPath(parentFd, target)); } catch {}
  } else if (current && backup) {
    const conflict = `.knowledge-conflict-${process.pid}-${randomUUID()}`;
    try {
      renameSync(fdPath(parentFd, target), fdPath(parentFd, conflict));
    } catch {
      return;
    }
  }
  if (backup) restoreRegularBackup(parentFd, backup, target);
}

function restoreRegularBackup(parentFd: number, backup: string, target: string): void {
  if (!lstatChild(parentFd, backup) || lstatChild(parentFd, target)) return;
  try {
    linkSync(fdPath(parentFd, backup), fdPath(parentFd, target));
    unlinkSync(fdPath(parentFd, backup));
  } catch {
    // Preserve the backup rather than overwrite a racing target.
  }
}

/** Ensure a directory using only no-follow component opens rooted at `/`. */
export function ensureAnchoredDirectory(path: string, mode = 0o700): AnchoredIdentity {
  let fd: number | undefined;
  try {
    fd = openDirectoryPath(path, true, mode);
    const opened = fstatSync(fd);
    assertDirectoryStat(opened, 'anchored path is not a directory');
    assertExactMode(opened, mode, `anchored directory confidentiality mode must be exactly ${mode.toString(8)}`);
    return identity(opened);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Inspect an existing directory without following any path component. */
export function anchoredDirectoryIdentity(path: string): AnchoredIdentity | undefined {
  return pathDirectoryIdentity(path);
}

/** Open one directory identity and keep every child operation fd-relative. */
export class AnchoredDirectoryHandle {
  readonly identity: AnchoredIdentity;
  private fd: number | undefined;

  constructor(readonly path: string) {
    this.fd = openDirectoryPath(path, false);
    const opened = fstatSync(this.fd);
    assertDirectoryStat(opened, 'anchored parent handle is not a directory');
    this.identity = Object.freeze(identity(opened));
    assertDirectoryName(path, this.identity);
  }

  private descriptor(): number {
    if (this.fd === undefined) fail('anchored parent handle is closed');
    return this.fd;
  }

  private safeName(name: string): string {
    const parts = relativeSegments(name);
    if (parts.length !== 1) fail('anchored child name must contain exactly one safe component');
    return parts[0];
  }

  private child(name: string): string {
    return fdPath(this.descriptor(), this.safeName(name));
  }

  verifyDescriptor(): void {
    const descriptor = this.descriptor();
    const stat = fstatSync(descriptor);
    assertDirectoryStat(stat, 'anchored parent descriptor is no longer a directory');
    const opened = identity(stat);
    if (!sameIdentityAndMode(opened, this.identity)) fail('anchored parent descriptor identity changed');
  }

  verify(): void {
    this.verifyDescriptor();
    assertDirectoryName(this.path, this.identity);
  }

  lstat(name: string): Stats | undefined {
    return lstatChild(this.descriptor(), this.safeName(name));
  }

  open(name: string, flags: number, mode?: number): number {
    const safeName = this.safeName(name);
    return openSync(fdPath(this.descriptor(), safeName), flags | constants.O_NOFOLLOW, mode);
  }

  link(source: string, target: string): void {
    linkSync(this.child(source), this.child(target));
  }

  rename(source: string, target: string): void {
    renameSync(this.child(source), this.child(target));
  }

  unlink(name: string): void {
    unlinkSync(this.child(name));
  }

  sync(): void {
    fsyncSync(this.descriptor());
  }

  close(): void {
    if (this.fd === undefined) return;
    closeSync(this.fd);
    this.fd = undefined;
  }
}

export interface AnchoredMutableFileSnapshot {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly size: number;
  readonly nlink: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

function mutableFileSnapshot(stat: Stats): AnchoredMutableFileSnapshot {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode & 0o777,
    size: stat.size,
    nlink: stat.nlink,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  });
}

function sameMutableFileSnapshot(
  left: AnchoredMutableFileSnapshot,
  right: AnchoredMutableFileSnapshot,
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.nlink === right.nlink
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

/** A no-follow, parent-fd-anchored regular file kept open for identity-bound consumers. */
export class AnchoredMutableFileHandle {
  readonly descriptorPath: string;
  readonly initial: AnchoredMutableFileSnapshot;
  private fd: number | undefined;

  constructor(
    private readonly parent: AnchoredDirectoryHandle,
    readonly name: string,
    fd: number,
  ) {
    this.fd = fd;
    this.descriptorPath = fdPath(fd);
    this.initial = this.verifyIdentity();
  }

  private descriptor(): number {
    if (this.fd === undefined) fail('anchored file handle is closed');
    return this.fd;
  }

  snapshot(): AnchoredMutableFileSnapshot {
    return mutableFileSnapshot(fstatSync(this.descriptor()));
  }

  verifyIdentity(): AnchoredMutableFileSnapshot {
    this.parent.verify();
    const opened = fstatSync(this.descriptor());
    const named = this.parent.lstat(this.name);
    if (
      !opened.isFile()
      || opened.isSymbolicLink()
      || opened.nlink !== 1
      || !named
      || !named.isFile()
      || named.isSymbolicLink()
      || named.nlink !== 1
      || opened.dev !== named.dev
      || opened.ino !== named.ino
      || (opened.mode & 0o777) !== (named.mode & 0o777)
    ) {
      fail('anchored database identity must remain one canonical regular file');
    }
    return mutableFileSnapshot(opened);
  }

  verifyUnchanged(expected: AnchoredMutableFileSnapshot): AnchoredMutableFileSnapshot {
    const current = this.verifyIdentity();
    if (!sameMutableFileSnapshot(current, expected)) {
      fail('anchored database identity or contents changed before the next operation');
    }
    return current;
  }

  close(): void {
    if (this.fd !== undefined) {
      closeSync(this.fd);
      this.fd = undefined;
    }
    this.parent.close();
  }
}

export function openAnchoredMutableRegularFile(
  path: string,
  options: { create?: boolean; mode?: number } = {},
): AnchoredMutableFileHandle {
  const parent = new AnchoredDirectoryHandle(dirname(path));
  const name = basename(path);
  let fd: number | undefined;
  try {
    const existing = parent.lstat(name);
    if (existing) {
      assertRegularStat(existing, 'anchored database target must be a non-symlink regular file');
      if (existing.nlink !== 1) fail('anchored database target must not have hard links');
      fd = parent.open(name, constants.O_RDWR);
    } else {
      if (options.create !== true) {
        const missing = new Error(`ENOENT: no such file, open '${name}'`) as NodeJS.ErrnoException;
        missing.code = 'ENOENT';
        throw missing;
      }
      fd = parent.open(
        name,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL,
        options.mode ?? 0o600,
      );
      fchmodSync(fd, options.mode ?? 0o600);
      fsyncSync(fd);
      parent.sync();
    }
    const handle = new AnchoredMutableFileHandle(parent, name, fd);
    fd = undefined;
    return handle;
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    parent.close();
    throw error;
  }
}

/** Read a regular file relative to an opened, no-follow parent chain. */
export interface AnchoredRegularFileSnapshot {
  readonly content: string;
  readonly identity: AnchoredIdentity;
}

export function readAnchoredRegularFileSnapshot(
  path: string,
  maxBytes = MAX_ANCHORED_CONFIG_BYTES,
): AnchoredRegularFileSnapshot | undefined {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_ANCHORED_ARTIFACT_BYTES) {
    return fail('anchored regular file byte limit is invalid');
  }
  const parent = dirname(path);
  let parentFd: number | undefined;
  let fileFd: number | undefined;
  try {
    try {
      parentFd = openDirectoryPath(parent, false);
    } catch (error) {
      if (errno(error) === 'ENOENT') return undefined;
      throw error;
    }
    const parentIdentity = identity(fstatSync(parentFd));
    if (!lstatChild(parentFd, basename(path))) return undefined;
    fileFd = openVerifiedRegular(parentFd, basename(path), FILE_READ_FLAGS);
    const opened = fstatSync(fileFd);
    if (opened.size > maxBytes) fail(`anchored regular file exceeds the ${maxBytes} byte hard limit`);
    fireTestHook('snapshot-before-read', path);
    const buffer = Buffer.alloc(opened.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(fileFd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
    fireTestHook('snapshot-after-read', path);
    if (bytesRead > maxBytes) {
      fail(`anchored regular file exceeds the ${maxBytes} byte hard limit`);
    }
    const after = fstatSync(fileFd);
    const named = lstatChild(parentFd, basename(path));
    if (
      bytesRead !== opened.size
      || opened.nlink !== 1
      || after.nlink !== 1
      || !named
      || !named.isFile()
      || named.isSymbolicLink()
      || named.nlink !== 1
      || !sameIdentity(identity(opened), identity(after))
      || !sameIdentity(identity(opened), identity(named))
      || named.mode !== opened.mode
      || after.size !== opened.size
      || named.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs
      || after.ctimeMs !== opened.ctimeMs
      || named.mtimeMs !== opened.mtimeMs
      || named.ctimeMs !== opened.ctimeMs
    ) {
      fail('anchored regular file identity or contents changed during the bounded snapshot read');
    }
    const content = buffer.subarray(0, bytesRead).toString('utf8');
    assertDirectoryName(parent, parentIdentity);
    return { content, identity: identity(opened) };
  } finally {
    if (fileFd !== undefined) closeSync(fileFd);
    if (parentFd !== undefined) closeSync(parentFd);
  }
}

/** Read a bounded regular file relative to an opened, no-follow parent chain. */
export function readAnchoredRegularFile(path: string): string | undefined {
  return readAnchoredRegularFileSnapshot(path)?.content;
}

/**
 * Replace a config-like regular file without ever overwriting a racing target.
 * Existing files are moved to a same-directory backup and identity-checked
 * before the new inode is linked into place.
 */
export function writeAnchoredRegularFile(path: string, body: string, mode = 0o600): void {
  const parent = dirname(path);
  ensureAnchoredDirectory(parent);
  let parentFd: number | undefined;
  let temporaryFd: number | undefined;
  let temporary = '';
  let backup = '';
  let targetLinked = false;
  let installed = false;
  try {
    parentFd = openDirectoryPath(parent, false);
    const parentIdentity = identity(fstatSync(parentFd));
    const current = lstatChild(parentFd, basename(path));
    if (current) assertRegularStat(current, 'replacement target must be a regular file');
    ({ fd: temporaryFd, name: temporary } = createTemporary(parentFd, mode));
    writeFileSync(temporaryFd, body);
    fsyncSync(temporaryFd);

    fireTestHook('config-before-parent-check', path);
    assertDirectoryName(parent, parentIdentity);
    if (current) {
      backup = `.knowledge-backup-${process.pid}-${randomUUID()}`;
      fireTestHook('config-before-target-move', path);
      renameSync(fdPath(parentFd, basename(path)), fdPath(parentFd, backup));
      const moved = lstatChild(parentFd, backup);
      if (!moved || !sameIdentity(identity(current), identity(moved))) {
        restoreRegularBackup(parentFd, backup, basename(path));
        fail('replacement target identity changed before commit');
      }
    }

    try {
      linkSync(fdPath(parentFd, temporary), fdPath(parentFd, basename(path)));
      targetLinked = true;
    } catch {
      if (backup) restoreRegularBackup(parentFd, backup, basename(path));
      fail('replacement target changed before no-clobber install');
    }
    fireTestHook('config-before-final-verify', path);
    verifyInstalledTemporary(parentFd, basename(path), temporaryFd, body, mode, 2);
    unlinkSync(fdPath(parentFd, temporary));
    temporary = '';
    verifyInstalledTemporary(parentFd, basename(path), temporaryFd, body, mode, 1);
    if (backup) {
      unlinkSync(fdPath(parentFd, backup));
      backup = '';
    }
    fsyncSync(parentFd);
    const written = verifyInstalledTemporary(
      parentFd,
      basename(path),
      temporaryFd,
      body,
      mode,
      1,
    );
    assertDirectoryName(parent, parentIdentity);
    installed = true;
  } finally {
    if (parentFd !== undefined) {
      if (!installed && targetLinked && temporaryFd !== undefined) {
        rollbackTemporaryInstall(parentFd, basename(path), temporaryFd, backup);
        backup = '';
      }
      if (temporary && lstatChild(parentFd, temporary)) unlinkSync(fdPath(parentFd, temporary));
      if (!installed && backup) restoreRegularBackup(parentFd, backup, basename(path));
      if (temporaryFd !== undefined) closeSync(temporaryFd);
      closeSync(parentFd);
    } else if (temporaryFd !== undefined) {
      closeSync(temporaryFd);
    }
  }
}

/** Root-anchored, symlink-free local artifact operations. */
export class AnchoredArtifactDirectory {
  private readonly expected: AnchoredIdentity;

  constructor(readonly path: string) {
    this.expected = ensureAnchoredDirectory(path);
  }

  private openRoot(): number {
    const fd = openDirectoryPath(this.path, false);
    const opened = identity(fstatSync(fd));
    if (!sameIdentityAndMode(opened, this.expected) || opened.mode !== 0o700) {
      closeSync(fd);
      return fail('artifact root identity or confidentiality mode changed');
    }
    assertDirectoryName(this.path, this.expected);
    return fd;
  }

  put(relativePath: string, body: string | Uint8Array): { modifiedAt: Date } {
    const bodyBytes = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;
    if (bodyBytes > MAX_ANCHORED_ARTIFACT_BYTES) {
      fail(`artifact body exceeds ${MAX_ANCHORED_ARTIFACT_BYTES} bytes`);
    }
    const parts = relativeSegments(relativePath);
    const name = parts.pop()!;
    let rootFd: number | undefined;
    let parentFd: number | undefined;
    let fileFd: number | undefined;
    let temporary = '';
    let backup = '';
    let targetLinked = false;
    let installed = false;
    try {
      rootFd = this.openRoot();
      parentFd = openRelativeParent(rootFd, parts, true);
      const current = lstatChild(parentFd, name);
      if (current) assertRegularStat(current, 'artifact target must be a regular file');
      const created = createTemporary(parentFd, 0o600);
      fileFd = created.fd;
      temporary = created.name;
      writeFileSync(fileFd, body);
      fsyncSync(fileFd);

      assertDirectoryName(this.path, this.expected);
      if (current) {
        backup = `.knowledge-backup-${process.pid}-${randomUUID()}`;
        renameSync(fdPath(parentFd, name), fdPath(parentFd, backup));
        const moved = lstatChild(parentFd, backup);
        if (!moved || !sameIdentity(identity(current), identity(moved))) {
          restoreRegularBackup(parentFd, backup, name);
          fail('artifact target identity changed before replacement');
        }
      }
      try {
        linkSync(fdPath(parentFd, temporary), fdPath(parentFd, name));
        targetLinked = true;
      } catch {
        if (backup) restoreRegularBackup(parentFd, backup, name);
        fail('artifact target changed before no-clobber install');
      }
      fireTestHook('artifact-before-final-verify', relativePath);
      verifyInstalledTemporary(parentFd, name, fileFd, body, 0o600, 2);
      unlinkSync(fdPath(parentFd, temporary));
      temporary = '';
      verifyInstalledTemporary(parentFd, name, fileFd, body, 0o600, 1);
      if (backup) {
        unlinkSync(fdPath(parentFd, backup));
        backup = '';
      }
      fsyncSync(parentFd);
      const written = verifyInstalledTemporary(parentFd, name, fileFd, body, 0o600, 1);
      assertDirectoryName(this.path, this.expected);
      installed = true;
      return { modifiedAt: written.mtime };
    } finally {
      if (parentFd !== undefined) {
        if (!installed && targetLinked && fileFd !== undefined) {
          rollbackTemporaryInstall(parentFd, name, fileFd, backup);
          backup = '';
        }
        if (temporary && lstatChild(parentFd, temporary)) unlinkSync(fdPath(parentFd, temporary));
        if (!installed && backup) restoreRegularBackup(parentFd, backup, name);
        if (fileFd !== undefined) closeSync(fileFd);
        closeSync(parentFd);
      } else if (fileFd !== undefined) {
        closeSync(fileFd);
      }
      if (rootFd !== undefined) closeSync(rootFd);
    }
  }

  read(relativePath: string): string {
    const parts = relativeSegments(relativePath);
    const name = parts.pop()!;
    let rootFd: number | undefined;
    let parentFd: number | undefined;
    let fileFd: number | undefined;
    try {
      rootFd = this.openRoot();
      parentFd = openRelativeParent(rootFd, parts, false);
      fileFd = openVerifiedRegular(parentFd, name, FILE_READ_FLAGS);
      const opened = fstatSync(fileFd);
      assertArtifactFileStat(opened, 'artifact read target is not a regular file');
      if (opened.size > MAX_ANCHORED_ARTIFACT_BYTES) {
        fail(`artifact body exceeds ${MAX_ANCHORED_ARTIFACT_BYTES} bytes`);
      }
      fireTestHook('artifact-before-read', relativePath);
      const buffer = Buffer.alloc(opened.size + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const count = readSync(
          fileFd,
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          bytesRead,
        );
        if (count === 0) break;
        bytesRead += count;
      }
      if (bytesRead > MAX_ANCHORED_ARTIFACT_BYTES) {
        fail(`artifact body exceeds ${MAX_ANCHORED_ARTIFACT_BYTES} bytes`);
      }
      const after = fstatSync(fileFd);
      assertArtifactFileStat(after, 'artifact read target changed during the read');
      if (
        bytesRead !== opened.size
        || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs
        || after.ctimeMs !== opened.ctimeMs
      ) {
        fail('artifact read target changed during the bounded read');
      }
      const named = lstatChild(parentFd, name);
      if (!named) fail('artifact read target disappeared during the bounded read');
      assertArtifactFileStat(named, 'artifact read target changed during the bounded read');
      if (
        !sameIdentity(identity(opened), identity(named))
        || named.size !== opened.size
        || named.mtimeMs !== opened.mtimeMs
        || named.ctimeMs !== opened.ctimeMs
      ) {
        fail('artifact read target identity changed during the bounded read');
      }
      const output = buffer.subarray(0, bytesRead).toString('utf8');
      if (Buffer.byteLength(output, 'utf8') > MAX_ANCHORED_ARTIFACT_BYTES) {
        fail(`artifact body exceeds ${MAX_ANCHORED_ARTIFACT_BYTES} encoded bytes`);
      }
      assertDirectoryName(this.path, this.expected);
      return output;
    } finally {
      if (fileFd !== undefined) closeSync(fileFd);
      if (parentFd !== undefined) closeSync(parentFd);
      if (rootFd !== undefined) closeSync(rootFd);
    }
  }

  exists(relativePath: string): boolean {
    const parts = relativeSegments(relativePath);
    const name = parts.pop()!;
    let rootFd: number | undefined;
    let parentFd: number | undefined;
    let fileFd: number | undefined;
    try {
      rootFd = this.openRoot();
      try {
        parentFd = openRelativeParent(rootFd, parts, false);
      } catch (error) {
        if (errno(error) === 'ENOENT') return false;
        throw error;
      }
      if (!lstatChild(parentFd, name)) return false;
      fileFd = openVerifiedRegular(parentFd, name, FILE_READ_FLAGS);
      assertArtifactFileStat(fstatSync(fileFd), 'artifact exists target is not a regular file');
      assertDirectoryName(this.path, this.expected);
      return true;
    } finally {
      if (fileFd !== undefined) closeSync(fileFd);
      if (parentFd !== undefined) closeSync(parentFd);
      if (rootFd !== undefined) closeSync(rootFd);
    }
  }

  delete(relativePath: string): void {
    const parts = relativeSegments(relativePath);
    const name = parts.pop()!;
    let rootFd: number | undefined;
    let parentFd: number | undefined;
    let quarantine = '';
    try {
      rootFd = this.openRoot();
      try {
        parentFd = openRelativeParent(rootFd, parts, false);
      } catch (error) {
        if (errno(error) === 'ENOENT') return;
        throw error;
      }
      const current = lstatChild(parentFd, name);
      if (!current) return;
      assertArtifactFileStat(current, 'artifact delete target must be a regular file');
      quarantine = `.knowledge-delete-${process.pid}-${randomUUID()}`;
      renameSync(fdPath(parentFd, name), fdPath(parentFd, quarantine));
      const moved = lstatChild(parentFd, quarantine);
      if (!moved || moved.nlink !== 1 || !sameIdentity(identity(current), identity(moved))) {
        restoreRegularBackup(parentFd, quarantine, name);
        fail('artifact delete target identity changed');
      }
      unlinkSync(fdPath(parentFd, quarantine));
      quarantine = '';
      fsyncSync(parentFd);
      assertDirectoryName(this.path, this.expected);
    } finally {
      if (parentFd !== undefined) {
        if (quarantine) restoreRegularBackup(parentFd, quarantine, name);
        closeSync(parentFd);
      }
      if (rootFd !== undefined) closeSync(rootFd);
    }
  }

  list(prefix = ''): string[] {
    const prefixParts = prefix ? relativeSegments(prefix) : [];
    let rootFd: number | undefined;
    let startFd: number | undefined;
    try {
      rootFd = this.openRoot();
      try {
        startFd = openRelativeParent(rootFd, prefixParts, false);
      } catch (error) {
        if (errno(error) === 'ENOENT') return [];
        throw error;
      }
      const output: string[] = [];
      let visited = 0;
      const visit = (directoryFd: number, pathParts: string[]): void => {
        const entries: string[] = [];
        const directory = opendirSync(fdPath(directoryFd));
        try {
          for (;;) {
            const entry = directory.readSync();
            if (!entry) break;
            if (++visited > MAX_ANCHORED_ARTIFACT_NODES) {
              fail(`artifact tree exceeds ${MAX_ANCHORED_ARTIFACT_NODES} nodes`);
            }
            entries.push(entry.name);
          }
        } finally {
          directory.closeSync();
        }
        for (const entry of entries.sort()) {
          const stat = lstatChild(directoryFd, entry);
          if (!stat) fail('artifact entry changed while listing');
          if (stat.isSymbolicLink()) fail('artifact list encountered a symlink');
          if (stat.isDirectory()) {
            const childFd = openChildDirectory(directoryFd, entry, false);
            try {
              visit(childFd, [...pathParts, entry]);
            } finally {
              closeSync(childFd);
            }
          } else if (stat.isFile()) {
            const fileFd = openVerifiedRegular(directoryFd, entry, FILE_READ_FLAGS);
            try {
              assertArtifactFileStat(fstatSync(fileFd), 'artifact list encountered a non-regular file');
            } catch (error) {
              closeSync(fileFd);
              throw error;
            }
            closeSync(fileFd);
            output.push([...pathParts, entry].join('/'));
          } else {
            fail('artifact list encountered a non-regular entry');
          }
        }
      };
      visit(startFd, prefixParts);
      assertDirectoryName(this.path, this.expected);
      return output;
    } finally {
      if (startFd !== undefined) closeSync(startFd);
      if (rootFd !== undefined) closeSync(rootFd);
    }
  }
}
