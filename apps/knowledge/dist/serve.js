// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = import.meta.require;

// src/anchored-fs.ts
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
  writeFileSync
} from "fs";
import { randomUUID } from "crypto";
import { basename, dirname, isAbsolute, normalize, resolve, sep } from "path";
function fail(detail) {
  throw new AnchoredFilesystemError(detail);
}
function errno(error) {
  return error?.code;
}
function assertAnchoredFilesystemPlatform(platform = process.platform) {
  if (platform !== "linux" && platform !== "darwin") {
    fail(`directory-FD anchoring is unsupported on ${platform}; local filesystem access is disabled`);
  }
}
function fdBase() {
  assertAnchoredFilesystemPlatform();
  if (typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_DIRECTORY !== "number") {
    return fail("directory-FD anchoring is unavailable on this platform");
  }
  if (existsSync("/proc/self/fd"))
    return "/proc/self/fd";
  if (existsSync("/dev/fd"))
    return "/dev/fd";
  return fail("directory-FD anchoring is unavailable on this platform");
}
function fireTestHook(event, detail) {
  anchoredFsTestHook?.(event, detail);
}
function fdPath(fd, name) {
  const base = `${fdBase()}/${fd}`;
  return name === undefined ? base : `${base}/${name}`;
}
function identity(stat) {
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode & 511 };
}
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function sameIdentityAndMode(left, right) {
  return sameIdentity(left, right) && left.mode === right.mode;
}
function assertDirectoryStat(stat, detail) {
  if (!stat.isDirectory() || stat.isSymbolicLink())
    fail(detail);
}
function assertRegularStat(stat, detail) {
  if (!stat.isFile() || stat.isSymbolicLink())
    fail(detail);
}
function absoluteSegments(path) {
  if (!isAbsolute(path) || normalize(path) !== path || resolve(path) !== path) {
    return fail("anchored path must be absolute and traversal-free");
  }
  return path.split(sep).filter(Boolean);
}
function relativeSegments(path) {
  if (!path || isAbsolute(path) || path.includes("\x00")) {
    return fail("anchored relative path is invalid");
  }
  const segments = path.replace(/\\/g, "/").split("/");
  if (segments.some((part) => !part || part === "." || part === "..")) {
    return fail("anchored relative path contains an unsafe component");
  }
  return segments;
}
function openDirectoryPath(path, create, mode = 448) {
  assertAnchoredFilesystemPlatform();
  const segments = absoluteSegments(path);
  let current;
  try {
    current = openSync("/", DIRECTORY_FLAGS);
    for (const segment of segments) {
      const child = fdPath(current, segment);
      if (create) {
        try {
          mkdirSync(child, { mode });
        } catch (error) {
          if (errno(error) !== "EEXIST")
            throw error;
        }
      }
      let next;
      try {
        next = openSync(child, DIRECTORY_FLAGS);
      } catch (error) {
        if (errno(error) === "ENOENT")
          throw error;
        return fail("directory component could not be opened without following links");
      }
      assertDirectoryStat(fstatSync(next), "opened path component is not a directory");
      closeSync(current);
      current = next;
    }
    const result = current;
    current = undefined;
    return result;
  } finally {
    if (current !== undefined)
      closeSync(current);
  }
}
function pathDirectoryIdentity(path) {
  let fd;
  try {
    fd = openDirectoryPath(path, false);
    return identity(fstatSync(fd));
  } catch (error) {
    if (errno(error) === "ENOENT")
      return;
    throw error;
  } finally {
    if (fd !== undefined)
      closeSync(fd);
  }
}
function assertDirectoryName(path, expected) {
  const current = pathDirectoryIdentity(path);
  if (!current || !sameIdentityAndMode(current, expected)) {
    fail("anchored directory identity or confidentiality mode changed during the operation");
  }
}
function assertExactMode(stat, expectedMode, detail) {
  if ((stat.mode & 511) !== expectedMode)
    fail(detail);
}
function assertArtifactFileStat(stat, detail) {
  assertRegularStat(stat, detail);
  if (stat.nlink !== 1)
    fail("artifact file has multiple hard links");
  assertExactMode(stat, 384, "artifact file confidentiality mode must be exactly 0600");
}
function lstatChild(fd, name) {
  try {
    return lstatSync(fdPath(fd, name));
  } catch (error) {
    if (errno(error) === "ENOENT")
      return;
    throw error;
  }
}
function openChildDirectory(parentFd, name, create) {
  const child = fdPath(parentFd, name);
  if (create) {
    try {
      mkdirSync(child, { mode: 448 });
    } catch (error) {
      if (errno(error) !== "EEXIST")
        throw error;
    }
  }
  fireTestHook("artifact-before-component-open", name);
  try {
    const fd = openSync(child, DIRECTORY_FLAGS);
    const opened = fstatSync(fd);
    assertDirectoryStat(opened, "artifact path component is not a directory");
    assertExactMode(opened, 448, "artifact directory confidentiality mode must be exactly 0700");
    return fd;
  } catch (error) {
    if (error instanceof AnchoredFilesystemError || errno(error) === "ENOENT")
      throw error;
    return fail("artifact path component could not be opened without following links");
  }
}
function openRelativeParent(rootFd, parts, create) {
  let current = openSync(fdPath(rootFd, "."), DIRECTORY_FLAGS);
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
    if (current >= 0)
      closeSync(current);
  }
}
function openVerifiedRegular(parentFd, name, flags) {
  const before = lstatChild(parentFd, name);
  if (!before) {
    const missing = new Error(`ENOENT: no such file, open '${name}'`);
    missing.code = "ENOENT";
    throw missing;
  }
  assertRegularStat(before, "anchored file must be a non-symlink regular file");
  let fd;
  try {
    fd = openSync(fdPath(parentFd, name), flags | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    assertRegularStat(opened, "opened file must be regular");
    const named = lstatChild(parentFd, name);
    if (!named || !sameIdentity(identity(opened), identity(named))) {
      fail("file identity changed while it was opened");
    }
    const result = fd;
    fd = undefined;
    return result;
  } catch (error) {
    if (error instanceof AnchoredFilesystemError || errno(error) === "ENOENT")
      throw error;
    return fail("file could not be opened without following links");
  } finally {
    if (fd !== undefined)
      closeSync(fd);
  }
}
function createTemporary(parentFd, mode) {
  const name = `.knowledge-tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(fdPath(parentFd, name), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  fchmodSync(fd, mode);
  return { fd, name };
}
function readExactFileDescriptor(fd, size) {
  const buffer = Buffer.alloc(size + 1);
  let bytesRead = 0;
  while (bytesRead < buffer.length) {
    const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
    if (count === 0)
      break;
    bytesRead += count;
  }
  if (bytesRead !== size)
    fail("installed file content size changed during final verification");
  return buffer.subarray(0, bytesRead);
}
function verifyInstalledTemporary(parentFd, name, temporaryFd, expectedBody, expectedMode, expectedLinks) {
  const temporary = fstatSync(temporaryFd);
  assertRegularStat(temporary, "temporary install inode is not a regular file");
  assertExactMode(temporary, expectedMode, "temporary install mode changed");
  if (temporary.nlink !== expectedLinks)
    fail("temporary install hard-link count changed");
  const expected = typeof expectedBody === "string" ? Buffer.from(expectedBody) : Buffer.from(expectedBody);
  if (temporary.size !== expected.byteLength)
    fail("temporary install size changed");
  let finalFd;
  try {
    finalFd = openVerifiedRegular(parentFd, name, FILE_READ_FLAGS);
    const opened = fstatSync(finalFd);
    const named = lstatChild(parentFd, name);
    if (!named || !opened.isFile() || opened.isSymbolicLink() || !named.isFile() || named.isSymbolicLink() || opened.nlink !== expectedLinks || named.nlink !== expectedLinks || !sameIdentity(identity(temporary), identity(opened)) || !sameIdentity(identity(temporary), identity(named)) || (opened.mode & 511) !== expectedMode || (named.mode & 511) !== expectedMode || opened.size !== expected.byteLength || named.size !== expected.byteLength) {
      fail("installed file identity, type, mode, or size does not match the intended temporary inode");
    }
    const actual = readExactFileDescriptor(finalFd, opened.size);
    const after = fstatSync(finalFd);
    if (!actual.equals(expected) || !sameIdentity(identity(opened), identity(after)) || after.size !== opened.size || after.nlink !== expectedLinks) {
      fail("installed file content does not match the intended temporary inode");
    }
    return named;
  } finally {
    if (finalFd !== undefined)
      closeSync(finalFd);
  }
}
function rollbackTemporaryInstall(parentFd, target, temporaryFd, backup) {
  const temporary = fstatSync(temporaryFd);
  const current = lstatChild(parentFd, target);
  if (current && sameIdentity(identity(current), identity(temporary))) {
    try {
      unlinkSync(fdPath(parentFd, target));
    } catch {}
  } else if (current && backup) {
    const conflict = `.knowledge-conflict-${process.pid}-${randomUUID()}`;
    try {
      renameSync(fdPath(parentFd, target), fdPath(parentFd, conflict));
    } catch {
      return;
    }
  }
  if (backup)
    restoreRegularBackup(parentFd, backup, target);
}
function restoreRegularBackup(parentFd, backup, target) {
  if (!lstatChild(parentFd, backup) || lstatChild(parentFd, target))
    return;
  try {
    linkSync(fdPath(parentFd, backup), fdPath(parentFd, target));
    unlinkSync(fdPath(parentFd, backup));
  } catch {}
}
function ensureAnchoredDirectory(path, mode = 448) {
  let fd;
  try {
    fd = openDirectoryPath(path, true, mode);
    const opened = fstatSync(fd);
    assertDirectoryStat(opened, "anchored path is not a directory");
    assertExactMode(opened, mode, `anchored directory confidentiality mode must be exactly ${mode.toString(8)}`);
    return identity(opened);
  } finally {
    if (fd !== undefined)
      closeSync(fd);
  }
}

class AnchoredDirectoryHandle {
  path;
  identity;
  fd;
  constructor(path) {
    this.path = path;
    this.fd = openDirectoryPath(path, false);
    const opened = fstatSync(this.fd);
    assertDirectoryStat(opened, "anchored parent handle is not a directory");
    this.identity = Object.freeze(identity(opened));
    assertDirectoryName(path, this.identity);
  }
  descriptor() {
    if (this.fd === undefined)
      fail("anchored parent handle is closed");
    return this.fd;
  }
  safeName(name) {
    const parts = relativeSegments(name);
    if (parts.length !== 1)
      fail("anchored child name must contain exactly one safe component");
    return parts[0];
  }
  child(name) {
    return fdPath(this.descriptor(), this.safeName(name));
  }
  verifyDescriptor() {
    const descriptor = this.descriptor();
    const stat = fstatSync(descriptor);
    assertDirectoryStat(stat, "anchored parent descriptor is no longer a directory");
    const opened = identity(stat);
    if (!sameIdentityAndMode(opened, this.identity))
      fail("anchored parent descriptor identity changed");
  }
  verify() {
    this.verifyDescriptor();
    assertDirectoryName(this.path, this.identity);
  }
  lstat(name) {
    return lstatChild(this.descriptor(), this.safeName(name));
  }
  open(name, flags, mode) {
    const safeName = this.safeName(name);
    return openSync(fdPath(this.descriptor(), safeName), flags | constants.O_NOFOLLOW, mode);
  }
  link(source, target) {
    linkSync(this.child(source), this.child(target));
  }
  rename(source, target) {
    renameSync(this.child(source), this.child(target));
  }
  unlink(name) {
    unlinkSync(this.child(name));
  }
  sync() {
    fsyncSync(this.descriptor());
  }
  close() {
    if (this.fd === undefined)
      return;
    closeSync(this.fd);
    this.fd = undefined;
  }
}
function mutableFileSnapshot(stat) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode & 511,
    size: stat.size,
    nlink: stat.nlink,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs
  });
}
function sameMutableFileSnapshot(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.size === right.size && left.nlink === right.nlink && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

class AnchoredMutableFileHandle {
  parent;
  name;
  descriptorPath;
  initial;
  fd;
  constructor(parent, name, fd) {
    this.parent = parent;
    this.name = name;
    this.fd = fd;
    this.descriptorPath = fdPath(fd);
    this.initial = this.verifyIdentity();
  }
  descriptor() {
    if (this.fd === undefined)
      fail("anchored file handle is closed");
    return this.fd;
  }
  snapshot() {
    return mutableFileSnapshot(fstatSync(this.descriptor()));
  }
  verifyIdentity() {
    this.parent.verify();
    const opened = fstatSync(this.descriptor());
    const named = this.parent.lstat(this.name);
    if (!opened.isFile() || opened.isSymbolicLink() || opened.nlink !== 1 || !named || !named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || opened.dev !== named.dev || opened.ino !== named.ino || (opened.mode & 511) !== (named.mode & 511)) {
      fail("anchored database identity must remain one canonical regular file");
    }
    return mutableFileSnapshot(opened);
  }
  verifyUnchanged(expected) {
    const current = this.verifyIdentity();
    if (!sameMutableFileSnapshot(current, expected)) {
      fail("anchored database identity or contents changed before the next operation");
    }
    return current;
  }
  close() {
    if (this.fd !== undefined) {
      closeSync(this.fd);
      this.fd = undefined;
    }
    this.parent.close();
  }
}
function openAnchoredMutableRegularFile(path, options = {}) {
  const parent = new AnchoredDirectoryHandle(dirname(path));
  const name = basename(path);
  let fd;
  try {
    const existing = parent.lstat(name);
    if (existing) {
      assertRegularStat(existing, "anchored database target must be a non-symlink regular file");
      if (existing.nlink !== 1)
        fail("anchored database target must not have hard links");
      fd = parent.open(name, constants.O_RDWR);
    } else {
      if (options.create !== true) {
        const missing = new Error(`ENOENT: no such file, open '${name}'`);
        missing.code = "ENOENT";
        throw missing;
      }
      fd = parent.open(name, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, options.mode ?? 384);
      fchmodSync(fd, options.mode ?? 384);
      fsyncSync(fd);
      parent.sync();
    }
    const handle = new AnchoredMutableFileHandle(parent, name, fd);
    fd = undefined;
    return handle;
  } catch (error) {
    if (fd !== undefined)
      closeSync(fd);
    parent.close();
    throw error;
  }
}
function readAnchoredRegularFileSnapshot(path, maxBytes = MAX_ANCHORED_CONFIG_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_ANCHORED_ARTIFACT_BYTES) {
    return fail("anchored regular file byte limit is invalid");
  }
  const parent = dirname(path);
  let parentFd;
  let fileFd;
  try {
    try {
      parentFd = openDirectoryPath(parent, false);
    } catch (error) {
      if (errno(error) === "ENOENT")
        return;
      throw error;
    }
    const parentIdentity = identity(fstatSync(parentFd));
    if (!lstatChild(parentFd, basename(path)))
      return;
    fileFd = openVerifiedRegular(parentFd, basename(path), FILE_READ_FLAGS);
    const opened = fstatSync(fileFd);
    if (opened.size > maxBytes)
      fail(`anchored regular file exceeds the ${maxBytes} byte hard limit`);
    fireTestHook("snapshot-before-read", path);
    const buffer = Buffer.alloc(opened.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(fileFd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (count === 0)
        break;
      bytesRead += count;
    }
    fireTestHook("snapshot-after-read", path);
    if (bytesRead > maxBytes) {
      fail(`anchored regular file exceeds the ${maxBytes} byte hard limit`);
    }
    const after = fstatSync(fileFd);
    const named = lstatChild(parentFd, basename(path));
    if (bytesRead !== opened.size || opened.nlink !== 1 || after.nlink !== 1 || !named || !named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || !sameIdentity(identity(opened), identity(after)) || !sameIdentity(identity(opened), identity(named)) || named.mode !== opened.mode || after.size !== opened.size || named.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || named.mtimeMs !== opened.mtimeMs || named.ctimeMs !== opened.ctimeMs) {
      fail("anchored regular file identity or contents changed during the bounded snapshot read");
    }
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    assertDirectoryName(parent, parentIdentity);
    return { content, identity: identity(opened) };
  } finally {
    if (fileFd !== undefined)
      closeSync(fileFd);
    if (parentFd !== undefined)
      closeSync(parentFd);
  }
}
function writeAnchoredRegularFile(path, body, mode = 384) {
  const parent = dirname(path);
  ensureAnchoredDirectory(parent);
  let parentFd;
  let temporaryFd;
  let temporary = "";
  let backup = "";
  let targetLinked = false;
  let installed = false;
  try {
    parentFd = openDirectoryPath(parent, false);
    const parentIdentity = identity(fstatSync(parentFd));
    const current = lstatChild(parentFd, basename(path));
    if (current)
      assertRegularStat(current, "replacement target must be a regular file");
    ({ fd: temporaryFd, name: temporary } = createTemporary(parentFd, mode));
    writeFileSync(temporaryFd, body);
    fsyncSync(temporaryFd);
    fireTestHook("config-before-parent-check", path);
    assertDirectoryName(parent, parentIdentity);
    if (current) {
      backup = `.knowledge-backup-${process.pid}-${randomUUID()}`;
      fireTestHook("config-before-target-move", path);
      renameSync(fdPath(parentFd, basename(path)), fdPath(parentFd, backup));
      const moved = lstatChild(parentFd, backup);
      if (!moved || !sameIdentity(identity(current), identity(moved))) {
        restoreRegularBackup(parentFd, backup, basename(path));
        fail("replacement target identity changed before commit");
      }
    }
    try {
      linkSync(fdPath(parentFd, temporary), fdPath(parentFd, basename(path)));
      targetLinked = true;
    } catch {
      if (backup)
        restoreRegularBackup(parentFd, backup, basename(path));
      fail("replacement target changed before no-clobber install");
    }
    fireTestHook("config-before-final-verify", path);
    verifyInstalledTemporary(parentFd, basename(path), temporaryFd, body, mode, 2);
    unlinkSync(fdPath(parentFd, temporary));
    temporary = "";
    verifyInstalledTemporary(parentFd, basename(path), temporaryFd, body, mode, 1);
    if (backup) {
      unlinkSync(fdPath(parentFd, backup));
      backup = "";
    }
    fsyncSync(parentFd);
    const written = verifyInstalledTemporary(parentFd, basename(path), temporaryFd, body, mode, 1);
    assertDirectoryName(parent, parentIdentity);
    installed = true;
  } finally {
    if (parentFd !== undefined) {
      if (!installed && targetLinked && temporaryFd !== undefined) {
        rollbackTemporaryInstall(parentFd, basename(path), temporaryFd, backup);
        backup = "";
      }
      if (temporary && lstatChild(parentFd, temporary))
        unlinkSync(fdPath(parentFd, temporary));
      if (!installed && backup)
        restoreRegularBackup(parentFd, backup, basename(path));
      if (temporaryFd !== undefined)
        closeSync(temporaryFd);
      closeSync(parentFd);
    } else if (temporaryFd !== undefined) {
      closeSync(temporaryFd);
    }
  }
}

class AnchoredArtifactDirectory {
  path;
  expected;
  constructor(path) {
    this.path = path;
    this.expected = ensureAnchoredDirectory(path);
  }
  openRoot() {
    const fd = openDirectoryPath(this.path, false);
    const opened = identity(fstatSync(fd));
    if (!sameIdentityAndMode(opened, this.expected) || opened.mode !== 448) {
      closeSync(fd);
      return fail("artifact root identity or confidentiality mode changed");
    }
    assertDirectoryName(this.path, this.expected);
    return fd;
  }
  put(relativePath, body) {
    const bodyBytes = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
    if (bodyBytes > MAX_ANCHORED_ARTIFACT_BYTES) {
      fail(`artifact body exceeds ${MAX_ANCHORED_ARTIFACT_BYTES} bytes`);
    }
    const parts = relativeSegments(relativePath);
    const name = parts.pop();
    let rootFd;
    let parentFd;
    let fileFd;
    let temporary = "";
    let backup = "";
    let targetLinked = false;
    let installed = false;
    try {
      rootFd = this.openRoot();
      parentFd = openRelativeParent(rootFd, parts, true);
      const current = lstatChild(parentFd, name);
      if (current)
        assertRegularStat(current, "artifact target must be a regular file");
      const created = createTemporary(parentFd, 384);
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
          fail("artifact target identity changed before replacement");
        }
      }
      try {
        linkSync(fdPath(parentFd, temporary), fdPath(parentFd, name));
        targetLinked = true;
      } catch {
        if (backup)
          restoreRegularBackup(parentFd, backup, name);
        fail("artifact target changed before no-clobber install");
      }
      fireTestHook("artifact-before-final-verify", relativePath);
      verifyInstalledTemporary(parentFd, name, fileFd, body, 384, 2);
      unlinkSync(fdPath(parentFd, temporary));
      temporary = "";
      verifyInstalledTemporary(parentFd, name, fileFd, body, 384, 1);
      if (backup) {
        unlinkSync(fdPath(parentFd, backup));
        backup = "";
      }
      fsyncSync(parentFd);
      const written = verifyInstalledTemporary(parentFd, name, fileFd, body, 384, 1);
      assertDirectoryName(this.path, this.expected);
      installed = true;
      return { modifiedAt: written.mtime };
    } finally {
      if (parentFd !== undefined) {
        if (!installed && targetLinked && fileFd !== undefined) {
          rollbackTemporaryInstall(parentFd, name, fileFd, backup);
          backup = "";
        }
        if (temporary && lstatChild(parentFd, temporary))
          unlinkSync(fdPath(parentFd, temporary));
        if (!installed && backup)
          restoreRegularBackup(parentFd, backup, name);
        if (fileFd !== undefined)
          closeSync(fileFd);
        closeSync(parentFd);
      } else if (fileFd !== undefined) {
        closeSync(fileFd);
      }
      if (rootFd !== undefined)
        closeSync(rootFd);
    }
  }
  read(relativePath) {
    const parts = relativeSegments(relativePath);
    const name = parts.pop();
    let rootFd;
    let parentFd;
    let fileFd;
    try {
      rootFd = this.openRoot();
      parentFd = openRelativeParent(rootFd, parts, false);
      fileFd = openVerifiedRegular(parentFd, name, FILE_READ_FLAGS);
      const opened = fstatSync(fileFd);
      assertArtifactFileStat(opened, "artifact read target is not a regular file");
      if (opened.size > MAX_ANCHORED_ARTIFACT_BYTES) {
        fail(`artifact body exceeds ${MAX_ANCHORED_ARTIFACT_BYTES} bytes`);
      }
      fireTestHook("artifact-before-read", relativePath);
      const buffer = Buffer.alloc(opened.size + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const count = readSync(fileFd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (count === 0)
          break;
        bytesRead += count;
      }
      if (bytesRead > MAX_ANCHORED_ARTIFACT_BYTES) {
        fail(`artifact body exceeds ${MAX_ANCHORED_ARTIFACT_BYTES} bytes`);
      }
      const after = fstatSync(fileFd);
      assertArtifactFileStat(after, "artifact read target changed during the read");
      if (bytesRead !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
        fail("artifact read target changed during the bounded read");
      }
      const named = lstatChild(parentFd, name);
      if (!named)
        fail("artifact read target disappeared during the bounded read");
      assertArtifactFileStat(named, "artifact read target changed during the bounded read");
      if (!sameIdentity(identity(opened), identity(named)) || named.size !== opened.size || named.mtimeMs !== opened.mtimeMs || named.ctimeMs !== opened.ctimeMs) {
        fail("artifact read target identity changed during the bounded read");
      }
      const output = buffer.subarray(0, bytesRead).toString("utf8");
      if (Buffer.byteLength(output, "utf8") > MAX_ANCHORED_ARTIFACT_BYTES) {
        fail(`artifact body exceeds ${MAX_ANCHORED_ARTIFACT_BYTES} encoded bytes`);
      }
      assertDirectoryName(this.path, this.expected);
      return output;
    } finally {
      if (fileFd !== undefined)
        closeSync(fileFd);
      if (parentFd !== undefined)
        closeSync(parentFd);
      if (rootFd !== undefined)
        closeSync(rootFd);
    }
  }
  exists(relativePath) {
    const parts = relativeSegments(relativePath);
    const name = parts.pop();
    let rootFd;
    let parentFd;
    let fileFd;
    try {
      rootFd = this.openRoot();
      try {
        parentFd = openRelativeParent(rootFd, parts, false);
      } catch (error) {
        if (errno(error) === "ENOENT")
          return false;
        throw error;
      }
      if (!lstatChild(parentFd, name))
        return false;
      fileFd = openVerifiedRegular(parentFd, name, FILE_READ_FLAGS);
      assertArtifactFileStat(fstatSync(fileFd), "artifact exists target is not a regular file");
      assertDirectoryName(this.path, this.expected);
      return true;
    } finally {
      if (fileFd !== undefined)
        closeSync(fileFd);
      if (parentFd !== undefined)
        closeSync(parentFd);
      if (rootFd !== undefined)
        closeSync(rootFd);
    }
  }
  delete(relativePath) {
    const parts = relativeSegments(relativePath);
    const name = parts.pop();
    let rootFd;
    let parentFd;
    let quarantine = "";
    try {
      rootFd = this.openRoot();
      try {
        parentFd = openRelativeParent(rootFd, parts, false);
      } catch (error) {
        if (errno(error) === "ENOENT")
          return;
        throw error;
      }
      const current = lstatChild(parentFd, name);
      if (!current)
        return;
      assertArtifactFileStat(current, "artifact delete target must be a regular file");
      quarantine = `.knowledge-delete-${process.pid}-${randomUUID()}`;
      renameSync(fdPath(parentFd, name), fdPath(parentFd, quarantine));
      const moved = lstatChild(parentFd, quarantine);
      if (!moved || moved.nlink !== 1 || !sameIdentity(identity(current), identity(moved))) {
        restoreRegularBackup(parentFd, quarantine, name);
        fail("artifact delete target identity changed");
      }
      unlinkSync(fdPath(parentFd, quarantine));
      quarantine = "";
      fsyncSync(parentFd);
      assertDirectoryName(this.path, this.expected);
    } finally {
      if (parentFd !== undefined) {
        if (quarantine)
          restoreRegularBackup(parentFd, quarantine, name);
        closeSync(parentFd);
      }
      if (rootFd !== undefined)
        closeSync(rootFd);
    }
  }
  list(prefix = "") {
    const prefixParts = prefix ? relativeSegments(prefix) : [];
    let rootFd;
    let startFd;
    try {
      rootFd = this.openRoot();
      try {
        startFd = openRelativeParent(rootFd, prefixParts, false);
      } catch (error) {
        if (errno(error) === "ENOENT")
          return [];
        throw error;
      }
      const output = [];
      let visited = 0;
      const visit = (directoryFd, pathParts) => {
        const entries = [];
        const directory = opendirSync(fdPath(directoryFd));
        try {
          for (;; ) {
            const entry = directory.readSync();
            if (!entry)
              break;
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
          if (!stat)
            fail("artifact entry changed while listing");
          if (stat.isSymbolicLink())
            fail("artifact list encountered a symlink");
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
              assertArtifactFileStat(fstatSync(fileFd), "artifact list encountered a non-regular file");
            } catch (error) {
              closeSync(fileFd);
              throw error;
            }
            closeSync(fileFd);
            output.push([...pathParts, entry].join("/"));
          } else {
            fail("artifact list encountered a non-regular entry");
          }
        }
      };
      visit(startFd, prefixParts);
      assertDirectoryName(this.path, this.expected);
      return output;
    } finally {
      if (startFd !== undefined)
        closeSync(startFd);
      if (rootFd !== undefined)
        closeSync(rootFd);
    }
  }
}
var AnchoredFilesystemError, DIRECTORY_FLAGS, FILE_READ_FLAGS, MAX_ANCHORED_CONFIG_BYTES = 1048576, MAX_ANCHORED_ARTIFACT_BYTES = 8388608, MAX_ANCHORED_ARTIFACT_NODES = 4096, ANCHORED_FILESYSTEM_SUPPORT, anchoredFsTestHook;
var init_anchored_fs = __esm(() => {
  AnchoredFilesystemError = class AnchoredFilesystemError extends Error {
    name = "AnchoredFilesystemError";
  };
  DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  FILE_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
  ANCHORED_FILESYSTEM_SUPPORT = Object.freeze({
    supportedPlatforms: ["linux", "darwin"],
    unsupportedBehavior: "fail-closed-before-filesystem-io"
  });
});

// src/input-limits.ts
import { isProxy } from "util/types";
function cloneBoundedDataGraph(value, options = {}) {
  const label = options.label === "Provider response" ? "Provider response" : options.label === "Stored data" ? "Stored data" : "Input";
  const maxBytes = options.maxBytes ?? MAX_INGEST_BODY_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_INGEST_BODY_BYTES) {
    throw new Error(`${label} byte limit must be between 0 and ${MAX_INGEST_BODY_BYTES}.`);
  }
  const active = new WeakSet;
  const clones = new WeakMap;
  const completedExpansionBytes = new WeakMap;
  let nodes = 0;
  let properties = 0;
  const boundedAdd = (left, right) => {
    const total = left + right;
    if (total > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes} byte hard limit.`);
    }
    return total;
  };
  const primitiveBytes = (entry) => {
    const serialized = JSON.stringify(entry);
    if (serialized === undefined) {
      throw new Error(`${label} contains unsupported non-data values.`);
    }
    const bytes = Buffer.byteLength(serialized);
    if (bytes > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes} byte hard limit.`);
    }
    return bytes;
  };
  const clone = (entry, depth) => {
    if (entry === undefined) {
      throw new Error(`${label} contains undefined, which is not JSON data.`);
    }
    if (entry === null || typeof entry === "boolean") {
      return {
        value: entry,
        expansionBytes: primitiveBytes(entry)
      };
    }
    if (typeof entry === "string") {
      return { value: entry, expansionBytes: primitiveBytes(entry) };
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry))
        throw new Error(`${label} contains a non-finite number.`);
      return { value: entry, expansionBytes: primitiveBytes(entry) };
    }
    if (typeof entry !== "object") {
      throw new Error(`${label} contains unsupported non-data values.`);
    }
    if (isProxy(entry))
      throw new Error(`${label} proxy inputs are unsupported.`);
    if (active.has(entry))
      throw new Error(`${label} cyclic graphs are unsupported.`);
    const existing = clones.get(entry);
    if (existing) {
      const expansionBytes2 = completedExpansionBytes.get(entry);
      if (expansionBytes2 === undefined) {
        throw new Error(`${label} cyclic graphs are unsupported.`);
      }
      return { value: existing, expansionBytes: expansionBytes2 };
    }
    if (++nodes > MAX_JSON_NODES) {
      throw new Error(`${label} exceeds the ${MAX_JSON_NODES} node hard limit.`);
    }
    if (depth > MAX_JSON_DEPTH) {
      throw new Error(`${label} exceeds the ${MAX_JSON_DEPTH} level depth hard limit.`);
    }
    const array = Array.isArray(entry);
    const prototype = Object.getPrototypeOf(entry);
    if (array && prototype !== Array.prototype || !array && prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} custom prototypes are unsupported.`);
    }
    if (array && entry.length > MAX_INGEST_BATCH_ITEMS) {
      throw new Error(`${label} array exceeds the ${MAX_INGEST_BATCH_ITEMS} item hard limit.`);
    }
    let keys;
    try {
      keys = Reflect.ownKeys(entry);
    } catch {
      throw new Error(`${label} properties could not be enumerated safely.`);
    }
    let dataKeys;
    if (array) {
      const expectedKeys = new Set(["length"]);
      for (let index = 0;index < entry.length; index += 1) {
        expectedKeys.add(String(index));
      }
      for (let index = 0;index < entry.length; index += 1) {
        if (!keys.includes(String(index))) {
          throw new Error(`${label} sparse arrays are unsupported.`);
        }
      }
      if (keys.length !== expectedKeys.size || keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
        throw new Error(`${label} array own keys must be exactly canonical dense indexes and length.`);
      }
      let lengthDescriptor;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(entry, "length");
      } catch {
        throw new Error(`${label} property descriptors could not be inspected safely.`);
      }
      if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== entry.length || lengthDescriptor.writable !== true || lengthDescriptor.enumerable !== false || lengthDescriptor.configurable !== false) {
        throw new Error(`${label} array length descriptor is noncanonical.`);
      }
      for (let index = 0;index < entry.length; index += 1) {
        let descriptor;
        try {
          descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
        } catch {
          throw new Error(`${label} property descriptors could not be inspected safely.`);
        }
        if (!descriptor)
          throw new Error(`${label} sparse arrays are unsupported.`);
        if (!("value" in descriptor))
          throw new Error(`${label} accessor properties are unsupported.`);
        if (descriptor.enumerable !== true || descriptor.writable !== true || descriptor.configurable !== true) {
          throw new Error(`${label} array index descriptor is noncanonical.`);
        }
      }
      dataKeys = Array.from({ length: entry.length }, (_, index) => String(index));
    } else {
      dataKeys = keys;
    }
    if (!array && dataKeys.length > MAX_JSON_OBJECT_PROPERTIES) {
      throw new Error(`${label} object exceeds the ${MAX_JSON_OBJECT_PROPERTIES} property hard limit.`);
    }
    properties += dataKeys.length;
    if (properties > MAX_JSON_PROPERTIES) {
      throw new Error(`${label} exceeds the ${MAX_JSON_PROPERTIES} property hard limit.`);
    }
    const target = array ? new Array(entry.length) : Object.create(null);
    clones.set(entry, target);
    active.add(entry);
    let expansionBytes = 2;
    for (const key of dataKeys) {
      if (typeof key !== "string")
        throw new Error(`${label} symbol properties are unsupported.`);
      if (DANGEROUS_DATA_KEYS.has(key)) {
        throw new Error(`${label} contains a dangerous key.`);
      }
      if (Buffer.byteLength(key) > MAX_JSON_KEY_BYTES) {
        throw new Error(`${label} exceeds the ${MAX_JSON_KEY_BYTES} key byte hard limit.`);
      }
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(entry, key);
      } catch {
        throw new Error(`${label} property descriptors could not be inspected safely.`);
      }
      if (!descriptor || !("value" in descriptor)) {
        throw new Error(`${label} accessor properties are unsupported.`);
      }
      if (!array && descriptor.enumerable !== true) {
        throw new Error(`${label} non-enumerable object properties are unsupported.`);
      }
      const cloned = clone(descriptor.value, depth + 1);
      const separatorBytes = expansionBytes === 2 ? 0 : 1;
      expansionBytes = boundedAdd(expansionBytes, separatorBytes);
      if (!array) {
        expansionBytes = boundedAdd(expansionBytes, Buffer.byteLength(JSON.stringify(key)) + 1);
      }
      expansionBytes = boundedAdd(expansionBytes, cloned.expansionBytes);
      Object.defineProperty(target, array ? Number(key) : key, {
        value: cloned.value,
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    active.delete(entry);
    completedExpansionBytes.set(entry, expansionBytes);
    return { value: target, expansionBytes };
  };
  return clone(value, 0).value;
}
function hardLimit(requested, fallback, maximum, label) {
  const value = requested ?? fallback;
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an integer between 0 and ${maximum}.`);
  }
  return value;
}
function assertBoundedJsonText(text, maxArrayItems = MAX_INGEST_BATCH_ITEMS, maxTopLevelValues = maxArrayItems) {
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_INGEST_BODY_BYTES) {
    throw new Error(`Input exceeds the ${MAX_INGEST_BODY_BYTES} byte hard limit.`);
  }
  let inString = false;
  let escaped = false;
  let depth = 0;
  let structural = 0;
  let properties = 0;
  let nodes = 0;
  let topLevelValues = 0;
  const frames = [];
  let topLevelValueActive = false;
  const markArrayValue = () => {
    const frame = frames.at(-1);
    if (frame?.kind !== "array" || !frame.expectsValue)
      return;
    frame.expectsValue = false;
    if (++frame.items > maxArrayItems) {
      throw new Error(`Input array exceeds the ${maxArrayItems} item hard limit.`);
    }
  };
  for (let index = 0;index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped)
        escaped = false;
      else if (char === "\\")
        escaped = true;
      else if (char === '"')
        inString = false;
      continue;
    }
    if (/\s/.test(char))
      continue;
    if (depth === 0 && !topLevelValueActive) {
      topLevelValueActive = true;
      if (++topLevelValues > maxTopLevelValues) {
        throw new Error(`Input exceeds the ${maxTopLevelValues} top-level item hard limit.`);
      }
    }
    if (char === '"') {
      markArrayValue();
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      markArrayValue();
      structural += 1;
      depth += 1;
      if (++nodes > MAX_JSON_NODES) {
        throw new Error(`Input exceeds the ${MAX_JSON_NODES} node hard limit.`);
      }
      if (depth > MAX_JSON_DEPTH)
        throw new Error(`Input exceeds the ${MAX_JSON_DEPTH} level JSON depth limit.`);
      frames.push(char === "[" ? { kind: "array", items: 0, expectsValue: true } : { kind: "object", properties: 0 });
    } else if (char === "}" || char === "]") {
      frames.pop();
      depth -= 1;
      if (depth === 0)
        topLevelValueActive = false;
    } else if (char === "," || char === ":") {
      structural += 1;
      const frame = frames.at(-1);
      if (char === "," && frame?.kind === "array")
        frame.expectsValue = true;
      if (char === ":" && frame?.kind === "object") {
        if (++frame.properties > MAX_JSON_OBJECT_PROPERTIES) {
          throw new Error(`Input object exceeds the ${MAX_JSON_OBJECT_PROPERTIES} property hard limit.`);
        }
        if (++properties > MAX_JSON_PROPERTIES) {
          throw new Error(`Input exceeds the ${MAX_JSON_PROPERTIES} property hard limit.`);
        }
      }
    } else {
      markArrayValue();
    }
    if (structural > MAX_JSON_STRUCTURAL_TOKENS) {
      throw new Error(`Input exceeds the ${MAX_JSON_STRUCTURAL_TOKENS} structural-token hard limit.`);
    }
  }
}
function parseBoundedJsonData(text, label = "Persisted JSON", maxArrayItems = MAX_INGEST_BATCH_ITEMS, maxTopLevelValues = 1) {
  assertBoundedJsonText(text, maxArrayItems, maxTopLevelValues);
  return cloneBoundedDataGraph(JSON.parse(text), {
    label,
    maxBytes: MAX_INGEST_BODY_BYTES
  });
}
var MAX_INGEST_BODY_BYTES = 8388608, MAX_INGEST_BATCH_ITEMS = 4096, MAX_JSON_STRUCTURAL_TOKENS = 65536, MAX_JSON_PROPERTIES = 32768, MAX_JSON_DEPTH = 64, MAX_JSON_OBJECT_PROPERTIES = 256, MAX_JSON_NODES = 4096, MAX_JSON_KEY_BYTES = 16384, DANGEROUS_DATA_KEYS;
var init_input_limits = __esm(() => {
  DANGEROUS_DATA_KEYS = new Set(["__proto__", "prototype", "constructor"]);
});

// src/runtime-role.ts
import { existsSync as existsSync2, readFileSync } from "fs";
import { isProxy as isProxy2 } from "util/types";
function configGraphIssue(root) {
  const seen = new WeakSet;
  const pending = [root];
  let nodes = 0;
  let properties = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value);
      if (bytes > MAX_CONFIG_BYTES)
        return "config exceeds the aggregate byte limit";
      continue;
    }
    if (!value || typeof value !== "object")
      continue;
    if (isProxy2(value))
      return "config proxy inputs are unsupported";
    if (seen.has(value))
      continue;
    let prototype;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      return "config prototype could not be inspected safely";
    }
    if (Array.isArray(value) && prototype !== Array.prototype || !Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      return "config custom prototypes are unsupported";
    }
    if (++nodes > MAX_CONFIG_NODES)
      return "config exceeds the aggregate node limit";
    seen.add(value);
    if (Array.isArray(value) && value.length > MAX_CONFIG_ARRAY_ITEMS) {
      return "config array exceeds the aggregate item limit";
    }
    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return "config properties could not be enumerated safely";
    }
    properties += keys.length;
    if (properties > MAX_CONFIG_PROPERTIES)
      return "config exceeds the aggregate property limit";
    for (const key of keys) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        return "config property descriptors could not be inspected safely";
      }
      if (!descriptor || !("value" in descriptor))
        return "config accessor properties are unsupported";
      pending.push(descriptor.value);
    }
  }
  return null;
}
function configRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function safeRelativePath(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\x00") || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }
  const segments = value.replace(/\\/g, "/").split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
function optionalStringIssue(record, key, label, allowEmpty = false) {
  const value = record[key];
  if (value === undefined)
    return null;
  if (typeof value !== "string" || !allowEmpty && !value.trim()) {
    return `${label} must be ${allowEmpty ? "a string" : "a non-empty string"} when present`;
  }
  return null;
}
function optionalBooleanIssue(record, key, label) {
  const value = record[key];
  return value === undefined || typeof value === "boolean" ? null : `${label} must be a boolean when present`;
}
function optionalPositiveIntegerIssue(record, key, label) {
  const value = record[key];
  return value === undefined || typeof value === "number" && Number.isInteger(value) && value > 0 ? null : `${label} must be a positive integer when present`;
}
function knowledgeConfigValidationIssue(value) {
  let cloned;
  try {
    cloned = cloneBoundedDataGraph(value, {
      label: "config",
      maxBytes: MAX_CONFIG_BYTES
    });
  } catch (error) {
    return error instanceof Error ? error.message : "config could not be cloned safely";
  }
  const graphIssue = configGraphIssue(cloned);
  if (graphIssue)
    return graphIssue;
  const config = configRecord(cloned);
  if (!config)
    return "config root must be an object";
  if (config.version !== 1)
    return "config version must be 1";
  if (config.mode !== "local" && config.mode !== "hosted") {
    return "config mode must be exactly local or hosted";
  }
  const storage = configRecord(config.storage);
  if (!storage)
    return "config storage must be an object";
  if (storage.type !== "local" && storage.type !== "s3") {
    return "config storage.type must be local or s3";
  }
  if (config.mode === "local" && storage.type === "s3") {
    return "config mode local must not select S3 storage";
  }
  if (!safeRelativePath(storage.artifacts_root)) {
    return "config storage.artifacts_root must be a safe relative path";
  }
  if (storage.type === "s3") {
    const s3 = configRecord(storage.s3);
    if (!s3 || typeof s3.bucket !== "string" || !s3.bucket.trim()) {
      return "config S3 storage requires a non-empty bucket";
    }
  }
  if (storage.type === "local" && storage.s3 !== undefined) {
    return "config local storage must not include storage.s3";
  }
  if (storage.s3 !== undefined) {
    const s3 = configRecord(storage.s3);
    if (!s3)
      return "config storage.s3 must be an object when present";
    for (const [key, label, allowEmpty] of [
      ["bucket", "config storage.s3.bucket", false],
      ["prefix", "config storage.s3.prefix", true],
      ["region", "config storage.s3.region", false],
      ["profile", "config storage.s3.profile", false],
      ["kms_key_id", "config storage.s3.kms_key_id", false]
    ]) {
      const issue = optionalStringIssue(s3, key, label, allowEmpty);
      if (issue)
        return issue;
    }
    const attemptsIssue = optionalPositiveIntegerIssue(s3, "max_attempts", "config storage.s3.max_attempts");
    if (attemptsIssue)
      return attemptsIssue;
    if (s3.server_side_encryption !== undefined && s3.server_side_encryption !== "AES256" && s3.server_side_encryption !== "aws:kms") {
      return "config storage.s3.server_side_encryption must be AES256 or aws:kms when present";
    }
  }
  const sources = configRecord(config.sources);
  if (!sources || sources.preferred_ref !== "open-files") {
    return "config sources.preferred_ref must be open-files";
  }
  if (!Array.isArray(sources.allowed_schemes) || sources.allowed_schemes.some((entry) => typeof entry !== "string" || !entry.trim())) {
    return "config sources.allowed_schemes must be an array of non-empty strings";
  }
  for (const key of ["hosted", "embeddings", "providers", "safety"]) {
    if (config[key] !== undefined && !configRecord(config[key])) {
      return `config ${key} must be an object when present`;
    }
  }
  const hosted = configRecord(config.hosted);
  if (hosted?.api_url !== undefined && (typeof hosted.api_url !== "string" || !hosted.api_url.trim())) {
    return "config hosted.api_url must be a non-empty string when present";
  }
  const embeddings = configRecord(config.embeddings);
  if (embeddings) {
    const modelIssue = optionalStringIssue(embeddings, "default_model", "config embeddings.default_model");
    if (modelIssue)
      return modelIssue;
    for (const key of ["dimensions", "batch_size", "max_parallel_calls"]) {
      const issue = optionalPositiveIntegerIssue(embeddings, key, `config embeddings.${key}`);
      if (issue)
        return issue;
    }
  }
  const providers = configRecord(config.providers);
  if (providers) {
    const modelIssue = optionalStringIssue(providers, "default_model", "config providers.default_model");
    if (modelIssue)
      return modelIssue;
    if (providers.aliases !== undefined) {
      const aliases = configRecord(providers.aliases);
      if (!aliases || Object.entries(aliases).some(([key, value2]) => !key.trim() || typeof value2 !== "string" || !value2.trim())) {
        return "config providers.aliases must map non-empty names to non-empty strings";
      }
    }
    for (const providerName of ["openai", "anthropic", "deepseek"]) {
      if (providers[providerName] === undefined)
        continue;
      const provider = configRecord(providers[providerName]);
      if (!provider)
        return `config providers.${providerName} must be an object when present`;
      for (const key of ["api_key_env", "base_url", "default_model"]) {
        const issue = optionalStringIssue(provider, key, `config providers.${providerName}.${key}`);
        if (issue)
          return issue;
      }
    }
  }
  const safety = configRecord(config.safety);
  if (safety) {
    if (safety.network !== undefined) {
      const network = configRecord(safety.network);
      if (!network)
        return "config safety.network must be an object when present";
      for (const key of ["web_search_enabled", "s3_reads_enabled"]) {
        const issue = optionalBooleanIssue(network, key, `config safety.network.${key}`);
        if (issue)
          return issue;
      }
      if (network.allowed_s3_buckets !== undefined && (!Array.isArray(network.allowed_s3_buckets) || network.allowed_s3_buckets.some((entry) => typeof entry !== "string" || !entry.trim()))) {
        return "config safety.network.allowed_s3_buckets must be an array of non-empty strings";
      }
    }
    if (safety.redaction !== undefined) {
      const redaction = configRecord(safety.redaction);
      if (!redaction)
        return "config safety.redaction must be an object when present";
      const issue = optionalBooleanIssue(redaction, "enabled", "config safety.redaction.enabled");
      if (issue)
        return issue;
    }
    if (safety.approvals !== undefined) {
      const approvals = configRecord(safety.approvals);
      if (!approvals)
        return "config safety.approvals must be an object when present";
      const issue = optionalBooleanIssue(approvals, "generated_writes_require_approval", "config safety.approvals.generated_writes_require_approval");
      if (issue)
        return issue;
    }
  }
  return null;
}
function configContainmentError(detail, surface = "public-api") {
  return new KnowledgeContainmentError("KNOWLEDGE_CONFIG_INVALID", 503, "invalid", surface, `${detail}; no Knowledge write or data-plane I/O was attempted`);
}
function assertValidKnowledgeConfig(value, surface = "public-api") {
  const issue = knowledgeConfigValidationIssue(value);
  if (issue)
    throw configContainmentError(issue, surface);
}
function readRegularConfigTextNoFollow(path) {
  try {
    return readAnchoredRegularFileSnapshot(path, MAX_CONFIG_BYTES)?.content;
  } catch (error) {
    if (error instanceof AnchoredFilesystemError) {
      throw configContainmentError(error.message);
    }
    throw configContainmentError("config could not be opened through its anchored directory");
  }
}
function readValidatedKnowledgeConfig(configPath, fs = roleFs) {
  let raw;
  if (fs === roleFs) {
    raw = readRegularConfigTextNoFollow(configPath);
  } else {
    if (!fs.existsSync(configPath))
      return;
    raw = fs.readFileSync(configPath, "utf8");
  }
  if (raw === undefined)
    return;
  if (Buffer.byteLength(raw) > MAX_CONFIG_BYTES) {
    throw configContainmentError(`config exceeds the ${MAX_CONFIG_BYTES} byte hard limit`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configContainmentError("config JSON is malformed");
  }
  assertValidKnowledgeConfig(parsed);
  return parsed;
}
function normalizeMode(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local" || normalized === "offline" || normalized === "standalone" || normalized === "desktop")
    return "local";
  if (normalized === "cloud" || normalized === "hosted" || normalized === "hosted_client" || normalized === "hosted_server" || normalized === "self_hosted" || normalized === "remote" || normalized === "hybrid")
    return "hosted";
  return null;
}
function normalizeBooleanMode(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on")
    return "hosted";
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off")
    return "local";
  return null;
}
function environmentLayers(supplied) {
  const ambient = process.env;
  if (!supplied || supplied === ambient)
    return [{ name: "ambient", env: ambient }];
  return [
    { name: "ambient", env: ambient },
    { name: "supplied", env: supplied }
  ];
}
function safeEnvironmentValue(layer, key, addIssue) {
  try {
    let owner = layer.env;
    let raw;
    while (owner) {
      if (isProxy2(owner)) {
        addIssue(`unreadable-env:${layer.name}:${key}`);
        return;
      }
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor) {
        if (!("value" in descriptor)) {
          addIssue(`unreadable-env:${layer.name}:${key}`);
          return;
        }
        raw = descriptor.value;
        break;
      }
      owner = Object.getPrototypeOf(owner);
    }
    if (raw === undefined || raw === null || raw === "")
      return;
    if (typeof raw !== "string") {
      addIssue(`non-string-env:${layer.name}:${key}`);
      return;
    }
    return raw.trim() || undefined;
  } catch {
    addIssue(`unreadable-env:${layer.name}:${key}`);
    return;
  }
}
function environmentSignals(layers, keys, addIssue) {
  const entries = [];
  for (const layer of layers) {
    for (const key of keys) {
      const value = safeEnvironmentValue(layer, key, addIssue);
      if (value)
        entries.push({ source: `${layer.name}:${key}`, value });
    }
  }
  return entries;
}
function distinctSignalValues(entries) {
  return new Set(entries.map(({ value }) => value)).size;
}
function resolveKnowledgeRuntimeRole(intent = {}) {
  const layers = environmentLayers(intent.env);
  const surface = intent.surface ?? "public-api";
  const signals = [];
  const issues = [];
  const modeSignals = [];
  const addIssue = (issue) => {
    if (!issues.includes(issue))
      issues.push(issue);
  };
  const collectMode = (source, value, normalize2 = normalizeMode) => {
    const trimmed = value?.trim();
    if (!trimmed)
      return;
    signals.push(source);
    const mode = normalize2(trimmed);
    if (!mode)
      addIssue(`unknown-mode:${source}`);
    else
      modeSignals.push({ source, mode });
  };
  collectMode("explicit-mode", intent.explicitMode);
  collectMode("config-mode", intent.configMode);
  for (const layer of layers) {
    for (const key of MODE_KEYS) {
      collectMode(`${layer.name}:${key}`, safeEnvironmentValue(layer, key, addIssue));
    }
    for (const key of ROLE_KEYS) {
      collectMode(`${layer.name}:${key}`, safeEnvironmentValue(layer, key, addIssue));
    }
    for (const key of HOSTED_BOOLEAN_KEYS) {
      collectMode(`${layer.name}:${key}`, safeEnvironmentValue(layer, key, addIssue), normalizeBooleanMode);
    }
  }
  const apiUrls = environmentSignals(layers, API_URL_KEYS, addIssue);
  const apiKeys = environmentSignals(layers, API_KEY_KEYS, addIssue);
  const databaseUrls = environmentSignals(layers, DATABASE_URL_KEYS, addIssue);
  signals.push(...apiUrls.map(({ source }) => source), ...apiKeys.map(({ source }) => source), ...databaseUrls.map(({ source }) => source));
  if (distinctSignalValues(apiUrls) > 1)
    addIssue("conflicting-api-url-aliases");
  if (distinctSignalValues(apiKeys) > 1)
    addIssue("conflicting-api-key-aliases");
  if (distinctSignalValues(databaseUrls) > 1)
    addIssue("conflicting-database-url-aliases");
  for (const layer of layers) {
    const layerUrls = environmentSignals([layer], API_URL_KEYS, addIssue);
    const layerKeys = environmentSignals([layer], API_KEY_KEYS, addIssue);
    if (layerUrls.length > 0 !== layerKeys.length > 0)
      addIssue(`partial-http-intent:${layer.name}`);
  }
  const distinctModes = new Set(modeSignals.map(({ mode }) => mode));
  if (distinctModes.size > 1)
    addIssue("conflicting-modes");
  const explicitLocal = modeSignals.some(({ mode }) => mode === "local");
  const explicitHosted = modeSignals.some(({ mode }) => mode === "hosted");
  const activeHostedSignal = apiUrls.length > 0 || apiKeys.length > 0 || databaseUrls.length > 0 || Boolean(intent.hostedRequested);
  const hasApiUrl = apiUrls.length > 0;
  const hasApiKey = apiKeys.length > 0;
  if (hasApiUrl !== hasApiKey)
    addIssue("partial-http-intent");
  if (!explicitHosted && databaseUrls.length > 0)
    addIssue("database-url-without-hosted-mode");
  if (explicitLocal && activeHostedSignal)
    addIssue("local-hosted-conflict");
  const surfaceIsServer = surface === "server";
  const surfaceIsOperator = surface === "operator-migration";
  if (surfaceIsServer && explicitLocal)
    addIssue("server-local-conflict");
  if (surfaceIsOperator)
    addIssue("operator-capability-required");
  const hosted = explicitHosted || Boolean(intent.hostedRequested) || hasApiUrl && hasApiKey || surfaceIsServer;
  if (hosted && intent.localStoreOverride)
    addIssue("hosted-local-store-conflict");
  if (issues.length > 0) {
    return { role: "invalid", surface, source: "invalid", signals, issues };
  }
  if (hosted) {
    return {
      role: surfaceIsServer ? "hosted-server" : "hosted-client",
      surface,
      source: explicitHosted ? "mode" : intent.hostedRequested ? "operation" : surfaceIsServer ? "surface" : "http-config",
      signals,
      issues
    };
  }
  return {
    role: "local",
    surface,
    source: explicitLocal ? "mode" : "legacy-default",
    signals,
    issues
  };
}
function assertKnowledgeLocalRuntimeWithConfig(intent, readConfigMode) {
  return assertKnowledgeLocalRuntime(resolveKnowledgeRuntimeRoleWithConfig(intent, readConfigMode));
}
function resolveKnowledgeRuntimeRoleWithConfig(intent, readConfigMode) {
  const preliminary = resolveKnowledgeRuntimeRole(intent);
  if (preliminary.role !== "local")
    return preliminary;
  return resolveKnowledgeRuntimeRole({ ...intent, configMode: readConfigMode() });
}
function assertKnowledgeLocalRuntimeForConfigPath(intent, configPath, fs = roleFs, required = false) {
  return assertKnowledgeLocalRuntimeWithConfig(intent, () => readKnowledgeConfiguredMode(configPath, fs, required));
}
function containmentErrorFor(resolution) {
  if (resolution.role === "invalid") {
    if (resolution.issues.includes("unknown-mode:config-mode")) {
      return configContainmentError("persisted or supplied config is structurally invalid", resolution.surface);
    }
    return new KnowledgeContainmentError("KNOWLEDGE_RUNTIME_INTENT_INVALID", 503, resolution.role, resolution.surface, "runtime intent is incomplete, unknown, or conflicting; no Knowledge I/O was attempted");
  }
  if (resolution.role === "operator-migration") {
    return new KnowledgeContainmentError("KNOWLEDGE_OPERATOR_REQUIRED", 503, resolution.role, resolution.surface, "operator-only operation is unavailable through this public boundary");
  }
  return new KnowledgeContainmentError("KNOWLEDGE_HOSTED_CONTAINED", 503, resolution.role, resolution.surface, "hosted Knowledge access is disabled until trusted project authority is available");
}
function assertKnowledgeLocalRuntime(intentOrResolution = {}) {
  const resolution = "role" in intentOrResolution ? intentOrResolution : resolveKnowledgeRuntimeRole(intentOrResolution);
  if (resolution.role !== "local")
    throw containmentErrorFor(resolution);
  return resolution;
}
function readKnowledgeConfiguredMode(configPath, fs = roleFs, required = false) {
  try {
    const parsed = readValidatedKnowledgeConfig(configPath, fs);
    if (!parsed)
      return required ? INVALID_CONFIG_MODE : undefined;
    return configuredModeFromValidatedConfig(parsed);
  } catch {
    return INVALID_CONFIG_MODE;
  }
}
function configuredModeFromValidatedConfig(parsed) {
  const storage = parsed.storage;
  return parsed.mode === "hosted" || storage.type === "s3" ? "hosted" : "local";
}
function authorityContainmentError(authority, surface = "server") {
  if (!authority || authority.trust === "missing" || authority.trust === "untrusted") {
    return new KnowledgeContainmentError("KNOWLEDGE_AUTHORITY_UNAVAILABLE", 503, "hosted-server", surface, "trusted tenant and project authority is unavailable");
  }
  if (authority.projectGrants.length === 0) {
    return new KnowledgeContainmentError("KNOWLEDGE_PROJECT_FORBIDDEN", 403, "hosted-server", surface, "the trusted principal has no Knowledge project grant");
  }
  return new KnowledgeContainmentError("KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED", 503, "hosted-server", surface, "positive hosted access is intentionally disabled during Stage A");
}
var roleFs, INVALID_CONFIG_MODE = "__invalid_config__", MAX_CONFIG_ARRAY_ITEMS = 4096, MAX_CONFIG_PROPERTIES = 4096, MAX_CONFIG_NODES = 2048, MAX_CONFIG_BYTES = 1048576, MODE_KEYS, ROLE_KEYS, HOSTED_BOOLEAN_KEYS, API_URL_KEYS, API_KEY_KEYS, DATABASE_URL_KEYS, MAX_KNOWLEDGE_DIAGNOSTIC_BYTES = 384, CONTAINMENT_MESSAGES, KnowledgeContainmentError;
var init_runtime_role = __esm(() => {
  init_anchored_fs();
  init_input_limits();
  roleFs = {
    existsSync: existsSync2,
    readFileSync
  };
  MODE_KEYS = [
    "HASNA_KNOWLEDGE_STORAGE_MODE",
    "KNOWLEDGE_STORAGE_MODE",
    "HASNA_KNOWLEDGE_MODE",
    "KNOWLEDGE_MODE"
  ];
  ROLE_KEYS = [
    "CODEWITH_RUNTIME_ROLE",
    "CODEWITH_EXECUTION_ROLE",
    "CODEWITH_AGENT_ROLE",
    "CODEWITH_ROLE",
    "KNOWLEDGE_RUNTIME_ROLE",
    "KNOWLEDGE_EXECUTION_ROLE",
    "KNOWLEDGE_AGENT_ROLE",
    "KNOWLEDGE_ROLE"
  ];
  HOSTED_BOOLEAN_KEYS = [
    "CODEWITH_HOSTED",
    "KNOWLEDGE_HOSTED"
  ];
  API_URL_KEYS = [
    "HASNA_KNOWLEDGE_API_URL",
    "HASNA_KNOWLEDGE_API_BASE_URL",
    "KNOWLEDGE_API_URL",
    "KNOWLEDGE_API_BASE_URL",
    "OPEN_KNOWLEDGE_API_URL"
  ];
  API_KEY_KEYS = [
    "HASNA_KNOWLEDGE_API_KEY",
    "KNOWLEDGE_API_KEY",
    "OPEN_KNOWLEDGE_API_KEY"
  ];
  DATABASE_URL_KEYS = [
    "HASNA_KNOWLEDGE_DATABASE_URL",
    "KNOWLEDGE_DATABASE_URL",
    "HASNA_KNOWLEDGE_DATABASE_URL_OWNER"
  ];
  CONTAINMENT_MESSAGES = {
    KNOWLEDGE_RUNTIME_INTENT_INVALID: "runtime intent was rejected before Knowledge I/O",
    KNOWLEDGE_CONFIG_INVALID: "configuration was rejected before Knowledge I/O",
    KNOWLEDGE_HOSTED_CONTAINED: "hosted capability is unavailable during Stage A",
    KNOWLEDGE_AUTHORITY_UNAVAILABLE: "trusted authority is unavailable during Stage A",
    KNOWLEDGE_PROJECT_FORBIDDEN: "project authority denied Knowledge access",
    KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED: "positive hosted authority is disabled during Stage A",
    KNOWLEDGE_OPERATOR_REQUIRED: "operator capability is required for this operation"
  };
  KnowledgeContainmentError = class KnowledgeContainmentError extends Error {
    code;
    status;
    role;
    surface;
    name = "KnowledgeContainmentError";
    constructor(code, status, role, surface, _detail) {
      const message = `${code}: ${CONTAINMENT_MESSAGES[code]}`;
      super(Buffer.byteLength(message) <= MAX_KNOWLEDGE_DIAGNOSTIC_BYTES ? message : `${code}: contained`);
      this.code = code;
      this.status = status;
      this.role = role;
      this.surface = surface;
    }
    toJSON() {
      const payload = {
        ok: false,
        code: this.code,
        status: this.status,
        role: this.role,
        surface: this.surface,
        message: this.message
      };
      if (Buffer.byteLength(JSON.stringify(payload)) > MAX_KNOWLEDGE_DIAGNOSTIC_BYTES) {
        return { ...payload, message: `${this.code}: contained` };
      }
      return payload;
    }
  };
});

// src/serve.ts
init_runtime_role();
import { readFileSync as readFileSync2 } from "fs";
var KNOWLEDGE_SERVE_APP = "knowledge";
function normalizeCloudDatabaseUrl() {
  return;
}
function resolveVersion() {
  if (process.env.HASNA_KNOWLEDGE_VERSION)
    return process.env.HASNA_KNOWLEDGE_VERSION;
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync2(url, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return process.env.npm_package_version ?? "0.0.0";
  }
}
function containedNoteRepo() {
  throw authorityContainmentError(undefined, "server");
}

class NoteRepo {
  constructor(client) {
    Object.defineProperty(this, "client", {
      value: undefined,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  async create(input) {
    return containedNoteRepo();
  }
  async list() {
    return containedNoteRepo();
  }
  async get(idOrShort) {
    return containedNoteRepo();
  }
  async update(idOrShort, patch) {
    return containedNoteRepo();
  }
  async delete(idOrShort) {
    return containedNoteRepo();
  }
}
function knowledgeOpenApi(version) {
  const containmentResponseRefs = {
    "403": { $ref: "#/components/responses/KnowledgeProjectForbidden" },
    "503": { $ref: "#/components/responses/KnowledgeUnavailable" }
  };
  const stageAOperation = {
    description: "Disabled during Stage A. Project-authority containment is evaluated before authentication; future positive authority is explicitly deferred.",
    deprecated: true,
    security: [],
    "x-knowledge-stage-a-containment": "pre-auth",
    "x-knowledge-operation-enabled": false
  };
  const noteSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      short_id: { type: "string", nullable: true },
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" },
      created_at: { type: "string" },
      updated_at: { type: "string" }
    },
    required: ["id", "title", "content", "tags", "archived", "created_at", "updated_at"]
  };
  const noteInput = {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true }
    },
    required: ["title"]
  };
  const notePatch = {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" }
    }
  };
  return {
    openapi: "3.0.3",
    info: {
      title: "Knowledge",
      version,
      description: "@hasna/knowledge Stage-A contained HTTP API; data operations fail before authentication or datastore access."
    },
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        Note: noteSchema,
        NoteInput: noteInput,
        NotePatch: notePatch,
        NoteList: {
          type: "object",
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/Note" } },
            total: { type: "integer" }
          },
          required: ["items", "total"]
        },
        KnowledgeContainmentResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", enum: [false] },
            code: {
              type: "string",
              enum: [
                "KNOWLEDGE_AUTHORITY_UNAVAILABLE",
                "KNOWLEDGE_PROJECT_FORBIDDEN",
                "KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED"
              ]
            },
            status: { type: "integer", enum: [403, 503] },
            role: { type: "string", enum: ["hosted-server"] },
            surface: { type: "string", enum: ["server"] },
            message: { type: "string" }
          },
          required: ["ok", "code", "status", "role", "surface", "message"]
        }
      },
      responses: {
        KnowledgeProjectForbidden: {
          description: "Trusted server-side authority has zero Knowledge project grants; evaluated before authentication.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/KnowledgeContainmentResponse" } }
          }
        },
        KnowledgeUnavailable: {
          description: "Authority is missing or untrusted, or positive hosted authority remains disabled; evaluated before authentication.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/KnowledgeContainmentResponse" } }
          }
        }
      }
    },
    security: [],
    paths: {
      "/v1/notes": {
        get: {
          ...stageAOperation,
          operationId: "listNotes",
          summary: "List knowledge items",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } }
          ],
          responses: {
            ...containmentResponseRefs
          }
        },
        post: {
          ...stageAOperation,
          operationId: "createNote",
          summary: "Create a knowledge item",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NoteInput" } } }
          },
          responses: {
            ...containmentResponseRefs
          }
        }
      },
      "/v1/notes/{id}": {
        get: {
          ...stageAOperation,
          operationId: "getNote",
          summary: "Fetch a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            ...containmentResponseRefs
          }
        },
        patch: {
          ...stageAOperation,
          operationId: "updateNote",
          summary: "Update a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NotePatch" } } }
          },
          responses: {
            ...containmentResponseRefs
          }
        },
        delete: {
          ...stageAOperation,
          operationId: "deleteNote",
          summary: "Delete a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            ...containmentResponseRefs
          }
        }
      },
      "/v1/registry": {
        get: {
          ...stageAOperation,
          operationId: "getRegistry",
          summary: "Knowledge registry contract",
          responses: {
            ...containmentResponseRefs
          }
        }
      }
    }
  };
}

class HttpError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
function createServeHandler(deps) {
  const internalDeps = deps;
  const mode = "contained";
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    try {
      if (path === "/health" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode });
      }
      if (path === "/version" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode });
      }
      if (path === "/ready" && method === "GET") {
        const error = authorityContainmentError(internalDeps.authority, "server");
        const { status: httpStatus, ...containment } = error.toJSON();
        return json({
          status: "unavailable",
          http_status: httpStatus,
          version: deps.version,
          mode,
          ...containment
        }, 503);
      }
      if (path === "/openapi.json" && method === "GET") {
        return json(knowledgeOpenApi(deps.version));
      }
      if (path === "/v1/registry" || path === "/v1/notes" || path.startsWith("/v1/notes/")) {
        const error = authorityContainmentError(internalDeps.authority, "server");
        return json(error.toJSON(), error.status);
      }
      return json({ error: "not_found", path }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        const reason = error.status === 401 || error.status === 403 ? "unauthorized" : "error";
        return json({ error: reason, message: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "internal error";
      return json({ error: "internal", message }, 500);
    }
  };
}
async function startKnowledgeServe(options = {}) {
  const runtimeOptions = options;
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_KNOWLEDGE_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? "0.0.0.0";
  const version = runtimeOptions.version ?? resolveVersion();
  const handler = createServeHandler({
    client: undefined,
    verifier: undefined,
    store: undefined,
    version
  });
  const BunGlobal = globalThis.Bun;
  if (!BunGlobal?.serve) {
    throw new Error("knowledge-serve requires the Bun runtime (Bun.serve unavailable).");
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(`[knowledge-serve] listening on http://${hostname}:${server.port} (mode=contained, version=${version})`);
  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
    }
  };
}
export {
  startKnowledgeServe,
  normalizeCloudDatabaseUrl,
  knowledgeOpenApi,
  createServeHandler,
  NoteRepo,
  KNOWLEDGE_SERVE_APP
};
