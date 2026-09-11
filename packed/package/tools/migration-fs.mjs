// Migration-only POSIX boundary. Node path APIs cannot prevent a parent-symlink
// race; all writes use openat/mkdirat relative to held, no-follow directory FDs.
// No native dependency is installed. Unsupported runtimes/platforms fail closed.
import { dlopen, ptr } from 'bun:ffi';
import { closeSync, constants, fstatSync, openSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';

let libc;
function native() {
  if (!libc) {
    const library = { darwin: '/usr/lib/libSystem.B.dylib', linux: 'libc.so.6' }[process.platform];
    if (!library) throw new Error('notes: secure migration requires macOS or Linux with Bun.');
    libc = dlopen(library, {
      openat: { args: ['i32', 'ptr', 'i32', 'u32'], returns: 'i32' },
      mkdirat: { args: ['i32', 'ptr', 'u32'], returns: 'i32' },
    });
  }
  return libc.symbols;
}

export function sameDirectory(a, b) {
  return !!a && !!b && Number(a.dev) === Number(b.dev) && Number(a.ino) === Number(b.ino)
    && (a.mode & 0o170000) === (b.mode & 0o170000);
}

function component(name) {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new Error('notes: unsafe migration path component.');
  }
  return Buffer.from(`${name}\0`);
}

export function openAt(parent, name, flags, mode = 0) {
  const bytes = component(name);
  const fd = native().openat(parent, ptr(bytes), flags | constants.O_NOFOLLOW | constants.O_CLOEXEC, mode);
  if (fd < 0) throw new Error('notes: migration path changed, is unsafe, or already exists; no overwrite allowed.');
  return fd;
}

/** Hold every traversed directory until close(), including newly created ones. */
export function directorySession(expected = []) {
  const states = new Map(expected.map((item) => [item.path, item.identity]));
  const held = new Map();
  const root = parse(resolve('/')).root;
  held.set(root, openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW));
  function open(path, create = false) {
    path = resolve(path);
    let cursor = root;
    let fd = held.get(root);
    for (const name of path.slice(root.length).split(sep).filter(Boolean)) {
      cursor = join(cursor, name);
      if (held.has(cursor)) { fd = held.get(cursor); continue; }
      if (states.has(cursor) && states.get(cursor) === null && create) {
        const bytes = component(name);
        if (native().mkdirat(fd, ptr(bytes), 0o700) !== 0) {
          throw new Error('notes: migration destination appeared after planning or cannot be created.');
        }
      }
      const next = openAt(fd, name, constants.O_RDONLY | constants.O_DIRECTORY);
      const stat = fstatSync(next);
      if (states.has(cursor) && (states.get(cursor) === null || !sameDirectory(states.get(cursor), stat))) {
        if (!(create && states.get(cursor) === null)) {
          closeSync(next);
          throw new Error('notes: migration directory identity changed after planning.');
        }
      }
      held.set(cursor, next);
      fd = next;
    }
    return fd;
  }
  function assertLinked() {
    // Detect renames/replacements; even a swap after this check cannot redirect
    // an openat write, which remains pinned to the reviewed directory inode.
    const fresh = directorySession();
    try {
      for (const [path, fd] of held) {
        if (!sameDirectory(fstatSync(fd), fstatSync(fresh.open(path)))) {
          throw new Error('notes: migration directory identity changed during apply.');
        }
      }
    } finally { fresh.close(); }
  }
  return {
    open, assertLinked,
    close() { for (const fd of [...held.values()].reverse()) closeSync(fd); held.clear(); },
  };
}
