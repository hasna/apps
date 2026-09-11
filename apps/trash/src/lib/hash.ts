/**
 * Content hashing for capture.
 *
 * The digest is taken ONCE at capture and is what a remote confirmation is
 * later checked against (§6 "Confirmed must be verifiable"). Two honest
 * caveats from the plan live here rather than in a comment nobody reads:
 *
 *  - a captured loose file is a hard link while the original name exists, so
 *    it is not an immutable snapshot; a later mismatch is a DIVERGENCE to
 *    report, not corruption to "fix";
 *  - a directory tree is digested by a canonical walk (`lstat` only, sorted
 *    relative paths, per-entry type/size/digest), which is stable across
 *    machines for the same tree shape and contents.
 *
 * Hashing is bounded by `capture.maxEntryBytes`: the walk throws
 * `EntryTooLargeError` as soon as the total exceeds the cap, so a 400 GB tree
 * is refused without being read to the end.
 */

import { createHash, type Hash } from "node:crypto";
import { closeSync, lstatSync, openSync, readSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export class EntryTooLargeError extends Error {
  constructor(
    public readonly sizeBytes: number,
    public readonly maxBytes: number,
  ) {
    super(`entry is ${sizeBytes} bytes, over the ${maxBytes}-byte capture cap`);
    this.name = "EntryTooLargeError";
  }
}

export type HashedKind = "file" | "dir" | "symlink";

export interface HashResult {
  kind: HashedKind;
  /** Total payload bytes: file size, tree total, or symlink target length. */
  sizeBytes: number;
  sha256: string;
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const READ_CHUNK = 64 * 1024;

function hashFileInto(hash: Hash, path: string): void {
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(READ_CHUNK);
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, READ_CHUNK, null);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
}

function walkInto(
  hash: Hash,
  path: string,
  relative: string,
  state: { sizeBytes: number; maxBytes: number },
): void {
  const info = lstatSync(path);
  if (info.isDirectory()) {
    hash.update(`d\0${relative}\0\0\n`);
    const names = readdirSync(path).sort();
    for (const name of names) {
      walkInto(hash, join(path, name), relative.length === 0 ? name : `${relative}/${name}`, state);
    }
    return;
  }
  if (info.isSymbolicLink()) {
    const target = readlinkSync(path);
    state.sizeBytes += Buffer.byteLength(target, "utf8");
    if (state.sizeBytes > state.maxBytes) throw new EntryTooLargeError(state.sizeBytes, state.maxBytes);
    hash.update(`l\0${relative}\0${Buffer.byteLength(target, "utf8")}\0${sha256Text(target)}\n`);
    return;
  }
  if (!info.isFile()) {
    throw new Error(`unsupported entry type at ${path}: ${info.isFIFO() ? "fifo" : info.isSocket() ? "socket" : "device"}`);
  }
  state.sizeBytes += info.size;
  if (state.sizeBytes > state.maxBytes) throw new EntryTooLargeError(state.sizeBytes, state.maxBytes);
  const fileHash = createHash("sha256");
  hashFileInto(fileHash, path);
  hash.update(`f\0${relative}\0${info.size}\0${fileHash.digest("hex")}\n`);
}

/**
 * Hash a path without ever traversing a symlink as if it were its target:
 * a symlink hashes as its target STRING, a directory hashes as a canonical
 * walk of its `lstat`-ed children.
 */
export function hashPath(path: string, options: { maxBytes: number }): HashResult {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) {
    const target = readlinkSync(path);
    return { kind: "symlink", sizeBytes: Buffer.byteLength(target, "utf8"), sha256: sha256Text(target) };
  }
  if (info.isDirectory()) {
    const hash = createHash("sha256");
    const state = { sizeBytes: 0, maxBytes: options.maxBytes };
    walkInto(hash, path, "", state);
    return { kind: "dir", sizeBytes: state.sizeBytes, sha256: hash.digest("hex") };
  }
  if (!info.isFile()) {
    throw new Error(
      `unsupported entry type at ${path}: ${info.isFIFO() ? "fifo" : info.isSocket() ? "socket" : "device"}`,
    );
  }
  if (info.size > options.maxBytes) throw new EntryTooLargeError(info.size, options.maxBytes);
  const hash = createHash("sha256");
  hashFileInto(hash, path);
  return { kind: "file", sizeBytes: info.size, sha256: hash.digest("hex") };
}

/** Re-hash a captured payload and compare it to the digest recorded at capture. */
export function payloadMatches(path: string, expectedSha256: string, maxBytes: number): boolean {
  try {
    return hashPath(path, { maxBytes }).sha256 === expectedSha256;
  } catch {
    return false;
  }
}
