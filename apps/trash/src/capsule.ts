import { createHash, type Hash } from "node:crypto";
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync, writeSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { ApiError, canonicalJson, digestSchema, MAX_CAPSULE_BYTES, MAX_MANIFEST_BYTES, MAX_PAYLOAD_BYTES, requestDigest } from "./api/domain.js";
import { inspectAncestors } from "./lib/inspect.js";
import { isErrno } from "./lib/fsx.js";

const MAGIC = "HTRASH1\n";
const CHUNK = 64 * 1024;
const MAX_ENTRIES = 100_000;
const MAX_DEPTH = 64;
const pathSchema = z.string().min(1).max(4096).refine((path) => path === "." || (
  !path.includes("\0") && !isAbsolute(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..") && path.split("/").length <= MAX_DEPTH
));
const modeSchema = z.number().int().min(0).max(0o777); // Never recreate privileged set-id or sticky permissions.
const manifestSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.discriminatedUnion("kind", [
    z.object({ path: pathSchema, kind: z.literal("dir"), mode: modeSchema }).strict(),
    z.object({ path: pathSchema, kind: z.literal("file"), mode: modeSchema, size: z.number().int().min(0).max(MAX_PAYLOAD_BYTES), sha256: digestSchema }).strict(),
    z.object({ path: pathSchema, kind: z.literal("symlink"), mode: modeSchema, target: z.string().min(1).max(4096).refine((value) => !value.includes("\0")) }).strict(),
  ])).min(1).max(MAX_ENTRIES),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
type Member = Manifest["entries"][number];
export type CapsuleReceipt = {
  kind: Member["kind"]; sizeBytes: number; sha256: string; mode: number;
  artifact: { format: "hasna.trash.capsule.v1"; sha256: string; sizeBytes: number };
};
export type CapsuleLimits = { maxBytes?: number; maxEntries?: number; maxDepth?: number };

function invalid(message: string): never { throw new ApiError(422, "invalid_capsule", message); }
function safeAncestors(path: string) {
  if (inspectAncestors(path).length) throw new ApiError(409, "unsafe_path", "A path ancestor is missing, inaccessible, or a symlink.");
}
function stable(before: Stats, after: Stats) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mode === after.mode && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
function utf8(input: Uint8Array) {
  // Bun 1.3 returns Uint8Array for readdir's buffer encoding; Node returns Buffer.
  const bytes = Buffer.from(input);
  const value = bytes.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(bytes)) invalid("Paths and symlink targets must be valid UTF-8.");
  return value;
}
function consume(fd: number, position: number, size: number, each: (bytes: Buffer) => void) {
  const buffer = Buffer.allocUnsafe(CHUNK);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), position + offset);
    if (!count) invalid("The capsule or source was truncated.");
    each(buffer.subarray(0, count)); offset += count;
  }
}
function writeAll(fd: number, data: Buffer) {
  let offset = 0;
  while (offset < data.length) {
    const count = writeSync(fd, data, offset, data.length - offset);
    if (!count) throw new Error("Writing the capsule made no progress.");
    offset += count;
  }
}
function sourceFile(path: string, expected: Stats, each?: (bytes: Buffer) => void) {
  safeAncestors(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || !stable(expected, before)) invalid("The source changed during capture.");
    const hash = createHash("sha256");
    consume(fd, 0, before.size, (bytes) => { hash.update(bytes); each?.(bytes); });
    if (!stable(before, fstatSync(fd)) || !stable(before, lstatSync(path))) invalid("The source changed during capture.");
    return hash.digest("hex");
  } finally { closeSync(fd); }
}

function snapshot(source: string, limits: CapsuleLimits = {}) {
  const maxBytes = Math.min(limits.maxBytes ?? MAX_PAYLOAD_BYTES, MAX_PAYLOAD_BYTES);
  const maxEntries = Math.min(limits.maxEntries ?? MAX_ENTRIES, MAX_ENTRIES);
  const maxDepth = Math.min(limits.maxDepth ?? MAX_DEPTH, MAX_DEPTH);
  if (![maxBytes, maxEntries, maxDepth].every((n) => Number.isSafeInteger(n) && n >= 0)) invalid("Invalid capture limits.");
  const entries: Member[] = []; const files = new Map<string, Stats>();
  let sizeBytes = 0; let manifestBytes = 0;
  function visit(path: string, name: string, depth: number) {
    if (depth > maxDepth || entries.length >= maxEntries) invalid("The source exceeds the entry or depth limit.");
    safeAncestors(path);
    const info = lstatSync(path); const mode = info.mode & 0o7777;
    if (mode > 0o777) invalid("Privileged permission bits cannot be archived.");
    let member: Member;
    if (info.isDirectory()) member = { path: name, kind: "dir", mode };
    else if (info.isSymbolicLink()) {
      const target = utf8(readlinkSync(path, { encoding: "buffer" }));
      if (!stable(info, lstatSync(path))) invalid("The source changed during capture.");
      member = { path: name, kind: "symlink", mode, target }; sizeBytes += Buffer.byteLength(target);
    } else if (info.isFile()) {
      sizeBytes += info.size;
      if (sizeBytes > maxBytes) invalid("The source exceeds the capture byte limit.");
      member = { path: name, kind: "file", mode, size: info.size, sha256: sourceFile(path, info) };
      files.set(name, info);
    } else invalid("Sockets, devices and named pipes cannot be archived.");
    if (sizeBytes > maxBytes) invalid("The source exceeds the capture byte limit.");
    manifestBytes += Buffer.byteLength(JSON.stringify(member)) + 1;
    if (manifestBytes + 32 > MAX_MANIFEST_BYTES) invalid("The source manifest exceeds its byte limit.");
    entries.push(member);
    if (member.kind === "dir") {
      const names = readdirSync(path, { encoding: "buffer" }).map(utf8).sort();
      for (const child of names) visit(join(path, child), name === "." ? child : `${name}/${child}`, depth + 1);
      if (!stable(info, lstatSync(path))) invalid("The directory changed during capture.");
    }
  }
  visit(source, ".", 0);
  const manifest = manifestSchema.parse({ version: 1, entries });
  return { manifest, files, sizeBytes };
}

/** Filesystem identity used to compare a captured snapshot before removing a source. */
export function snapshotIdentity(source: string, limits: CapsuleLimits = {}) {
  const { manifest, sizeBytes } = snapshot(resolve(source), limits);
  const root = manifest.entries[0]!;
  return { kind: root.kind, sizeBytes, sha256: requestDigest(manifest), mode: root.mode };
}

/** Creates a new, owner-only capsule. This function never removes the source. */
export function createCapsule(sourcePath: string, capsulePath: string, limits: CapsuleLimits = {}): CapsuleReceipt {
  const source = resolve(sourcePath); const target = resolve(capsulePath);
  const rel = relative(source, target);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) invalid("The capsule must be outside its source.");
  safeAncestors(source); safeAncestors(target);
  const { manifest, files, sizeBytes } = snapshot(source, limits);
  const encoded = Buffer.from(canonicalJson(manifest));
  if (encoded.length > MAX_MANIFEST_BYTES) invalid("The source manifest exceeds its byte limit.");
  const header = Buffer.alloc(12); header.write(MAGIC); header.writeUInt32BE(encoded.length, 8);
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const hash = createHash("sha256"); let bytes = 0;
  function append(data: Buffer) { writeAll(fd, data); hash.update(data); bytes += data.length; }
  try {
    append(header); append(encoded);
    for (const member of manifest.entries) {
      if (member.kind !== "file") continue;
      const digest = sourceFile(member.path === "." ? source : join(source, member.path), files.get(member.path)!, append);
      if (digest !== member.sha256) invalid("The source changed while writing its capsule.");
    }
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const root = manifest.entries[0]!;
  return { kind: root.kind, sizeBytes, sha256: requestDigest(manifest), mode: root.mode,
    artifact: { format: "hasna.trash.capsule.v1", sha256: hash.digest("hex"), sizeBytes: bytes } };
}

function readExactly(fd: number, position: number, count: number) {
  const result = Buffer.alloc(count); let offset = 0;
  consume(fd, position, count, (data) => { data.copy(result, offset); offset += data.length; });
  return result;
}

function validateManifest(encoded: Buffer, totalBytes: number) {
  let manifest: Manifest;
  try { manifest = manifestSchema.parse(JSON.parse(utf8(encoded))); } catch { invalid("Invalid capsule manifest."); }
  const seen = new Map<string, Member>(); let sizeBytes = 0; let bodyBytes = 0;
  for (const member of manifest.entries) {
    if (seen.has(member.path)) invalid("Duplicate capsule paths are forbidden.");
    if (!seen.size) { if (member.path !== ".") invalid("A capsule must start with its root."); }
    else {
      const parent = dirname(member.path);
      if (seen.get(parent)?.kind !== "dir") invalid("Every capsule parent must be an earlier directory.");
    }
    seen.set(member.path, member);
    if (member.kind === "file") { bodyBytes += member.size; sizeBytes += member.size; }
    if (member.kind === "symlink") sizeBytes += Buffer.byteLength(member.target);
    if (sizeBytes > MAX_PAYLOAD_BYTES) invalid("The capsule exceeds its payload limit.");
  }
  if (bodyBytes + encoded.length + 12 !== totalBytes) invalid("The capsule is truncated or contains trailing data.");
  return { manifest, sizeBytes };
}

function manifestLength(header: Buffer, totalBytes: number) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 12 || totalBytes > MAX_CAPSULE_BYTES) invalid("Invalid capsule size.");
  if (header.subarray(0, 8).toString() !== MAGIC) invalid("Unsupported capsule format.");
  const length = header.readUInt32BE(8);
  if (length < 1 || length > MAX_MANIFEST_BYTES || length + 12 > totalBytes) invalid("Invalid capsule manifest length.");
  return length;
}

function readManifest(fd: number) {
  const info = fstatSync(fd);
  if (!info.isFile()) invalid("A capsule must be a regular file.");
  const header = readExactly(fd, 0, 12); const length = manifestLength(header, info.size);
  const encoded = readExactly(fd, 12, length);
  return { ...validateManifest(encoded, info.size), info, offset: length + 12, prefix: Buffer.concat([header, encoded]) };
}

function verifyMembers(fd: number, data: ReturnType<typeof readManifest>, artifact: Hash) {
  let offset = data.offset;
  for (const member of data.manifest.entries) {
    if (member.kind !== "file") continue;
    const hash = createHash("sha256");
    consume(fd, offset, member.size, (bytes) => { hash.update(bytes); artifact.update(bytes); });
    if (hash.digest("hex") !== member.sha256) invalid("A capsule file failed its checksum.");
    offset += member.size;
  }
  if (!stable(data.info, fstatSync(fd))) invalid("The capsule changed during verification.");
}

function inspectFd(fd: number) {
  const data = readManifest(fd); const hash = createHash("sha256").update(data.prefix);
  verifyMembers(fd, data, hash);
  const root = data.manifest.entries[0]!;
  const receipt: CapsuleReceipt = { kind: root.kind, sizeBytes: data.sizeBytes, sha256: requestDigest(data.manifest), mode: root.mode,
    artifact: { format: "hasna.trash.capsule.v1", sha256: hash.digest("hex"), sizeBytes: data.info.size } };
  return { ...data, receipt };
}

export function inspectCapsule(path: string): CapsuleReceipt {
  const absolute = resolve(path); safeAncestors(absolute);
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return inspectFd(fd).receipt; } finally { closeSync(fd); }
}

/** Verify a caller-owned descriptor without reopening a pathname. The caller closes it. */
export function inspectOpenCapsule(fd: number): CapsuleReceipt { return inspectFd(fd).receipt; }

/**
 * Release only members proven to exist in the verified capsule. New or changed
 * staging contents are preserved. Missing members permit replay after interruption.
 * The caller must first verify the remote object and supply its private staging path.
 */
export function discardStagedPayload(capsule: string, stagedPath: string, expected: CapsuleReceipt) {
  const absolute = resolve(capsule); const target = resolve(stagedPath);
  safeAncestors(absolute); safeAncestors(target);
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const data = inspectFd(fd);
    if (canonicalJson(data.receipt) !== canonicalJson(expected)) invalid("The cleanup capsule does not match its receipt.");
    function present(member: Member) {
      const path = member.path === "." ? target : join(target, member.path);
      let info: Stats;
      try { info = lstatSync(path); }
      catch (error) { if (isErrno(error, "ENOENT")) return null; throw error; }
      safeAncestors(path);
      if ((info.mode & 0o777) !== member.mode) invalid("Staging permissions changed; preserve the remaining contents.");
      if (member.kind === "file") {
        if (!info.isFile() || info.size !== member.size || sourceFile(path, info) !== member.sha256) invalid("Staged bytes changed; preserve the remaining contents.");
      } else if (member.kind === "symlink") {
        if (!info.isSymbolicLink() || utf8(readlinkSync(path, { encoding: "buffer" })) !== member.target) invalid("A staged symlink changed.");
      } else if (!info.isDirectory()) invalid("A staged directory changed.");
      return path;
    }
    for (const member of data.manifest.entries) present(member);
    for (const member of [...data.manifest.entries].reverse()) {
      const path = present(member); if (!path) continue;
      if (member.kind === "dir") rmdirSync(path); else unlinkSync(path);
    }
    const parent = openSync(dirname(target), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally { closeSync(fd); }
}

/** Verify an object stream with memory bounded by its manifest and one stream chunk. */
export async function inspectCapsuleStream(stream: ReadableStream<Uint8Array>, totalBytes: number): Promise<CapsuleReceipt> {
  const reader = stream.getReader(); let pending = new Uint8Array(0); let position = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 120_000);
  async function take(count: number, consumeBytes: (bytes: Uint8Array) => void) {
    while (count > 0) {
      if (timedOut) invalid("Capsule verification timed out.");
      if (position === pending.length) {
        const next = await reader.read();
        if (next.done) invalid("The capsule stream was truncated.");
        pending = next.value; position = 0;
        if (!pending.length) continue;
      }
      const size = Math.min(count, pending.length - position);
      consumeBytes(pending.subarray(position, position + size)); position += size; count -= size;
    }
  }
  async function bytes(count: number) {
    const buffer = Buffer.alloc(count); let offset = 0;
    await take(count, (chunk) => { buffer.set(chunk, offset); offset += chunk.length; }); return buffer;
  }
  try {
    const header = await bytes(12); const length = manifestLength(header, totalBytes);
    const encoded = await bytes(length); const { manifest, sizeBytes } = validateManifest(encoded, totalBytes);
    const artifact = createHash("sha256").update(header).update(encoded);
    for (const member of manifest.entries) {
      if (member.kind !== "file") continue;
      const hash = createHash("sha256");
      await take(member.size, (chunk) => { hash.update(chunk); artifact.update(chunk); });
      if (hash.digest("hex") !== member.sha256) invalid("A capsule file failed its checksum.");
    }
    if (position !== pending.length) invalid("The capsule contains trailing data.");
    for (;;) {
      const next = await reader.read();
      if (timedOut) invalid("Capsule verification timed out.");
      if (next.done) break;
      if (next.value.length) invalid("The capsule contains trailing data.");
    }
    const root = manifest.entries[0]!;
    return { kind: root.kind, sizeBytes, sha256: requestDigest(manifest), mode: root.mode,
      artifact: { format: "hasna.trash.capsule.v1", sha256: artifact.digest("hex"), sizeBytes: totalBytes } };
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
}

/**
 * Validates the entire capsule before exclusive creation of the destination.
 * A later I/O error leaves a partial destination and preserves the capsule;
 * callers must report that partial path, never silently delete or overwrite it.
 */
export function restoreCapsule(path: string, destination: string, expected: CapsuleReceipt): void {
  const target = resolve(destination); const absolute = resolve(path);
  safeAncestors(absolute); safeAncestors(target);
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const data = inspectFd(fd);
    if (canonicalJson(data.receipt) !== canonicalJson(expected)) invalid("The capsule does not match its recovery receipt.");
    let offset = data.offset; const artifact = createHash("sha256").update(data.prefix);
    const directories: Array<{ path: string; mode: number }> = [];
    for (const member of data.manifest.entries) {
      const output = member.path === "." ? target : join(target, member.path);
      safeAncestors(output);
      if (member.kind === "dir") {
        mkdirSync(output, { mode: 0o700 }); directories.push({ path: output, mode: member.mode });
      } else if (member.kind === "symlink") symlinkSync(member.target, output);
      else {
        const out = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
          const hash = createHash("sha256");
          consume(fd, offset, member.size, (bytes) => { hash.update(bytes); artifact.update(bytes); writeAll(out, bytes); });
          if (hash.digest("hex") !== member.sha256) invalid("The capsule changed during restoration.");
          fchmodSync(out, member.mode); fsyncSync(out);
        } finally { closeSync(out); }
        offset += member.size;
      }
    }
    if (artifact.digest("hex") !== expected.artifact.sha256 || !stable(data.info, fstatSync(fd))) invalid("The capsule changed during restoration.");
    for (const directory of directories.reverse()) {
      safeAncestors(directory.path);
      const dir = openSync(directory.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
      try { fchmodSync(dir, directory.mode); fsyncSync(dir); } finally { closeSync(dir); }
    }
    const parent = openSync(dirname(target), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally { closeSync(fd); }
}
