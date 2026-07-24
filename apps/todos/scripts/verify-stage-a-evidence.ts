#!/usr/bin/env bun
/** Independently verify a Stage A evidence root without repository access or network. */
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, posix, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  runPinnedCommand,
  type ExecutableIdentity,
  type PinnedCommandResult,
} from "./stage-a-process.js";
import {
  ARTIFACT_REPLAY_POLICY,
  NETWORK_PROBE_POLICY,
  SOURCE_REPLAY_POLICY,
  assertArchiveExtractionClosed,
  assertCommandRecordMatchesPolicy,
  type CanonicalCommandPolicy,
} from "./stage-a-verifier-policy.js";
import {
  STAGE_A_CANDIDATE_IDENTITY_VERSION,
  canonicalSortedPathBytes,
  canonicalUntrackedRecords,
  decodeCanonicalCandidateInput,
  type CanonicalUntrackedIdentity,
} from "./stage-a-candidate-identity.js";

const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_STRUCTURED_JSON_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_COMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 200_000;
const MAX_INVENTORY_ENTRIES = 200_000;
const MAX_EXECUTIONS = 128;
const MAX_IDENTITY_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TREE_REGULAR_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TREE_DEPTH = 256;
const MAX_TAR_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_PERCENT_DECODE_PASSES = 32;
const TAR_BLOCK = 512;

/** Executable selection is verifier policy, never evidence-manifest data. */
const TRUSTED_VERIFIER_EXECUTION_POLICY = Object.freeze({
  hostBash: "/usr/bin/bash",
  hostBwrap: "/usr/bin/bwrap",
  hostGit: "/usr/bin/git",
  hostSh: "/bin/sh",
  hostRm: "/bin/rm",
  minimalRootfs: "tools/sandbox-root",
  bundledBun: "tools/sandbox-root/opt/bin/bun",
  bundledGit: "tools/sandbox-root/opt/bin/git",
  bundledSh: "tools/sandbox-root/bin/sh",
  bundledRm: "tools/sandbox-root/bin/rm",
  bundledGitleaks: "tools/host/gitleaks",
  gitleaksMode: "0755",
  gitleaksSize: 20_775_096,
  gitleaksSha256: "00e91bbe655bd7c47753e8cfe61cb76ea1a5d7e7702fe161ee40102b46b3823b",
});

interface InventoryEntry {
  path: string;
  type: "directory" | "file" | "symlink";
  mode: string;
  size: number;
  sha256: string;
  target?: string;
}

interface FileIdentity {
  path: string;
  mode: string;
  size: number;
  sha256: string;
}

interface TarEntry extends InventoryEntry {
  bytes?: Uint8Array;
}

interface CommandRecord {
  index: number;
  label: string;
  argv: string[];
  launch_argv: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: "ignore";
  deadline_ms: number;
  output_limit_bytes: number;
  termination: "exit";
  timed_out: false;
  output_limited: false;
  expected_exit: number;
  exit_code: number;
  stdout: FileIdentity;
  stderr: FileIdentity;
  authority_floor_occurrences: number;
  expected_authority_floor_occurrences: number;
  tripwire_absent: boolean;
  network_isolated: boolean;
  toolchain_inventory_sha256: string;
  tools: FileIdentity[];
  preloads: FileIdentity[];
  inputs: FileIdentity[];
  replayable: boolean;
  replay_omission?: string;
  output_comparison: {
    mode: "exact-bytes" | "normalized-text-v1";
    rules: Array<"duration-tokens" | "namespace-inode">;
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const rootArgument = argument("--evidence") ?? process.argv[2];
if (!rootArgument || !isAbsolute(rootArgument)) throw new Error("--evidence must be an absolute evidence root");
const root = resolve(rootArgument);
const rootDescriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
invariant(fstatSync(rootDescriptor).isDirectory(), "evidence root is not a descriptor-anchored directory");

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha1Object(type: "blob" | "commit" | "tree", bytes: Uint8Array): string {
  return createHash("sha1").update(`${type} ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

function byteSort(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function modeString(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function safeRelativePath(path: unknown): string {
  invariant(typeof path === "string" && path.length > 0 && path.length <= 4096, "invalid evidence-relative path");
  invariant(!path.includes("\0") && !path.includes("\\") && !isAbsolute(path), `unsafe evidence path: ${JSON.stringify(path)}`);
  const normalized = posix.normalize(path);
  invariant(normalized === path && normalized !== "." && normalized !== ".." && !normalized.startsWith("../"), `non-canonical evidence path: ${path}`);
  return path;
}

function evidencePath(path: unknown): string {
  return `/proc/${process.pid}/fd/${rootDescriptor}/${safeRelativePath(path)}`;
}

function openEvidenceRegular(path: unknown): number {
  const parts = safeRelativePath(path).split("/");
  let directoryDescriptor = rootDescriptor;
  try {
    for (const part of parts.slice(0, -1)) {
      const next = openSync(
        `/proc/self/fd/${directoryDescriptor}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      if (directoryDescriptor !== rootDescriptor) closeSync(directoryDescriptor);
      directoryDescriptor = next;
    }
    return openSync(
      `/proc/self/fd/${directoryDescriptor}/${parts.at(-1)!}`,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } finally {
    if (directoryDescriptor !== rootDescriptor) closeSync(directoryDescriptor);
  }
}

function openEvidenceDirectory(path: unknown): number {
  const parts = safeRelativePath(path).split("/");
  let directoryDescriptor = rootDescriptor;
  for (const part of parts) {
    const next = openSync(
      `/proc/self/fd/${directoryDescriptor}/${part}`,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    if (directoryDescriptor !== rootDescriptor) closeSync(directoryDescriptor);
    directoryDescriptor = next;
  }
  return directoryDescriptor;
}

function withEvidenceDirectory<T>(path: unknown, operation: (descriptorPath: string, descriptor: number) => T): T {
  const descriptor = openEvidenceDirectory(path);
  try {
    return operation(`/proc/${process.pid}/fd/${descriptor}`, descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readEvidenceFile(path: unknown, maxBytes = MAX_IDENTITY_FILE_BYTES): Buffer {
  const descriptor = openEvidenceRegular(path);
  try {
    const before = fstatSync(descriptor);
    invariant(before.isFile() && before.size <= maxBytes, `evidence file exceeds its pre-read bound: ${String(path)}`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    invariant(
      before.dev === after.dev && before.ino === after.ino && before.size === after.size && bytes.byteLength === after.size,
      `evidence file changed while read: ${String(path)}`,
    );
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function readBoundedRegular(path: string, maxBytes: number): Buffer {
  const descriptorRootPrefix = `/proc/${process.pid}/fd/${rootDescriptor}/`;
  if (path.startsWith(descriptorRootPrefix)) {
    return readEvidenceFile(path.slice(descriptorRootPrefix.length), maxBytes);
  }
  const fromRoot = relative(root, path).split(sep).join("/");
  if (fromRoot !== "" && !fromRoot.startsWith("../") && !isAbsolute(fromRoot)) {
    return readEvidenceFile(fromRoot, maxBytes);
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    invariant(before.isFile() && before.size <= maxBytes, `file exceeds its pre-read bound: ${path}`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    invariant(before.dev === after.dev && before.ino === after.ino && before.size === after.size, `file changed while read: ${path}`);
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function sha256File(path: string): string {
  return sha256Bytes(readBoundedRegular(path, MAX_IDENTITY_FILE_BYTES));
}

function openExternalFileMatchingIdentity(source: string, identity: FileIdentity, label: string): number {
  invariant(isAbsolute(source) && !source.includes("\0"), `${label} path is invalid`);
  const resolvedSource = realpathSync(source);
  const descriptor = openSync(resolvedSource, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    invariant(before.isFile() && before.size <= MAX_IDENTITY_FILE_BYTES, `${label} is not a bounded regular file`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    invariant(
      before.dev === after.dev && before.ino === after.ino && before.size === after.size && bytes.byteLength === after.size,
      `${label} changed while bound`,
    );
    invariant(
      before.size === identity.size && modeString(before.mode) === identity.mode && sha256Bytes(bytes) === identity.sha256,
      `${label} no longer matches its bundled identity`,
    );
    invariant(realpathSync(source) === resolvedSource, `${label} path resolution changed while bound`);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function assertExternalFileMatchesIdentity(source: string, identity: FileIdentity, label: string): void {
  const descriptor = openExternalFileMatchingIdentity(source, identity, label);
  closeSync(descriptor);
}

function externalExecutableIdentity(source: string, identity: FileIdentity): ExecutableIdentity {
  return {
    path: realpathSync(source),
    mode: identity.mode,
    size: identity.size,
    sha256: identity.sha256,
  };
}

function validateIdentity(identity: FileIdentity, dependencyInventory?: Map<string, InventoryEntry>): void {
  invariant(identity && typeof identity === "object", "missing file identity");
  invariant(/^0[0-7]{3}$/.test(identity.mode), `invalid mode for ${identity.path}`);
  invariant(Number.isSafeInteger(identity.size) && identity.size >= 0 && identity.size <= MAX_IDENTITY_FILE_BYTES, `invalid or oversized identity for ${identity.path}`);
  invariant(/^[a-f0-9]{64}$/.test(identity.sha256), `invalid SHA-256 for ${identity.path}`);
  const path = safeRelativePath(identity.path);
  try {
    const descriptor = openEvidenceRegular(path);
    try {
      const stat = fstatSync(descriptor);
      invariant(stat.isFile(), `identity is not a regular file: ${path}`);
      invariant(stat.size === identity.size, `size mismatch: ${path}`);
      invariant(modeString(stat.mode) === identity.mode, `mode mismatch: ${path}`);
      const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      invariant(stat.dev === after.dev && stat.ino === after.ino && stat.size === after.size && bytes.byteLength === after.size, `identity changed while read: ${path}`);
      invariant(sha256Bytes(bytes) === identity.sha256, `SHA-256 mismatch: ${path}`);
      return;
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if (!["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    if (!path.startsWith("workspace/node_modules/") && !path.startsWith("workspace/dashboard/node_modules/")) throw error;
  }
  const dependencyPrefix = "workspace/";
  invariant(path.startsWith(dependencyPrefix) && dependencyInventory, `identity target is missing: ${path}`);
  const dependencyPath = path.slice(dependencyPrefix.length);
  const resolvedDependencyPath = resolveDependencyInventoryPath(dependencyPath, dependencyInventory);
  const entry = dependencyInventory.get(resolvedDependencyPath);
  invariant(entry?.type === "file", `dependency identity target is missing: ${dependencyPath}`);
  invariant(entry.mode === identity.mode && entry.size === identity.size && entry.sha256 === identity.sha256, `dependency identity mismatch: ${dependencyPath}`);
}

function resolveDependencyInventoryPath(path: string, inventory: Map<string, InventoryEntry>): string {
  let candidate = safeRelativePath(path);
  const seen = new Set<string>();
  for (let pass = 0; pass < MAX_TREE_DEPTH; pass += 1) {
    invariant(!seen.has(candidate), `dependency identity symlink cycle: ${path}`);
    seen.add(candidate);
    const parts = candidate.split("/");
    let substituted = false;
    for (let index = 1; index <= parts.length; index += 1) {
      const prefix = parts.slice(0, index).join("/");
      const entry = inventory.get(prefix);
      if (entry?.type !== "symlink") continue;
      invariant(typeof entry.target === "string", `dependency identity symlink target is missing: ${prefix}`);
      candidate = posix.normalize(posix.join(posix.dirname(prefix), entry.target, ...parts.slice(index)));
      safeRelativePath(candidate);
      substituted = true;
      break;
    }
    if (!substituted) return candidate;
  }
  throw new Error(`dependency identity symlink resolution depth exceeded: ${path}`);
}

function openEvidenceFileMatchingIdentity(identity: FileIdentity, label: string): number {
  const descriptor = openEvidenceRegular(identity.path);
  try {
    const before = fstatSync(descriptor);
    invariant(before.isFile() && before.size <= MAX_IDENTITY_FILE_BYTES, `${label} is not a bounded regular file`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && bytes.byteLength === after.size
        && modeString(before.mode) === identity.mode
        && before.size === identity.size
        && sha256Bytes(bytes) === identity.sha256,
      `${label} changed before descriptor binding`,
    );
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function validateStructuredIdentity(identity: FileIdentity): void {
  invariant(identity && typeof identity === "object", "missing structured input identity");
  invariant(Number.isSafeInteger(identity.size) && identity.size >= 0, `invalid structured input size: ${String(identity.path)}`);
  invariant(identity.size <= MAX_STRUCTURED_JSON_BYTES, `structured input exceeds ${MAX_STRUCTURED_JSON_BYTES} bytes: ${identity.path}`);
  validateIdentity(identity);
}

function parseJsonFile<T>(identity: FileIdentity): T {
  validateStructuredIdentity(identity);
  return JSON.parse(readEvidenceFile(identity.path, MAX_STRUCTURED_JSON_BYTES).toString("utf8")) as T;
}

function fieldText(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true }).decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function tarNumber(bytes: Uint8Array, label: string): number {
  if ((bytes[0]! & 0x80) !== 0) {
    invariant((bytes[0]! & 0x40) === 0, `${label} is negative`);
    let value = BigInt(bytes[0]! & 0x3f);
    for (const byte of bytes.subarray(1)) value = (value << 8n) | BigInt(byte);
    invariant(value <= BigInt(Number.MAX_SAFE_INTEGER), `${label} exceeds safe integers`);
    return Number(value);
  }
  const raw = fieldText(bytes).trim();
  if (!raw) return 0;
  invariant(/^[0-7]+$/.test(raw), `${label} is not octal`);
  const value = Number.parseInt(raw, 8);
  invariant(Number.isSafeInteger(value), `${label} exceeds safe integers`);
  return value;
}

function validateHeaderChecksum(header: Uint8Array): void {
  const expected = tarNumber(header.subarray(148, 156), "tar checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]!;
  }
  invariant(actual === expected, `tar checksum mismatch: expected ${expected}, received ${actual}`);
}

function parsePax(bytes: Uint8Array): Map<string, string> {
  const values = new Map<string, string>();
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    invariant(space > offset, "malformed PAX record length");
    const lengthText = new TextDecoder().decode(bytes.subarray(offset, space));
    invariant(/^[1-9][0-9]*$/.test(lengthText), "malformed PAX record length");
    const length = Number.parseInt(lengthText, 10);
    invariant(Number.isSafeInteger(length) && offset + length <= bytes.length, "PAX record is truncated");
    const record = bytes.subarray(space + 1, offset + length);
    invariant(record.at(-1) === 0x0a, "PAX record is not newline terminated");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(record.subarray(0, -1));
    const equals = text.indexOf("=");
    invariant(equals > 0, "malformed PAX record");
    values.set(text.slice(0, equals), text.slice(equals + 1));
    offset += length;
  }
  return values;
}

function mergePax(target: Map<string, string>, source: Map<string, string>): void {
  for (const [key, value] of source) target.set(key, value);
}

function canonicalTarPath(raw: string, directory: boolean): string {
  let path = directory ? raw.replace(/\/+$/, "") : raw;
  if (path.startsWith("./")) path = path.slice(2);
  invariant(path.length > 0 && !path.includes("\0") && !path.includes("\\") && !path.startsWith("/") && !/^[A-Za-z]:/.test(path), `unsafe tar path: ${JSON.stringify(raw)}`);
  const normalized = posix.normalize(path);
  invariant(normalized === path && normalized !== "." && normalized !== ".." && !normalized.startsWith("../"), `non-canonical tar path: ${raw}`);
  return path;
}

function readTar(path: string, allowSymlinks: boolean): TarEntry[] {
  const packed = readBoundedRegular(path, MAX_ARCHIVE_COMPRESSED_BYTES);
  const archive: Uint8Array = packed[0] === 0x1f && packed[1] === 0x8b
    ? gunzipSync(packed, { maxOutputLength: MAX_ARCHIVE_EXPANDED_BYTES })
    : packed;
  invariant(archive.byteLength <= MAX_ARCHIVE_EXPANDED_BYTES && archive.byteLength % TAR_BLOCK === 0, "invalid expanded tar size");
  const entries: TarEntry[] = [];
  const paths = new Set<string>();
  const globalPax = new Map<string, string>();
  let nextPax = new Map<string, string>();
  let nextLongPath: string | undefined;
  let nextLongLink: string | undefined;
  let offset = 0;
  let zeroBlocks = 0;
  let count = 0;
  while (offset < archive.byteLength) {
    const header = archive.subarray(offset, offset + TAR_BLOCK);
    offset += TAR_BLOCK;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    invariant(zeroBlocks === 0, "non-zero tar header follows end marker");
    validateHeaderChecksum(header);
    count += 1;
    invariant(count <= MAX_ARCHIVE_ENTRIES, "tar entry bound exceeded");
    const type = String.fromCharCode(header[156] ?? 0);
    const headerSize = tarNumber(header.subarray(124, 136), "tar size");
    const pax = new Map(globalPax);
    mergePax(pax, nextPax);
    nextPax = new Map();
    const effectiveSize = type === "x" || type === "g" || type === "L" || type === "K"
      ? headerSize
      : pax.has("size") ? Number(pax.get("size")) : headerSize;
    invariant(Number.isSafeInteger(effectiveSize) && effectiveSize >= 0, "invalid tar entry size");
    invariant(effectiveSize <= MAX_TAR_ENTRY_BYTES, `tar entry exceeds ${MAX_TAR_ENTRY_BYTES} bytes before allocation`);
    const paddedSize = Math.ceil(effectiveSize / TAR_BLOCK) * TAR_BLOCK;
    invariant(offset + paddedSize <= archive.byteLength, "truncated tar entry payload");
    const payload = archive.subarray(offset, offset + effectiveSize);
    offset += paddedSize;
    if (type === "x" || type === "g") {
      const values = parsePax(payload);
      if (type === "g") mergePax(globalPax, values);
      else nextPax = values;
      continue;
    }
    if (type === "L" || type === "K") {
      const value = fieldText(payload).replace(/\n$/, "");
      if (type === "L") nextLongPath = value;
      else nextLongLink = value;
      continue;
    }
    const rawName = pax.get("path") ?? nextLongPath ?? (() => {
      const name = fieldText(header.subarray(0, 100));
      const prefix = fieldText(header.subarray(345, 500));
      return prefix ? `${prefix}/${name}` : name;
    })();
    nextLongPath = undefined;
    const directory = type === "5";
    const entryPath = canonicalTarPath(rawName, directory);
    invariant(!paths.has(entryPath), `duplicate tar path: ${entryPath}`);
    paths.add(entryPath);
    const mode = modeString(tarNumber(header.subarray(100, 108), "tar mode"));
    if (directory) {
      invariant(effectiveSize === 0, `directory has payload: ${entryPath}`);
      entries.push({ path: entryPath, type: "directory", mode, size: 0, sha256: sha256Bytes("") });
      continue;
    }
    if (type === "2") {
      invariant(allowSymlinks && effectiveSize === 0, `symlink forbidden in archive: ${entryPath}`);
      const target = pax.get("linkpath") ?? nextLongLink ?? fieldText(header.subarray(157, 257));
      nextLongLink = undefined;
      invariant(target.length > 0 && !target.includes("\0") && !isAbsolute(target), `unsafe symlink target: ${entryPath}`);
      const resolved = posix.normalize(posix.join(posix.dirname(entryPath), target));
      invariant(resolved !== ".." && !resolved.startsWith("../"), `symlink escapes archive: ${entryPath}`);
      entries.push({ path: entryPath, type: "symlink", mode, size: Buffer.byteLength(target), sha256: sha256Bytes(target), target });
      continue;
    }
    invariant(type === "0" || type === "\0", `special tar entry forbidden: ${JSON.stringify(type)} ${entryPath}`);
    const bytes = payload.slice();
    entries.push({ path: entryPath, type: "file", mode, size: bytes.byteLength, sha256: sha256Bytes(bytes), bytes });
  }
  invariant(zeroBlocks >= 2, "tar archive lacks two-block end marker");
  invariant(nextPax.size === 0 && nextLongPath === undefined && nextLongLink === undefined, "orphaned tar metadata");
  for (; offset < archive.byteLength; offset += 1) invariant(archive[offset] === 0, "non-zero bytes follow tar end marker");
  return entries.sort((left, right) => byteSort(left.path, right.path));
}

function inventoryTree(rootPath: string, exclude: (path: string) => boolean = () => false): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
  let totalRegularBytes = 0;
  const add = (entry: InventoryEntry): void => {
    entries.push(entry);
    invariant(entries.length <= MAX_INVENTORY_ENTRIES, "filesystem inventory entry bound exceeded");
  };
  const visit = (directoryDescriptor: number, prefix: string, depth: number): void => {
    invariant(depth <= MAX_TREE_DEPTH, "filesystem inventory depth bound exceeded");
    const directoryPath = `/proc/self/fd/${directoryDescriptor}`;
    for (const name of readdirSync(directoryPath).sort(byteSort)) {
      invariant(name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0"), "invalid directory entry name");
      const absolute = `${directoryPath}/${name}`;
      const path = prefix ? `${prefix}/${name}` : name;
      if (exclude(path)) continue;
      const before = lstatSync(absolute);
      if (before.isDirectory()) {
        const childDescriptor = openSync(absolute, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
          const stat = fstatSync(childDescriptor);
          invariant(before.dev === stat.dev && before.ino === stat.ino, `directory changed during inventory: ${path}`);
          add({ path, type: "directory", mode: modeString(stat.mode), size: 0, sha256: sha256Bytes("") });
          visit(childDescriptor, path, depth + 1);
        } finally {
          closeSync(childDescriptor);
        }
      } else if (before.isFile()) {
        const descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = fstatSync(descriptor);
          invariant(before.dev === stat.dev && before.ino === stat.ino && stat.isFile(), `file changed during inventory: ${path}`);
          totalRegularBytes += stat.size;
          invariant(stat.size <= MAX_IDENTITY_FILE_BYTES && totalRegularBytes <= MAX_TREE_REGULAR_BYTES, "filesystem inventory byte bound exceeded");
          const bytes = readFileSync(descriptor);
          const after = fstatSync(descriptor);
          invariant(stat.dev === after.dev && stat.ino === after.ino && stat.size === after.size && bytes.byteLength === after.size, `file changed while inventoried: ${path}`);
          add({ path, type: "file", mode: modeString(stat.mode), size: stat.size, sha256: sha256Bytes(bytes) });
        } finally {
          closeSync(descriptor);
        }
      } else if (before.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        const after = lstatSync(absolute);
        invariant(after.isSymbolicLink() && before.dev === after.dev && before.ino === after.ino, `symlink changed during inventory: ${path}`);
        add({ path, type: "symlink", mode: modeString(before.mode), size: Buffer.byteLength(target), sha256: sha256Bytes(target), target });
      } else throw new Error(`unsupported filesystem entry: ${absolute}`);
    }
  };
  const descriptorPrefix = `/proc/${process.pid}/fd/`;
  const descriptorSuffix = rootPath.startsWith(descriptorPrefix) ? rootPath.slice(descriptorPrefix.length) : "";
  const borrowedRootDescriptor = /^[0-9]+$/.test(descriptorSuffix)
    ? Number.parseInt(descriptorSuffix, 10)
    : undefined;
  const rootDirectoryDescriptor = borrowedRootDescriptor ?? openSync(
    rootPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const rootBefore = fstatSync(rootDirectoryDescriptor);
  invariant(rootBefore.isDirectory(), "filesystem inventory root is not a directory");
  try {
    visit(rootDirectoryDescriptor, "", 0);
  } finally {
    const rootAfter = fstatSync(rootDirectoryDescriptor);
    invariant(
      rootBefore.dev === rootAfter.dev && rootBefore.ino === rootAfter.ino && rootAfter.isDirectory(),
      "filesystem inventory root descriptor changed",
    );
    if (borrowedRootDescriptor === undefined) closeSync(rootDirectoryDescriptor);
  }
  return entries.sort((left, right) => byteSort(left.path, right.path));
}

function copyDescriptorAnchoredTree(sourceRootDescriptor: number, destinationRoot: string): void {
  if (!existsSync(destinationRoot)) mkdirSync(destinationRoot, { recursive: false, mode: 0o700 });
  const destinationRootDescriptor = openSync(
    destinationRoot,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const sourceRootBefore = fstatSync(sourceRootDescriptor);
  const destinationRootBefore = fstatSync(destinationRootDescriptor);
  invariant(sourceRootBefore.isDirectory() && destinationRootBefore.isDirectory(), "descriptor copy roots must be directories");
  invariant(readdirSync(`/proc/self/fd/${destinationRootDescriptor}`).length === 0, "descriptor copy destination must be empty");
  let entryCount = 0;
  let regularBytes = 0;
  const copyDirectory = (sourceDescriptor: number, destinationDescriptor: number, depth: number): void => {
    invariant(depth <= MAX_TREE_DEPTH, "descriptor copy depth bound exceeded");
    for (const name of readdirSync(`/proc/self/fd/${sourceDescriptor}`).sort(byteSort)) {
      invariant(name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0"), "invalid descriptor copy entry name");
      entryCount += 1;
      invariant(entryCount <= MAX_INVENTORY_ENTRIES, "descriptor copy entry bound exceeded");
      const sourcePath = `/proc/self/fd/${sourceDescriptor}/${name}`;
      const destinationPath = `/proc/self/fd/${destinationDescriptor}/${name}`;
      const before = lstatSync(sourcePath);
      if (before.isDirectory()) {
        const sourceChild = openSync(sourcePath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        mkdirSync(destinationPath, { recursive: false, mode: before.mode & 0o777 });
        const destinationChild = openSync(destinationPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
          const sourceStat = fstatSync(sourceChild);
          invariant(sourceStat.dev === before.dev && sourceStat.ino === before.ino, "source directory changed during descriptor copy");
          copyDirectory(sourceChild, destinationChild, depth + 1);
          fchmodSync(destinationChild, sourceStat.mode & 0o777);
        } finally {
          closeSync(destinationChild);
          closeSync(sourceChild);
        }
      } else if (before.isFile()) {
        const sourceFile = openSync(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        let destinationFile: number | undefined;
        try {
          const sourceStat = fstatSync(sourceFile);
          invariant(sourceStat.isFile() && sourceStat.dev === before.dev && sourceStat.ino === before.ino, "source file changed during descriptor copy");
          regularBytes += sourceStat.size;
          invariant(sourceStat.size <= MAX_IDENTITY_FILE_BYTES && regularBytes <= MAX_TREE_REGULAR_BYTES, "descriptor copy byte bound exceeded");
          const bytes = readFileSync(sourceFile);
          const sourceAfter = fstatSync(sourceFile);
          invariant(sourceStat.dev === sourceAfter.dev && sourceStat.ino === sourceAfter.ino && sourceStat.size === sourceAfter.size && bytes.byteLength === sourceAfter.size, "source file changed while copied");
          destinationFile = openSync(
            destinationPath,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            sourceStat.mode & 0o777,
          );
          writeFileSync(destinationFile, bytes);
          fchmodSync(destinationFile, sourceStat.mode & 0o777);
          const destinationStat = fstatSync(destinationFile);
          invariant(destinationStat.isFile() && destinationStat.size === sourceStat.size, "descriptor copy destination file changed");
        } finally {
          if (destinationFile !== undefined) closeSync(destinationFile);
          closeSync(sourceFile);
        }
      } else if (before.isSymbolicLink()) {
        const target = readlinkSync(sourcePath);
        const after = lstatSync(sourcePath);
        invariant(after.isSymbolicLink() && before.dev === after.dev && before.ino === after.ino, "source symlink changed during descriptor copy");
        symlinkSync(target, destinationPath);
        invariant(lstatSync(destinationPath).isSymbolicLink(), "descriptor copy destination symlink changed");
      } else {
        throw new Error(`unsupported descriptor copy entry: ${name}`);
      }
    }
  };
  try {
    copyDirectory(sourceRootDescriptor, destinationRootDescriptor, 0);
    const sourceRootAfter = fstatSync(sourceRootDescriptor);
    const destinationRootAfter = fstatSync(destinationRootDescriptor);
    invariant(sourceRootBefore.dev === sourceRootAfter.dev && sourceRootBefore.ino === sourceRootAfter.ino, "descriptor copy source root changed");
    invariant(destinationRootBefore.dev === destinationRootAfter.dev && destinationRootBefore.ino === destinationRootAfter.ino, "descriptor copy destination root changed");
  } finally {
    closeSync(destinationRootDescriptor);
  }
}

function canonicalInventory(entries: InventoryEntry[]): InventoryEntry[] {
  invariant(Array.isArray(entries) && entries.length <= MAX_INVENTORY_ENTRIES, "inventory bound exceeded");
  const paths = new Set<string>();
  for (const entry of entries) {
    safeRelativePath(entry.path);
    invariant(!paths.has(entry.path), `duplicate inventory path: ${entry.path}`);
    paths.add(entry.path);
    invariant(["directory", "file", "symlink"].includes(entry.type), `invalid inventory type: ${entry.path}`);
    invariant(/^0[0-7]{3}$/.test(entry.mode), `invalid inventory mode: ${entry.path}`);
    invariant(Number.isSafeInteger(entry.size) && entry.size >= 0, `invalid inventory size: ${entry.path}`);
    invariant(/^[a-f0-9]{64}$/.test(entry.sha256), `invalid inventory hash: ${entry.path}`);
  }
  return [...entries].sort((left, right) => byteSort(left.path, right.path));
}

function equalInventory(left: InventoryEntry[], right: InventoryEntry[], label: string): void {
  invariant(JSON.stringify(canonicalInventory(left)) === JSON.stringify(canonicalInventory(right)), `${label} inventory mismatch`);
}

function assertDependencySymlinkClosure(inventory: readonly InventoryEntry[]): void {
  const entries = new Map(inventory.map((entry) => [entry.path, entry]));
  for (const entry of inventory) {
    if (entry.type !== "symlink") continue;
    invariant(
      typeof entry.target === "string"
        && !isAbsolute(entry.target)
        && !entry.target.includes("\0")
        && !entry.target.includes("\\"),
      `dependency symlink has an unsafe target: ${entry.path}`,
    );
    let candidate = posix.normalize(posix.join(posix.dirname(entry.path), entry.target));
    const seen = new Set<string>();
    let closed = false;
    for (let pass = 0; pass < MAX_TREE_DEPTH; pass += 1) {
      invariant(candidate !== "" && candidate !== "." && candidate !== ".." && !candidate.startsWith("../") && !isAbsolute(candidate), `dependency symlink escapes the closed inventory: ${entry.path}`);
      invariant(!seen.has(candidate), `dependency symlink cycle: ${entry.path}`);
      seen.add(candidate);
      const parts = candidate.split("/");
      let substituted = false;
      for (let index = 1; index <= parts.length; index += 1) {
        const prefix = parts.slice(0, index).join("/");
        const prefixEntry = entries.get(prefix);
        if (prefixEntry?.type !== "symlink") continue;
        candidate = posix.normalize(posix.join(posix.dirname(prefix), prefixEntry.target!, ...parts.slice(index)));
        substituted = true;
        break;
      }
      if (substituted) continue;
      invariant(entries.has(candidate), `dependency symlink target is absent from the closed inventory: ${entry.path}`);
      closed = true;
      break;
    }
    invariant(closed, `dependency symlink resolution depth exceeded: ${entry.path}`);
  }
}

function extractTar(entries: TarEntry[], destination: string): void {
  mkdirSync(destination, { recursive: true });
  const oldUmask = process.umask(0o002);
  try {
    for (const entry of entries) {
      const target = join(destination, entry.path);
      if (entry.type === "directory") mkdirSync(target, { recursive: true });
      else {
        mkdirSync(dirname(target), { recursive: true });
        if (entry.type === "file") writeFileSync(target, entry.bytes!);
        else symlinkSync(entry.target!, target);
      }
    }
    for (const entry of [...entries].sort((left, right) => right.path.split("/").length - left.path.split("/").length)) {
      if (entry.type !== "symlink") chmodSync(join(destination, entry.path), Number.parseInt(entry.mode, 8));
    }
  } finally {
    process.umask(oldUmask);
  }
}

interface TreeNode {
  directories: Map<string, TreeNode>;
  files: Map<string, { mode: string; bytes: Uint8Array }>;
}

function gitTreeHash(entries: TarEntry[]): string {
  const rootNode: TreeNode = { directories: new Map(), files: new Map() };
  for (const entry of entries) {
    if (entry.type === "directory") continue;
    const parts = entry.path.split("/");
    const name = parts.pop()!;
    let node = rootNode;
    for (const part of parts) {
      invariant(!node.files.has(part), `Git tree path traverses a file: ${entry.path}`);
      let child = node.directories.get(part);
      if (!child) {
        child = { directories: new Map(), files: new Map() };
        node.directories.set(part, child);
      }
      node = child;
    }
    invariant(!node.files.has(name) && !node.directories.has(name), `duplicate Git tree name: ${entry.path}`);
    const bytes = entry.type === "file" ? entry.bytes! : new TextEncoder().encode(entry.target!);
    const executable = (Number.parseInt(entry.mode, 8) & 0o111) !== 0;
    node.files.set(name, { mode: entry.type === "symlink" ? "120000" : executable ? "100755" : "100644", bytes });
  }
  const hashNode = (node: TreeNode): string => {
    const records: Uint8Array[] = [];
    const names = [...node.directories.keys(), ...node.files.keys()].sort((left, right) => byteSort(
      `${left}${node.directories.has(left) ? "/" : "\0"}`,
      `${right}${node.directories.has(right) ? "/" : "\0"}`,
    ));
    for (const name of names) {
      const directory = node.directories.get(name);
      const file = node.files.get(name);
      const mode = directory ? "40000" : file!.mode;
      const objectHash = directory ? hashNode(directory) : sha1Object("blob", file!.bytes);
      const prefix = new TextEncoder().encode(`${mode} ${name}\0`);
      const record = new Uint8Array(prefix.byteLength + 20);
      record.set(prefix);
      record.set(Buffer.from(objectHash, "hex"), prefix.byteLength);
      records.push(record);
    }
    const bytes = Buffer.concat(records.map((record) => Buffer.from(record)));
    return sha1Object("tree", bytes);
  };
  return hashNode(rootNode);
}

function regularFileCount(rootPath: string): number {
  return inventoryTree(rootPath).filter((entry) => entry.type === "file").length;
}

function recursiveRegularFiles(rootPath: string): string[] {
  return inventoryTree(rootPath)
    .filter((entry) => entry.type === "file")
    .map((entry) => join(rootPath, entry.path));
}

function assertNoHardlinks(rootPath: string, label: string): void {
  for (const path of recursiveRegularFiles(rootPath)) {
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      invariant(fstatSync(descriptor).nlink === 1, `${label} contains a hardlinked regular file`);
    } finally {
      closeSync(descriptor);
    }
  }
}

const GENERIC_CREDENTIAL_ASSIGNMENT_SOURCE = String.raw`\b(?:[a-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd)[a-z0-9_-]*)\b"?\s*[:=]\s*(?:([\'"])([^\'"\r\n]{8,})\1|([^\s\'";,\]\[(){}<>&?#]{8,}))`;
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["openai_sk", /\bsk-[a-zA-Z0-9_-]{10,}\b/g],
  ["openai_token", /\bsk-[a-zA-Z0-9_-]{20,}\b/g],
  ["github_pat", /\bghp_[a-zA-Z0-9]{20,}\b/g],
  ["github_oauth", /\bgho_[a-zA-Z0-9]{20,}\b/g],
  ["github_token", /\b(?:github_pat_|gh[opusr]_)[a-zA-Z0-9_]{20,}\b/g],
  ["npm_token", /\bnpm_[a-zA-Z0-9]{20,}\b/g],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["bearer_token", /\bBearer\s+[a-zA-Z0-9\-._~+/]{12,}=*/gi],
  ["jwt", /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g],
  ["private_key_block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["generic_credential_assignment", new RegExp(GENERIC_CREDENTIAL_ASSIGNMENT_SOURCE, "dgi")],
];
const ENCODED_GENERIC_CREDENTIAL_PATTERN = new RegExp(GENERIC_CREDENTIAL_ASSIGNMENT_SOURCE, "dgi");

function assignmentValue(match: string): string {
  const separator = Math.max(match.indexOf("="), match.indexOf(":"));
  return (separator >= 0 ? match.slice(separator + 1) : match).trim().replace(/^['"]|['"]$/g, "");
}

function secretCategoriesInText(text: string): Set<string> {
  const categories = new Set<string>();
  for (const [name, pattern] of SECRET_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (name === "generic_credential_assignment" && ["your-api-key-here", "example-token", "[REDACTED]"].includes(assignmentValue(match[0]))) continue;
      categories.add(name);
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  for (const category of encodedSecretCategories(text)) categories.add(category);
  return categories;
}

interface SecretScanUnit {
  value: string;
  encoded: boolean;
}

function encodedSecretCategories(text: string): Set<string> {
  const categories = new Set<string>();
  let units: SecretScanUnit[] = Array.from({ length: text.length }, (_value, index) => ({
    value: text[index]!,
    encoded: false,
  }));
  for (let pass = 0; pass < MAX_PERCENT_DECODE_PASSES; pass += 1) {
    const next: SecretScanUnit[] = [];
    let changed = false;
    for (let index = 0; index < units.length; index += 1) {
      const first = units[index]!;
      const second = units[index + 1];
      const third = units[index + 2];
      if (first.value === "%" && second && third && /^[0-9a-f]$/i.test(second.value) && /^[0-9a-f]$/i.test(third.value)) {
        const code = Number.parseInt(`${second.value}${third.value}`, 16);
        next.push({ value: code <= 0x7f ? String.fromCharCode(code) : "\ufffd", encoded: true });
        index += 2;
        changed = true;
      } else {
        next.push(first);
      }
    }
    if (!changed) break;
    units = next;
    const decoded = units.map((unit) => unit.value).join("");
    for (const [name, pattern] of SECRET_PATTERNS) {
      const encodedPattern = name === "generic_credential_assignment" ? ENCODED_GENERIC_CREDENTIAL_PATTERN : pattern;
      const re = new RegExp(encodedPattern.source, encodedPattern.flags.includes("g") ? encodedPattern.flags : `${encodedPattern.flags}g`);
      let match: RegExpExecArray | null;
      while ((match = re.exec(decoded)) !== null) {
        if (name === "generic_credential_assignment" && ["your-api-key-here", "example-token", "[REDACTED]"].includes(assignmentValue(match[0]))) continue;
        if (units.slice(match.index, match.index + match[0].length).some((unit) => unit.encoded)) {
          categories.add(`encoded_${name}`);
        }
        if (match[0].length === 0) re.lastIndex += 1;
      }
    }
    if (pass === MAX_PERCENT_DECODE_PASSES - 1 && units.some((unit, index) =>
      unit.value === "%" && /^[0-9a-f]$/i.test(units[index + 1]?.value ?? "")
        && /^[0-9a-f]$/i.test(units[index + 2]?.value ?? ""))) {
      categories.add("encoded_decode_limit");
    }
  }
  return categories;
}

function compactAsciiProjection(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) if (byte >= 0x20 && byte <= 0x7e) output += String.fromCharCode(byte);
  return output;
}

function printableByteProjection(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) {
    output += (byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d
      ? String.fromCharCode(byte)
      : "\n";
  }
  return output;
}

function utf16Projection(bytes: Uint8Array, bigEndian: boolean): string {
  const length = bytes.byteLength - (bytes.byteLength % 2);
  const copy = new Uint8Array(length);
  if (bigEndian) {
    for (let index = 0; index < length; index += 2) {
      copy[index] = bytes[index + 1]!;
      copy[index + 1] = bytes[index]!;
    }
  } else copy.set(bytes.subarray(0, length));
  return new TextDecoder("utf-16le").decode(copy);
}

function secretCategoriesInFile(path: string): string[] {
  const bytes = readBoundedRegular(path, MAX_IDENTITY_FILE_BYTES);
  const projections = [
    ["raw-utf8", new TextDecoder("utf-8").decode(bytes)],
    ["printable-bytes", printableByteProjection(bytes)],
    ["compact-ascii", compactAsciiProjection(bytes)],
    ["utf16le", utf16Projection(bytes, false)],
    ["utf16be", utf16Projection(bytes, true)],
  ] as const;
  const categories = new Set<string>();
  for (const [projection, text] of projections) {
    for (const category of secretCategoriesInText(text)) categories.add(`${projection}:${category}`);
  }
  return [...categories].sort(byteSort);
}

function isLowConfidenceCredentialCategory(category: string): boolean {
  const pattern = category.slice(category.lastIndexOf(":") + 1);
  return pattern === "generic_credential_assignment" || pattern === "encoded_generic_credential_assignment";
}

function highConfidenceCredentialCategories(categories: string[]): string[] {
  return categories.filter((category) => !isLowConfidenceCredentialCategory(category));
}

function isPublishedExamplePath(path: string): boolean {
  return /(?:^|\/)(?:test|tests|fixtures?|examples?|docs?)(?:\/|$)|\.(?:test|spec)\.[^.]+$|\.d\.ts$|\.(?:md|mdx)$/i.test(path);
}

function isApprovedHighConfidenceCredentialPath(path: string): boolean {
  if (path.startsWith("workspace/")) return isPublishedExamplePath(path.slice("workspace/".length));
  if (path.startsWith("provenance/untracked-files/")) {
    return isPublishedExamplePath(path.slice("provenance/untracked-files/".length));
  }
  return [
    "provenance/base-tree.tar",
    "provenance/candidate.diff",
    "provenance/canonical-candidate-v5.bin",
    "provenance/untracked-records-v5.bin",
  ].includes(path);
}

const manifestBytes = readEvidenceFile("manifest.json", MAX_MANIFEST_BYTES);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as any;
invariant(manifest.schema_version === 4, "unsupported evidence schema");
invariant(/^[a-f0-9]{40}$/.test(manifest.base_ref) && /^[a-f0-9]{40}$/.test(manifest.base_tree), "invalid base identities");
invariant(/^[a-f0-9]{64}$/.test(manifest.canonical_source_candidate_digest), "invalid candidate digest");
invariant(manifest.source_digest_after === manifest.canonical_source_candidate_digest, "source digest drift recorded in manifest");
invariant(manifest.install_free === true, "install-free claim is absent");
function assertTopologyNeutralRecord(value: unknown, label: string): void {
  const serialized = JSON.stringify(value);
  invariant(!/\/proc\/(?:self|[0-9]+)\/fd\/[0-9]+/.test(serialized), `${label} records an ephemeral descriptor path`);
  invariant(!/net:\[[0-9]+\]/.test(serialized), `${label} records an ephemeral namespace inode`);
  invariant(!/\/home\/[^/"\\]+\//.test(serialized), `${label} records absolute home topology`);
  invariant(!/chief-harness-scope-isolation-todos-v[0-9]+/.test(serialized), `${label} records an absolute worktree identity`);
}
invariant(manifest.runtime_topology_free === true, "runtime topology-free claim is absent");
assertTopologyNeutralRecord(manifest, "manifest");
invariant(
  manifest.evidence_root?.manifest_path === "manifest.json"
    && manifest.evidence_root?.manifest_excluded_from_inventory === true
    && manifest.evidence_root?.symlink_count === 0
    && manifest.evidence_root?.special_entry_count === 0
    && manifest.evidence_root?.hardlink_count === 0,
  "whole-root evidence closure policy is absent",
);
const expectedEvidenceRootInventoryWithoutManifest = canonicalInventory(manifest.evidence_root.inventory_without_manifest);
invariant(
  expectedEvidenceRootInventoryWithoutManifest.length === manifest.evidence_root.entry_count_without_manifest
    && expectedEvidenceRootInventoryWithoutManifest.filter((entry) => entry.type === "file").length
      === manifest.evidence_root.regular_file_count_without_manifest,
  "whole-root evidence closure counts changed",
);
invariant(
  expectedEvidenceRootInventoryWithoutManifest.every((entry) => entry.type !== "symlink"),
  "whole-root evidence manifest declares a linked entry",
);
const evidenceRootDescriptorPath = `/proc/${process.pid}/fd/${rootDescriptor}`;
const actualEvidenceRootInventoryWithoutManifest = inventoryTree(
  evidenceRootDescriptorPath,
  (path) => path === "manifest.json",
);
invariant(
  actualEvidenceRootInventoryWithoutManifest.every((entry) => entry.type !== "symlink"),
  "evidence root contains a linked entry",
);
equalInventory(actualEvidenceRootInventoryWithoutManifest, expectedEvidenceRootInventoryWithoutManifest, "whole evidence root");
assertNoHardlinks(evidenceRootDescriptorPath, "evidence root");

validateStructuredIdentity(manifest.tools.inventory);
const bundledToolInventory = canonicalInventory(manifest.tools.bundled);
const actualToolInventory = withEvidenceDirectory("tools", (path) => inventoryTree(path, (entry) => entry === "inventory.json"));
equalInventory(actualToolInventory, bundledToolInventory, "bundled toolchain");
withEvidenceDirectory("tools", (path) => assertNoHardlinks(path, "bundled toolchain"));
invariant(manifest.tools.inventory_sha256 === manifest.tools.inventory.sha256, "toolchain root hash mismatch");
for (const tool of manifest.tools.host as FileIdentity[]) validateIdentity(tool);
const recordedHostBash = (manifest.tools.host as Array<FileIdentity & { role?: string }>).find((tool) => tool.role === "host-bash");
const recordedHostBwrap = (manifest.tools.host as Array<FileIdentity & { role?: string }>).find((tool) => tool.role === "host-bwrap");
const recordedHostGitleaks = (manifest.tools.host as Array<FileIdentity & { role?: string }>).find((tool) => tool.role === "host-gitleaks");
invariant(recordedHostBash?.path === manifest.network_isolation.sandbox_launch_shell.path && recordedHostBash.sha256 === manifest.network_isolation.sandbox_launch_shell.sha256, "sandbox Bash identity is not the bundled host tool");
invariant(recordedHostBwrap?.path === manifest.network_isolation.sandbox_tool.path && recordedHostBwrap.sha256 === manifest.network_isolation.sandbox_tool.sha256, "sandbox bwrap identity is not the bundled host tool");
invariant(recordedHostBash.path === "tools/host/bash", "bundled Bash path is outside trusted verifier policy");
invariant(recordedHostBwrap.path === "tools/host/bwrap", "bundled bwrap path is outside trusted verifier policy");
invariant(
  recordedHostGitleaks?.path === TRUSTED_VERIFIER_EXECUTION_POLICY.bundledGitleaks
    && recordedHostGitleaks.mode === TRUSTED_VERIFIER_EXECUTION_POLICY.gitleaksMode
    && recordedHostGitleaks.size === TRUSTED_VERIFIER_EXECUTION_POLICY.gitleaksSize
    && recordedHostGitleaks.sha256 === TRUSTED_VERIFIER_EXECUTION_POLICY.gitleaksSha256,
  "bundled gitleaks identity is outside trusted verifier policy",
);
validateIdentity(manifest.network_isolation.sandbox_tool);
invariant(
  manifest.network_isolation.sandbox_execution_role === "trusted-host-bwrap"
    && manifest.network_isolation.sandbox_execution_policy === "canonical AppArmor-authorized path with bundled byte, loader, and shared-library equality before and after every run",
  "sandbox execution role policy is not canonical and byte-bound",
);
validateIdentity(manifest.network_isolation.sandbox_launch_shell);
invariant(
  manifest.network_isolation.sandbox_launch_role === "trusted-host-bash",
  "sandbox launch role is not canonical and byte-bound",
);
validateIdentity(manifest.tools.actual_bun);
invariant(manifest.tools.minimal_rootfs === TRUSTED_VERIFIER_EXECUTION_POLICY.minimalRootfs, "minimal rootfs path is outside trusted verifier policy");
invariant(manifest.tools.actual_bun.path === TRUSTED_VERIFIER_EXECUTION_POLICY.bundledBun, "actual Bun identity is not the trusted minimal-rootfs runtime path");
invariant(manifest.tools.actual_bun_version === "1.3.14", "actual Bun version is not pinned to 1.3.14");
invariant(Array.isArray(manifest.tools.runtime_closure) && manifest.tools.runtime_closure.length > 3 && manifest.tools.runtime_closure.length <= 256, "runtime closure bound is invalid");
for (const identity of manifest.tools.runtime_closure as FileIdentity[]) validateIdentity(identity);
function assertHostSandboxRuntimeBinding(): void {
  assertExternalFileMatchesIdentity(
    TRUSTED_VERIFIER_EXECUTION_POLICY.hostBash,
    recordedHostBash,
    "canonical Bash launcher",
  );
  assertExternalFileMatchesIdentity(
    TRUSTED_VERIFIER_EXECUTION_POLICY.hostBwrap,
    recordedHostBwrap,
    "canonical bwrap",
  );
  assertExternalFileMatchesIdentity(process.execPath, manifest.tools.actual_bun, "trusted Bun runtime");
  for (const [bundledPath, trustedPath, label] of [
    [TRUSTED_VERIFIER_EXECUTION_POLICY.bundledGit, TRUSTED_VERIFIER_EXECUTION_POLICY.hostGit, "trusted Git runtime"],
    [TRUSTED_VERIFIER_EXECUTION_POLICY.bundledSh, TRUSTED_VERIFIER_EXECUTION_POLICY.hostSh, "trusted POSIX shell runtime"],
    [TRUSTED_VERIFIER_EXECUTION_POLICY.bundledRm, TRUSTED_VERIFIER_EXECUTION_POLICY.hostRm, "trusted rm runtime"],
  ] as const) {
    const identity = (manifest.tools.runtime_closure as FileIdentity[]).find((entry) => entry.path === bundledPath);
    invariant(identity, `${label} identity is missing`);
    assertExternalFileMatchesIdentity(trustedPath, identity, label);
  }
  const minimalRootPrefix = `${TRUSTED_VERIFIER_EXECUTION_POLICY.minimalRootfs}/`;
  for (const identity of manifest.tools.runtime_closure as FileIdentity[]) {
    if (!identity.path.startsWith(minimalRootPrefix)) continue;
    const relativeRuntimePath = identity.path.slice(minimalRootPrefix.length);
    if (!relativeRuntimePath.startsWith("lib/") && !relativeRuntimePath.startsWith("usr/lib/")) continue;
    assertExternalFileMatchesIdentity(`/${relativeRuntimePath}`, identity, `sandbox runtime /${relativeRuntimePath}`);
  }
}
assertHostSandboxRuntimeBinding();
const minimalRootfsInventory = withEvidenceDirectory(TRUSTED_VERIFIER_EXECUTION_POLICY.minimalRootfs, (path) => inventoryTree(path));
invariant(minimalRootfsInventory.every((entry) => entry.type === "file" || entry.type === "directory"), "minimal rootfs contains a symlink or special member");
withEvidenceDirectory(TRUSTED_VERIFIER_EXECUTION_POLICY.minimalRootfs, (path) => assertNoHardlinks(path, "minimal rootfs"));
const minimalRootPrefix = `${TRUSTED_VERIFIER_EXECUTION_POLICY.minimalRootfs}/`;
const trustedRootfsFiles = (manifest.tools.runtime_closure as FileIdentity[])
  .filter((identity) => identity.path.startsWith(minimalRootPrefix))
  .map((identity) => identity.path.slice(minimalRootPrefix.length));
for (const path of trustedRootfsFiles) {
  invariant(
    ["opt/bin/bun", "opt/bin/git", "bin/sh", "bin/rm"].includes(path)
      || path.startsWith("lib/")
      || path.startsWith("usr/lib/"),
    `minimal rootfs runtime path is outside trusted verifier policy: ${path}`,
  );
}
const trustedRootfsPaths = new Set<string>(["cache", "dev", "home", "mnt", "proc", "srv", "tmp", "usr"]);
for (const file of trustedRootfsFiles) {
  trustedRootfsPaths.add(file);
  const parts = file.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    trustedRootfsPaths.add(parts.slice(0, index).join("/"));
  }
}
invariant(
  JSON.stringify([...trustedRootfsPaths].sort(byteSort))
    === JSON.stringify(minimalRootfsInventory.map((entry) => entry.path).sort(byteSort)),
  "minimal rootfs contains a path outside the trusted runtime closure",
);

validateIdentity(manifest.dependencies.archive);
validateIdentity(manifest.dependencies.lockfile);
const expectedDependencyInventory = canonicalInventory(parseJsonFile<InventoryEntry[]>(manifest.dependencies.inventory));
const afterDependencyInventory = canonicalInventory(parseJsonFile<InventoryEntry[]>(manifest.dependencies.inventory_after));
assertDependencySymlinkClosure(expectedDependencyInventory);
equalInventory(expectedDependencyInventory, afterDependencyInventory, "dependency before/after");
invariant(expectedDependencyInventory.length === manifest.dependencies.inventory_count, "dependency inventory count mismatch");
const dependencyEntries = readTar(evidencePath(manifest.dependencies.archive.path), true);
assertArchiveExtractionClosed(dependencyEntries);
assertDependencySymlinkClosure(dependencyEntries);
equalInventory(dependencyEntries.map(({ bytes: _bytes, ...entry }) => entry), expectedDependencyInventory, "dependency archive");
invariant(
  manifest.dependencies.special_member_count === 0
    && manifest.dependencies.hardlink_member_count === 0
    && manifest.dependencies.symlink_member_count === expectedDependencyInventory.filter((entry) => entry.type === "symlink").length,
  "dependency archive member-type claim changed",
);
const explicitDependencyParents = dependencyEntries.some((entry) => entry.path === "dashboard/node_modules") ? ["dashboard"] : [];
invariant(
  manifest.dependencies.extraction_root === "."
    && JSON.stringify(manifest.dependencies.explicit_parent_entries) === JSON.stringify(explicitDependencyParents)
    && manifest.dependencies.extraction_inventory_equal === true,
  "dependency archive extraction-root closure claim changed",
);
const cleanDependencyExtractionRoot = mkdtempSync(join(tmpdir(), "todos-stage-a-dependency-extraction-"));
try {
  extractTar(dependencyEntries, cleanDependencyExtractionRoot);
  equalInventory(inventoryTree(cleanDependencyExtractionRoot), expectedDependencyInventory, "clean dependency extraction");
  assertDependencySymlinkClosure(inventoryTree(cleanDependencyExtractionRoot));
  assertNoHardlinks(cleanDependencyExtractionRoot, "clean dependency extraction");
} finally {
  rmSync(cleanDependencyExtractionRoot, { recursive: true, force: true });
}
const dependencyMap = new Map(expectedDependencyInventory.map((entry) => [entry.path, entry]));
validateIdentity(manifest.dependencies.typescript_script, dependencyMap);
const existingDependencyBytes = manifest.dependencies.existing_dependency_bytes;
invariant(
  existingDependencyBytes?.version === "existing-dependency-bytes-v1"
    && existingDependencyBytes.descriptor_anchored === true
    && existingDependencyBytes.source_path_recorded === false
    && existingDependencyBytes.read_only_source === true
    && existingDependencyBytes.source_unchanged === true
    && existingDependencyBytes.lockfile_unchanged === true
    && JSON.stringify(existingDependencyBytes.source_scratch_exclusions) === JSON.stringify([
      "node_modules/.cache",
      "node_modules/.old_modules-*",
      "dashboard/node_modules/.vite-temp",
    ])
    && !Object.hasOwn(manifest.dependencies, "clean_frozen_offline_install"),
  "existing dependency-byte evidence contract changed",
);
validateStructuredIdentity(existingDependencyBytes.source_inventory);
const sourceDependencyInventory = canonicalInventory(parseJsonFile<InventoryEntry[]>(existingDependencyBytes.source_inventory));
invariant(
  sourceDependencyInventory.length === existingDependencyBytes.source_inventory_count
    && sourceDependencyInventory.some((entry) => entry.path === "node_modules" && entry.type === "directory"),
  "existing dependency source inventory is incomplete",
);
for (const entry of sourceDependencyInventory) {
  if (entry.type !== "symlink") continue;
  invariant(
    typeof entry.target === "string"
      && !isAbsolute(entry.target)
      && !entry.target.includes("\0")
      && !entry.target.includes("\\")
      && !posix.normalize(posix.join(posix.dirname(entry.path), entry.target)).startsWith("../"),
    `existing dependency source records unsafe link topology: ${entry.path}`,
  );
}

const verifierRuntimeHome = mkdtempSync(join(tmpdir(), "todos-stage-a-runtime-home-"));
process.on("exit", () => rmSync(verifierRuntimeHome, { recursive: true, force: true }));

interface SandboxInvocation {
  args: string[];
  recordedArgv: string[];
  descriptors: number[];
}

function openDirectoryAt(rootDirectoryDescriptor: number, path: string): number {
  const parts = path.split("/").filter(Boolean);
  let descriptor = rootDirectoryDescriptor;
  try {
    for (const part of parts) {
      invariant(part !== "." && part !== ".." && !part.includes("\0") && !part.includes("/"), "unsafe mounted directory path");
      const next = openSync(
        `/proc/self/fd/${descriptor}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      if (descriptor !== rootDirectoryDescriptor) closeSync(descriptor);
      descriptor = next;
    }
    return descriptor;
  } catch (error) {
    if (descriptor !== rootDirectoryDescriptor) closeSync(descriptor);
    throw error;
  }
}

function writeAnchoredNewRegular(rootDirectoryDescriptor: number, path: string, bytes: Uint8Array, mode: number): void {
  const parts = safeRelativePath(path).split("/");
  let directoryDescriptor = rootDirectoryDescriptor;
  try {
    for (const part of parts.slice(0, -1)) {
      const nextPath = `/proc/self/fd/${directoryDescriptor}/${part}`;
      let next: number;
      try {
        next = openSync(nextPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        mkdirSync(nextPath, { recursive: false, mode: 0o755 });
        next = openSync(nextPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      }
      if (directoryDescriptor !== rootDirectoryDescriptor) closeSync(directoryDescriptor);
      directoryDescriptor = next;
    }
    const descriptor = openSync(
      `/proc/self/fd/${directoryDescriptor}/${parts.at(-1)!}`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode & 0o777,
    );
    try {
      writeFileSync(descriptor, bytes);
      fchmodSync(descriptor, mode & 0o777);
    } finally {
      closeSync(descriptor);
    }
  } finally {
    if (directoryDescriptor !== rootDirectoryDescriptor) closeSync(directoryDescriptor);
  }
}

function sandboxInvocation(hostWorkspace: string, env: Record<string, string>, argv: string[]): SandboxInvocation {
  invariant(Array.isArray(argv) && argv.length > 0 && argv.length <= 64, "sandbox argv bound exceeded");
  const descriptors: number[] = [];
  try {
    const workspaceDescriptor = openSync(hostWorkspace, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const rootfsDescriptor = openEvidenceDirectory(TRUSTED_VERIFIER_EXECUTION_POLICY.minimalRootfs);
    const runtimeDescriptor = openSync(verifierRuntimeHome, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const bwrapDescriptor = openExternalFileMatchingIdentity(
      TRUSTED_VERIFIER_EXECUTION_POLICY.hostBwrap,
      recordedHostBwrap,
      "canonical bwrap",
    );
    descriptors.push(workspaceDescriptor, rootfsDescriptor, runtimeDescriptor, bwrapDescriptor);
    const boundDescriptors = [...descriptors];
    const recordedMountSources = ["<workspace-fd>", "<minimal-rootfs-fd>", "<runtime-home-fd>", "<bwrap-fd>"];
    const childFd = (index: number): number => index + 3;
    const bwrapChildFd = childFd(boundDescriptors.length - 1);
    const bwrapArgv = [
      `/proc/self/fd/${bwrapChildFd}`,
      "--die-with-parent", "--new-session",
      "--unshare-user", "--unshare-ipc", "--unshare-pid", "--unshare-uts", "--unshare-cgroup-try", "--unshare-net",
      "--ro-bind-fd", String(childFd(1)), "/", "--proc", "/proc", "--dev", "/dev",
      "--bind-fd", String(childFd(0)), "/mnt",
      "--bind-fd", String(childFd(2)), "/srv",
      "--tmpfs", "/home", "--perms", "1777", "--tmpfs", "/tmp", "--clearenv",
    ];
    for (const [key, value] of Object.entries(env).sort(([left], [right]) => byteSort(left, right))) {
      invariant(!key.includes("\0") && !value.includes("\0"), "sandbox environment contains NUL");
      bwrapArgv.push("--setenv", key, value);
    }
    for (const identity of (manifest.tools.runtime_closure as FileIdentity[])
      .filter((entry) => entry.path.startsWith(minimalRootPrefix))
      .sort((left, right) => byteSort(left.path, right.path))) {
      const runtimeDescriptor = openEvidenceFileMatchingIdentity(identity, `sandbox runtime ${identity.path}`);
      descriptors.push(runtimeDescriptor);
      boundDescriptors.push(runtimeDescriptor);
      recordedMountSources.push(`<runtime-fd:/${identity.path.slice(minimalRootPrefix.length)}>`);
      bwrapArgv.push(
        "--ro-bind-fd",
        String(childFd(boundDescriptors.length - 1)),
        `/${identity.path.slice(minimalRootPrefix.length)}`,
      );
    }
    for (const [hostRelative, sandbox] of [
      ["node_modules", "/mnt/node_modules"],
      ["dashboard/node_modules", "/mnt/dashboard/node_modules"],
    ] as const) {
      try {
        const dependencyDescriptor = openDirectoryAt(workspaceDescriptor, hostRelative);
        descriptors.push(dependencyDescriptor);
        boundDescriptors.push(dependencyDescriptor);
        recordedMountSources.push(`<dependency-fd:${sandbox}>`);
        bwrapArgv.push("--ro-bind-fd", String(childFd(boundDescriptors.length - 1)), sandbox);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    bwrapArgv.push("--chdir", "/mnt", "--", ...argv);
    const mountSources = boundDescriptors.map((descriptor) => `/proc/${process.pid}/fd/${descriptor}`);
    const launcher = [
      "set -euo pipefail",
      "ulimit -f 65536",
      ...mountSources.map((_source, index) => `exec ${childFd(index)}<\"\${${index + 1}}\"`),
      `shift ${mountSources.length}`,
      'exec "$@"',
    ].join("\n");
    return {
      args: [
        "-c",
        launcher,
        "stage-a-bwrap-launch",
        ...mountSources,
        ...bwrapArgv,
      ],
      recordedArgv: [
        "tools/host/bash",
        "-c",
        launcher,
        "stage-a-bwrap-launch",
        ...recordedMountSources,
        "tools/host/bwrap",
        ...bwrapArgv.slice(1),
      ],
      descriptors,
    };
  } catch (error) {
    for (const descriptor of descriptors) closeSync(descriptor);
    throw error;
  }
}

async function runSandbox(hostWorkspace: string, env: Record<string, string>, argv: string[]): Promise<{ status: number; stdout: Buffer; stderr: Buffer; launchArgv: string[] }> {
  assertHostSandboxRuntimeBinding();
  const invocation = sandboxInvocation(hostWorkspace, env, argv);
  let result!: PinnedCommandResult;
  try {
    result = await runPinnedCommand({
      executable: externalExecutableIdentity(
        TRUSTED_VERIFIER_EXECUTION_POLICY.hostBash,
        recordedHostBash,
      ),
      args: invocation.args,
      env: { LANG: "C.UTF-8", LC_ALL: "C" },
      stdin: "ignore",
      deadlineMs: NETWORK_PROBE_POLICY.deadlineMs,
      outputLimitBytes: NETWORK_PROBE_POLICY.outputLimitBytes,
      outputCapture: "files",
    });
  } finally {
    for (const descriptor of invocation.descriptors) closeSync(descriptor);
    assertHostSandboxRuntimeBinding();
  }
  return {
    status: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    launchArgv: invocation.recordedArgv,
  };
}

const bunVersionResult = await runSandbox(verifierRuntimeHome, {
  PATH: "/opt/bin:/bin",
  HOME: "/srv",
  TMPDIR: "/tmp",
  LANG: "C.UTF-8",
  LC_ALL: "C",
}, ["/opt/bin/bun", "--version"]);
invariant(bunVersionResult.status === 0 && bunVersionResult.stdout.toString("utf8").trim() === manifest.tools.actual_bun_version, "bundled Bun runtime/version mismatch");

for (const identity of [
  manifest.provenance.base_commit,
  manifest.provenance.base_tree_archive,
  manifest.provenance.binary_diff,
  manifest.provenance.sorted_untracked_paths,
  manifest.provenance.untracked_records,
  manifest.provenance.canonical_digest_input,
]) validateIdentity(identity);

const commitBytes = readEvidenceFile(manifest.provenance.base_commit.path);
invariant(sha1Object("commit", commitBytes) === manifest.base_ref, "base commit bytes do not match base_ref");
const commitTree = commitBytes.toString().match(/^tree ([0-9a-f]{40})$/m)?.[1];
invariant(commitTree === manifest.base_tree, "base commit tree does not match manifest");
const baseEntries = readTar(evidencePath(manifest.provenance.base_tree_archive.path), true);
invariant(gitTreeHash(baseEntries) === manifest.base_tree, "base-tree archive does not reconstruct the committed Git tree");

const sourceBefore = canonicalInventory(parseJsonFile<InventoryEntry[]>(manifest.provenance.copied_source_before));
const sourceAfter = canonicalInventory(parseJsonFile<InventoryEntry[]>(manifest.provenance.copied_source_after));
const reconstructedClaim = canonicalInventory(parseJsonFile<InventoryEntry[]>(manifest.provenance.reconstructed_source));
equalInventory(sourceBefore, sourceAfter, "copied source before/after");
equalInventory(sourceBefore, reconstructedClaim, "recorded reconstruction");
invariant(manifest.provenance.inventories_equal === true, "source inventory equality claim is absent");
const actualSource = withEvidenceDirectory("workspace", (rootPath) => inventoryTree(rootPath, (path) => path === "dist" || path.startsWith("dist/")
  || path === "node_modules" || path.startsWith("node_modules/")
  || path === "dashboard/node_modules" || path.startsWith("dashboard/node_modules/")));
equalInventory(actualSource, sourceBefore, "retained copied source");

const untrackedInventory = parseJsonFile<Array<CanonicalUntrackedIdentity & { evidence_path: string }>>(manifest.provenance.untracked_inventory);
invariant(untrackedInventory.length <= MAX_INVENTORY_ENTRIES, "untracked inventory bound exceeded");
const canonicalInput = readEvidenceFile(manifest.provenance.canonical_digest_input.path);
const decodedCandidate = decodeCanonicalCandidateInput(canonicalInput);
invariant(decodedCandidate.version === STAGE_A_CANDIDATE_IDENTITY_VERSION, "canonical candidate version marker changed");
invariant(
  Buffer.compare(decodedCandidate.trackedDiff, readEvidenceFile(manifest.provenance.binary_diff.path)) === 0,
  "canonical candidate tracked binary/full-index diff mismatch",
);
const identityProjection = untrackedInventory.map(({ evidence_path: _evidencePath, ...identity }) => identity);
invariant(
  JSON.stringify(identityProjection) === JSON.stringify(decodedCandidate.untracked),
  "versioned untracked identity inventory differs from the canonical candidate",
);
const untrackedPaths = decodedCandidate.untracked;
invariant(
  Buffer.compare(canonicalSortedPathBytes(untrackedPaths.map((entry) => entry.path)), readEvidenceFile(manifest.provenance.sorted_untracked_paths.path)) === 0,
  "sorted NUL untracked path stream mismatch",
);
invariant(
  Buffer.compare(canonicalUntrackedRecords(untrackedPaths), readEvidenceFile(manifest.provenance.untracked_records.path)) === 0
    && Buffer.compare(decodedCandidate.untrackedRecords, readEvidenceFile(manifest.provenance.untracked_records.path)) === 0,
  "versioned untracked canonical records mismatch",
);
for (const entry of untrackedInventory) {
  invariant(entry.type === "regular-file", `untracked evidence identity is not regular-file: ${entry.path}`);
  invariant(entry.evidence_path === `provenance/untracked-files/${entry.path}`, `untracked evidence path is non-canonical: ${entry.path}`);
  validateIdentity({
    path: entry.evidence_path,
    mode: entry.mode,
    size: entry.size,
    sha256: entry.sha256,
  });
}
invariant(sha256Bytes(canonicalInput) === manifest.canonical_source_candidate_digest, "canonical source digest mismatch");

const reconstructionRoot = mkdtempSync(join(tmpdir(), "todos-stage-a-reconstruct-"));
try {
  extractTar(baseEntries, reconstructionRoot);
  const reconstructionDescriptor = openSync(reconstructionRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (manifest.provenance.binary_diff.size > 0) {
      const reconstructionDiff = ".stage-a-candidate.diff";
      writeAnchoredNewRegular(reconstructionDescriptor, reconstructionDiff, readEvidenceFile(manifest.provenance.binary_diff.path), 0o600);
      const result = await runSandbox(reconstructionRoot, {
        PATH: "/opt/bin:/bin",
        HOME: "/srv",
        LANG: "C.UTF-8",
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      }, ["/opt/bin/git", "apply", "--binary", "--whitespace=nowarn", reconstructionDiff]);
      rmSync(join(reconstructionRoot, reconstructionDiff), { force: false });
      invariant(result.status === 0, `bundled git could not apply candidate diff: ${result.stderr.toString("utf8").slice(0, 1_000)}`);
    }
    for (const entry of untrackedInventory) {
      writeAnchoredNewRegular(
        reconstructionDescriptor,
        entry.path,
        readEvidenceFile(entry.evidence_path),
        Number.parseInt(entry.mode, 8),
      );
    }
  } finally {
    closeSync(reconstructionDescriptor);
  }
  equalInventory(inventoryTree(reconstructionRoot), sourceBefore, "independent candidate reconstruction");
} finally {
  rmSync(reconstructionRoot, { recursive: true, force: true });
}

const credentialScan = parseJsonFile<any>(manifest.provenance.credential_scan);
invariant(
  credentialScan.clean_of_unapproved_gitleaks_findings === true
    && credentialScan.clean_of_unapproved_high_confidence_heuristic_findings === true
    && Array.isArray(credentialScan.files)
    && credentialScan.files.length <= MAX_INVENTORY_ENTRIES
    && credentialScan.files_scanned === credentialScan.files.length,
  "credential scan claim is incomplete or unbounded",
);
invariant(
  JSON.stringify(credentialScan.scan_scope) === JSON.stringify(["workspace-source-and-lock-closure", "artifact", "provenance"])
    && JSON.stringify(credentialScan.projections) === JSON.stringify(["raw-utf8", "printable-bytes", "compact-ascii", "utf16le", "utf16be"])
    && credentialScan.max_percent_decode_passes === MAX_PERCENT_DECODE_PASSES,
  "credential projection/fixed-point policy changed",
);
invariant(
  credentialScan.low_confidence_policy === "retain and report every generic assignment category; do not treat lexical key-name matches as credential values"
    && credentialScan.high_confidence_approval_policy === "strong signatures may occur only in published tests, fixtures, examples, docs, declarations, or byte-identical provenance containers independently represented by the workspace scan"
    && Number.isSafeInteger(credentialScan.low_confidence_heuristic_file_count)
    && Number.isSafeInteger(credentialScan.approved_high_confidence_heuristic_file_count)
    && credentialScan.unapproved_high_confidence_heuristic_file_count === 0,
  "credential heuristic review policy changed",
);
const credentialClosureRoot = mkdtempSync(join(tmpdir(), "todos-stage-a-credential-closure-"));
try {
  const closureWorkspace = join(credentialClosureRoot, "workspace");
  withEvidenceDirectory("workspace", (_path, descriptor) => copyDescriptorAnchoredTree(descriptor, closureWorkspace));
  extractTar(dependencyEntries, closureWorkspace);
  const scanTree = (rootPath: string, prefix: string): Array<{ path: string; sha256: string; heuristic_categories: string[] }> =>
    recursiveRegularFiles(rootPath).map((path) => ({
      path: `${prefix}/${relative(rootPath, path).split(sep).join("/")}`,
      sha256: sha256File(path),
      heuristic_categories: secretCategoriesInFile(path),
    }));
  const actualClosureScans = [
    ...scanTree(closureWorkspace, "workspace"),
    ...withEvidenceDirectory("artifact", (path) => scanTree(path, "artifact")),
    ...withEvidenceDirectory("provenance", (path) => scanTree(path, "provenance")),
  ];
  if (JSON.stringify(actualClosureScans) !== JSON.stringify(credentialScan.files)) {
    const expectedClosureScans = credentialScan.files as Array<{ path?: unknown; sha256?: unknown; heuristic_categories?: unknown }>;
    const mismatchIndex = Array.from({ length: Math.max(actualClosureScans.length, expectedClosureScans.length) })
      .findIndex((_unused, index) => JSON.stringify(actualClosureScans[index]) !== JSON.stringify(expectedClosureScans[index]));
    const actual = actualClosureScans[mismatchIndex];
    const expected = expectedClosureScans[mismatchIndex];
    throw new Error(`full byte-projection credential closure scan inventory mismatch at ${mismatchIndex}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
  const unapprovedHeuristicFiles = actualClosureScans.filter((entry) =>
    highConfidenceCredentialCategories(entry.heuristic_categories).length > 0
      && !isApprovedHighConfidenceCredentialPath(entry.path));
  invariant(unapprovedHeuristicFiles.length === 0, "full closure contains an unapproved heuristic credential match");
  invariant(
    actualClosureScans.filter((entry) => entry.heuristic_categories.some(isLowConfidenceCredentialCategory)).length
      === credentialScan.low_confidence_heuristic_file_count,
    "low-confidence credential finding count changed",
  );
  invariant(
    actualClosureScans.filter((entry) => highConfidenceCredentialCategories(entry.heuristic_categories).length > 0).length
      === credentialScan.approved_high_confidence_heuristic_file_count,
    "approved high-confidence credential finding count changed",
  );
} finally {
  rmSync(credentialClosureRoot, { recursive: true, force: true });
}
const bundledGitleaks = (manifest.tools.host as Array<{ role?: string; path: string; sha256: string }>).find((identity) => identity.role === "host-gitleaks");
invariant(
  bundledGitleaks
    && credentialScan.gitleaks.tool.path === TRUSTED_VERIFIER_EXECUTION_POLICY.bundledGitleaks
    && credentialScan.gitleaks.tool.path === bundledGitleaks.path
    && credentialScan.gitleaks.tool.mode === TRUSTED_VERIFIER_EXECUTION_POLICY.gitleaksMode
    && credentialScan.gitleaks.tool.size === TRUSTED_VERIFIER_EXECUTION_POLICY.gitleaksSize
    && credentialScan.gitleaks.tool.sha256 === TRUSTED_VERIFIER_EXECUTION_POLICY.gitleaksSha256
    && credentialScan.gitleaks.tool.sha256 === bundledGitleaks.sha256,
  "credential scan is not bound to trusted bundled gitleaks",
);
validateIdentity(credentialScan.gitleaks.tool);
validateIdentity(credentialScan.gitleaks.primary.stdout);
validateIdentity(credentialScan.gitleaks.primary.stderr);
validateIdentity(credentialScan.gitleaks.independent_replay.stdout);
validateIdentity(credentialScan.gitleaks.independent_replay.stderr);
const expectedGitleaksArgv = [
  "tools/host/gitleaks", "dir", "<private-normal-path-snapshot>",
  "--no-banner", "--no-color", "--log-level", "error", "--redact=100",
  "--max-archive-depth", "2", "--max-decode-depth", "32", "--max-target-megabytes", "1024",
  "--timeout", "120", "--report-format", "json", "--report-path", "<private-report>",
];
invariant(
  JSON.stringify(credentialScan.gitleaks.expected_exit) === JSON.stringify([0, 1])
    && [0, 1].includes(credentialScan.gitleaks.primary.exit_code)
    && credentialScan.gitleaks.primary.exit_code === credentialScan.gitleaks.independent_replay.exit_code
    && credentialScan.gitleaks.max_archive_depth === 2
    && credentialScan.gitleaks.max_decode_depth === 32,
  "gitleaks execution policy changed",
);
invariant(
  credentialScan.gitleaks.stdin === "ignore"
    && credentialScan.gitleaks.deadline_ms === 180_000
    && credentialScan.gitleaks.output_limit_bytes === MAX_COMMAND_OUTPUT_BYTES
    && credentialScan.gitleaks.primary.termination === "exit"
    && credentialScan.gitleaks.independent_replay.termination === "exit",
  "gitleaks deadline/input/termination policy changed",
);
invariant(
  JSON.stringify(credentialScan.gitleaks.scan_scope) === JSON.stringify(["workspace-candidate-source", "artifact"])
    && credentialScan.gitleaks.scan_root === "<private-normal-path-snapshot>"
    && credentialScan.gitleaks.cwd === "<private-scan-root>"
    && credentialScan.gitleaks.normal_path === true
    && credentialScan.gitleaks.descriptor_anchored_snapshot === true
    && credentialScan.gitleaks.descriptor_path_scan_root === false
    && JSON.stringify(credentialScan.gitleaks.argv) === JSON.stringify(expectedGitleaksArgv)
    && credentialScan.gitleaks.byte_outputs_equal === true
    && credentialScan.gitleaks.findings_equal === true
    && credentialScan.gitleaks.matched_values_recorded === false
    && JSON.stringify(credentialScan.gitleaks.finding_fields_recorded) === JSON.stringify(["rule", "file", "line", "classification"]),
  "recorded gitleaks normal-path binding is invalid",
);
invariant(Array.isArray(credentialScan.gitleaks.findings) && credentialScan.gitleaks.findings.length <= 100_000, "gitleaks finding bound exceeded");
for (const finding of credentialScan.gitleaks.findings as Array<{ rule: string; file: string; line: number; classification: string }>) {
  invariant(Object.keys(finding).sort().join(",") === "classification,file,line,rule", "gitleaks finding records a field outside redacted metadata");
  invariant(typeof finding.rule === "string" && typeof finding.file === "string", "invalid redacted gitleaks finding fields");
  invariant(finding.classification === "synthetic_test_fixture" && Number.isSafeInteger(finding.line), "invalid redacted gitleaks finding");
  invariant(!finding.file.startsWith("/") && !finding.file.includes("\0") && !finding.file.includes("\\"), "gitleaks finding path is unsafe");
  invariant(finding.file.startsWith("workspace/") && isPublishedExamplePath(finding.file.slice("workspace/".length)), "gitleaks finding is outside an approved synthetic source path");
}

invariant(
  Buffer.compare(readEvidenceFile(credentialScan.gitleaks.primary.stdout.path), readEvidenceFile(credentialScan.gitleaks.independent_replay.stdout.path)) === 0
    && Buffer.compare(readEvidenceFile(credentialScan.gitleaks.primary.stderr.path), readEvidenceFile(credentialScan.gitleaks.independent_replay.stderr.path)) === 0,
  "recorded normal-path gitleaks replays are not byte-identical",
);

const gitleaksReplayRoot = mkdtempSync(join(tmpdir(), "todos-stage-a-gitleaks-replay-"));
try {
  chmodSync(gitleaksReplayRoot, 0o700);
  const snapshotPath = join(gitleaksReplayRoot, "gitleaks-normal-path-snapshot");
  const snapshotWorkspace = join(snapshotPath, "workspace");
  const snapshotArtifact = join(snapshotPath, "artifact");
  mkdirSync(snapshotPath, { mode: 0o700 });
  withEvidenceDirectory("workspace", (_path, descriptor) => copyDescriptorAnchoredTree(descriptor, snapshotWorkspace));
  for (const transient of ["dist", "node_modules", "dashboard/node_modules"]) {
    rmSync(join(snapshotWorkspace, transient), { recursive: true, force: true });
  }
  equalInventory(inventoryTree(snapshotWorkspace), sourceBefore, "gitleaks normal-path workspace snapshot");
  withEvidenceDirectory("artifact", (_path, descriptor) => copyDescriptorAnchoredTree(descriptor, snapshotArtifact));
  equalInventory(inventoryTree(snapshotArtifact), manifest.artifact.inventory, "gitleaks normal-path artifact snapshot");
  const snapshotDescriptor = openSync(snapshotPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const replayReport = join(gitleaksReplayRoot, "report.json");
  let replay!: PinnedCommandResult;
  try {
    const lexicalBefore = statSync(snapshotPath);
    const anchoredBefore = fstatSync(snapshotDescriptor);
    invariant(anchoredBefore.isDirectory() && anchoredBefore.dev === lexicalBefore.dev && anchoredBefore.ino === lexicalBefore.ino, "gitleaks replay snapshot is not descriptor anchored");
    const snapshotInventoryBefore = inventoryTree(snapshotPath);
    const replayArgv = [
      "dir", snapshotPath,
      "--no-banner", "--no-color", "--log-level", "error", "--redact=100",
      "--max-archive-depth", "2", "--max-decode-depth", "32", "--max-target-megabytes", "1024",
      "--timeout", "120", "--report-format", "json", "--report-path", replayReport,
    ];
    replay = await runPinnedCommand({
      executable: externalExecutableIdentity(
        evidencePath(TRUSTED_VERIFIER_EXECUTION_POLICY.bundledGitleaks),
        credentialScan.gitleaks.tool,
      ),
      args: replayArgv,
      cwd: gitleaksReplayRoot,
      env: { LANG: "C.UTF-8", LC_ALL: "C" },
      stdin: "ignore",
      deadlineMs: 180_000,
      outputLimitBytes: MAX_COMMAND_OUTPUT_BYTES,
    });
    const lexicalAfter = statSync(snapshotPath);
    const anchoredAfter = fstatSync(snapshotDescriptor);
    invariant(
      lexicalAfter.dev === anchoredBefore.dev
        && lexicalAfter.ino === anchoredBefore.ino
        && anchoredAfter.dev === anchoredBefore.dev
        && anchoredAfter.ino === anchoredBefore.ino
        && JSON.stringify(inventoryTree(snapshotPath)) === JSON.stringify(snapshotInventoryBefore),
      "gitleaks normal-path replay snapshot changed during traversal",
    );
  } finally {
    closeSync(snapshotDescriptor);
  }
  invariant(replay.exitCode === credentialScan.gitleaks.primary.exit_code && existsSync(replayReport), "independent gitleaks replay exit/report mismatch");
  invariant(Buffer.compare(replay.stdout, readEvidenceFile(credentialScan.gitleaks.primary.stdout.path)) === 0, "gitleaks stdout bytes changed during replay");
  invariant(Buffer.compare(replay.stderr, readEvidenceFile(credentialScan.gitleaks.primary.stderr.path)) === 0, "gitleaks stderr bytes changed during replay");
  const reportBytes = readBoundedRegular(replayReport, MAX_STRUCTURED_JSON_BYTES);
  const rawReplayFindings = JSON.parse(reportBytes.toString("utf8")) as Array<{ RuleID?: unknown; File?: unknown; StartLine?: unknown }>;
  invariant(Array.isArray(rawReplayFindings) && rawReplayFindings.length <= 100_000, "replayed gitleaks report is unbounded");
  const snapshotPrefixes = [`${snapshotPath}${sep}`, `${realpathSync(snapshotPath)}${sep}`];
  const replayFindings = rawReplayFindings.map((finding) => {
    invariant(typeof finding.RuleID === "string" && typeof finding.File === "string" && Number.isSafeInteger(finding.StartLine), "gitleaks replay emitted invalid redacted metadata");
    const snapshotPrefix = snapshotPrefixes.find((prefix) => (finding.File as string).startsWith(prefix));
    invariant(snapshotPrefix, "gitleaks replay escaped the private normal-path snapshot");
    const file = (finding.File as string).slice(snapshotPrefix.length).split(sep).join("/");
    invariant(file.startsWith("workspace/") && isPublishedExamplePath(file.slice("workspace/".length)), "gitleaks replay found an unapproved credential-like value");
    return {
      rule: finding.RuleID,
      file,
      line: finding.StartLine as number,
      classification: "synthetic_test_fixture",
    };
  }).sort((left, right) => byteSort(`${left.file}\0${left.line}\0${left.rule}`, `${right.file}\0${right.line}\0${right.rule}`));
  invariant(JSON.stringify(replayFindings) === JSON.stringify(credentialScan.gitleaks.findings), "independent gitleaks findings differ from the redacted record");
} finally {
  rmSync(gitleaksReplayRoot, { recursive: true, force: true });
}

const commandRecords = manifest.containment_smokes as CommandRecord[];
const artifactCommandRecords = manifest.artifact.smokes as CommandRecord[];
invariant(Array.isArray(commandRecords) && commandRecords.length === 29, "containment smoke count must be 29");
invariant(Array.isArray(artifactCommandRecords) && artifactCommandRecords.length === 13, "artifact smoke count must be 13");
invariant(commandRecords.length + artifactCommandRecords.length <= MAX_EXECUTIONS, "execution bound exceeded");
const allRecords = [...commandRecords, ...artifactCommandRecords];
const networkProbe = manifest.network_isolation.probe as CommandRecord;
assertCommandRecordMatchesPolicy(networkProbe, NETWORK_PROBE_POLICY, "network probe");
for (const [index, policyValue] of SOURCE_REPLAY_POLICY.entries()) {
  assertCommandRecordMatchesPolicy(commandRecords[index], policyValue, `source command ${index}`);
}
for (const [index, policyValue] of ARTIFACT_REPLAY_POLICY.entries()) {
  assertCommandRecordMatchesPolicy(artifactCommandRecords[index], policyValue, `artifact command ${index}`);
}
invariant(manifest.network_isolation.mechanism === "minimal-rootfs bwrap --unshare-user --unshare-pid --unshare-net with new proc", "network namespace/minimal-root proof is incomplete");
invariant(
  manifest.network_isolation.namespace_isolated === true
    && manifest.network_isolation.namespace_identifiers_recorded === false
    && manifest.network_isolation.namespace_output_normalization === "net:[NAMESPACE]"
    && !Object.hasOwn(manifest.network_isolation, "parent_namespace")
    && !Object.hasOwn(manifest.network_isolation, "child_namespace"),
  "network namespace topology-neutral proof is incomplete",
);
invariant(JSON.stringify(manifest.network_isolation.interfaces) === JSON.stringify(["lo"]) && manifest.network_isolation.interface_policy === "LOOPBACK_ONLY" && JSON.stringify(manifest.network_isolation.routes) === "[]", "isolated interface/route claim changed");
invariant(manifest.network_isolation.inherited_socket_descriptors === 0 && manifest.network_isolation.inherited_mount_descriptors === 0 && typeof manifest.network_isolation.route_probe_result === "string" && manifest.network_isolation.route_probe_result.length > 0 && !/[\r\n]/.test(manifest.network_isolation.route_probe_result), "network descriptor/route floor changed");
invariant(networkProbe.replayable === true && networkProbe.network_isolated === true && networkProbe.launch_argv.includes("--unshare-pid") && networkProbe.launch_argv.includes("--proc"), "network probe is not replayable in a fresh PID/proc namespace");
invariant(networkProbe.launch_argv.some((value, index) => value === "--ro-bind-fd" && networkProbe.launch_argv[index + 1] === "4" && networkProbe.launch_argv[index + 2] === "/") && !networkProbe.launch_argv.includes("--ro-bind"), "network probe is not descriptor-bound to the minimal rootfs");
assertTopologyNeutralRecord(networkProbe, "network probe record");
validateOutputComparison(networkProbe);
validateIdentity(networkProbe.stdout, dependencyMap);
validateIdentity(networkProbe.stderr, dependencyMap);
invariant(networkProbe.stdout.size <= MAX_COMMAND_OUTPUT_BYTES && networkProbe.stderr.size <= MAX_COMMAND_OUTPUT_BYTES && networkProbe.launch_argv.some((value) => value.includes("ulimit -f 65536")), "network probe output capture is not bounded regular-file I/O");
for (const identity of networkProbe.tools) validateIdentity(identity, dependencyMap);
invariant(networkProbe.tools.some((identity) => identity.path === manifest.network_isolation.sandbox_tool.path && identity.sha256 === manifest.network_isolation.sandbox_tool.sha256), "network probe is not bound to bundled bwrap");
invariant(networkProbe.tools.some((identity) => identity.path === manifest.network_isolation.sandbox_launch_shell.path && identity.sha256 === manifest.network_isolation.sandbox_launch_shell.sha256), "network probe is not bound to bundled Bash launcher");
invariant(networkProbe.tools.some((identity) => identity.path === manifest.tools.actual_bun.path && identity.sha256 === manifest.tools.actual_bun.sha256), "network probe is not bound to the actual bundled Bun runtime");
const networkProbeOutput = `${readEvidenceFile(networkProbe.stdout.path).toString("utf8")}\n${readEvidenceFile(networkProbe.stderr.path).toString("utf8")}`;
invariant(networkProbe.exit_code === 1 && networkProbe.expected_exit === 1, "network namespace probe exit changed");
invariant(/(?:^|\n)namespace=net:\[[0-9]+\](?:\n|$)/.test(networkProbeOutput) && networkProbeOutput.includes("interfaces=lo") && networkProbeOutput.includes("routes=0") && networkProbeOutput.includes("socket_fds=0") && networkProbeOutput.includes("directory_fds=0") && networkProbeOutput.includes(`route_error=${manifest.network_isolation.route_probe_result}`), "raw network namespace probe is incomplete");
for (const [position, record] of allRecords.entries()) {
  assertTopologyNeutralRecord(record, `execution record ${position}`);
  invariant(record.index === position, `execution index mismatch at ${position}`);
  invariant(record.cwd === "/mnt" && record.network_isolated === true && record.replayable === true, `execution is not replayable/network isolated: ${record.label}`);
  invariant(Array.isArray(record.argv) && record.argv.length > 0 && record.argv.length <= 32, `invalid argv: ${record.label}`);
  invariant(record.launch_argv.includes("--unshare-user") && record.launch_argv.includes("--unshare-pid") && record.launch_argv.includes("--unshare-net") && record.launch_argv.includes("--proc") && record.launch_argv.includes("/proc") && record.launch_argv.includes("--dev") && record.launch_argv.includes("/dev") && record.launch_argv.includes("--tmpfs") && record.launch_argv.includes("/home") && record.launch_argv.includes("--clearenv"), `sandbox argv lacks fail-closed network/source isolation: ${record.label}`);
  invariant(record.launch_argv[0] === "tools/host/bash" && record.launch_argv.includes("tools/host/bwrap") && record.launch_argv.some((value, index) => value === "--ro-bind-fd" && record.launch_argv[index + 1] === "4" && record.launch_argv[index + 2] === "/") && !record.launch_argv.includes("--ro-bind"), `sandbox is not topology-neutral and descriptor-bound to the minimal rootfs: ${record.label}`);
  invariant(record.exit_code === record.expected_exit, `recorded exit mismatch: ${record.label}`);
  invariant(
    record.stdin === "ignore"
      && record.deadline_ms === SOURCE_REPLAY_POLICY[0]!.deadlineMs
      && record.output_limit_bytes === MAX_COMMAND_OUTPUT_BYTES
      && record.termination === "exit"
      && record.timed_out === false
      && record.output_limited === false,
    `execution deadline/input/termination mismatch: ${record.label}`,
  );
  invariant(record.authority_floor_occurrences === record.expected_authority_floor_occurrences, `authority floor mismatch: ${record.label}`);
  invariant(record.tripwire_absent === true, `tripwire reached: ${record.label}`);
  invariant(record.toolchain_inventory_sha256 === manifest.tools.inventory_sha256, `toolchain identity mismatch: ${record.label}`);
  invariant(record.env.HASNA_TODOS_STORAGE_MODE === "remote" && record.env.TODOS_STORAGE_MODE === "remote", `storage authority env missing: ${record.label}`);
  validateIdentity(record.stdout, dependencyMap);
  validateIdentity(record.stderr, dependencyMap);
  invariant(record.stdout.size <= MAX_COMMAND_OUTPUT_BYTES && record.stderr.size <= MAX_COMMAND_OUTPUT_BYTES && record.launch_argv.some((value) => value.includes("ulimit -f 65536")), `execution output capture is not bounded regular-file I/O: ${record.label}`);
  for (const identity of [...record.tools, ...record.preloads, ...record.inputs]) validateIdentity(identity, dependencyMap);
  invariant(record.tools.some((identity) => identity.path === manifest.network_isolation.sandbox_tool.path && identity.sha256 === manifest.network_isolation.sandbox_tool.sha256), `sandbox tool identity missing: ${record.label}`);
  invariant(record.tools.some((identity) => identity.path === manifest.network_isolation.sandbox_launch_shell.path && identity.sha256 === manifest.network_isolation.sandbox_launch_shell.sha256), `sandbox launch-shell identity missing: ${record.label}`);
  invariant(record.tools.some((identity) => identity.path === manifest.tools.actual_bun.path && identity.sha256 === manifest.tools.actual_bun.sha256), `actual Bun identity missing: ${record.label}`);
  const combined = `${readEvidenceFile(record.stdout.path).toString("utf8")}\n${readEvidenceFile(record.stderr.path).toString("utf8")}`;
  const actualAuthorityCount = combined.split("HOSTED_AUTHORITY_UNAVAILABLE").length - 1;
  invariant(actualAuthorityCount === record.authority_floor_occurrences, `raw authority floor count mismatch: ${record.label}`);
  invariant(!combined.includes("STAGE_A_IMPORT_TRIPWIRE") && !combined.includes("STAGE_A_ENTRYPOINT_TRIPWIRE"), `raw output contains tripwire: ${record.label}`);
  if (record.argv.includes("--preload")) invariant(record.preloads.length > 0 && record.env.STAGE_A_TRIPWIRE_IMPORTS === "1", `preload/tripwire binding missing: ${record.label}`);
  if (record.env.STAGE_A_TARGET) invariant(record.inputs.some((identity) => record.env.STAGE_A_TARGET.endsWith(identity.path.replace(/^(?:workspace|artifact)\//, ""))), `STAGE_A_TARGET input binding missing: ${record.label}`);
  validateOutputComparison(record);
}
for (const index of [22, 23, 24, 26, 27, 28]) {
  invariant(commandRecords[index]!.expected_authority_floor_occurrences === 1, `containment failure ${index} lacks exactly one authority floor`);
}
const requiredReplay = SOURCE_REPLAY_POLICY.map((_policy, index) => index);
invariant(JSON.stringify(manifest.required_replay_indices) === JSON.stringify(requiredReplay), "required replay index set does not cover verifier-owned source policy");
for (const index of requiredReplay) {
  invariant(commandRecords[index]?.replayable === true, `required claim is not replayable: ${index}`);
  invariant(commandRecords[index]?.label === SOURCE_REPLAY_POLICY[index]?.label, `required replay label changed at ${index}`);
}
invariant(manifest.generated_sdk.equal === true, "generated SDK equality claim missing");
validateIdentity(manifest.generated_sdk.before);
validateIdentity(manifest.generated_sdk.after);
invariant(manifest.generated_sdk.before.sha256 === manifest.generated_sdk.after.sha256, "generated SDK before/after mismatch");
invariant(manifest.declaration.command_index === 2, "declaration command index mismatch");
validateIdentity(manifest.declaration.tool, dependencyMap);
validateIdentity(manifest.declaration.package, dependencyMap);
invariant(manifest.declaration.dependency_inventory_sha256 === manifest.dependencies.inventory.sha256, "declaration dependency identity mismatch");

validateIdentity(manifest.artifact.archive);
const artifactEntries = readTar(evidencePath(manifest.artifact.archive.path), false);
equalInventory(artifactEntries.map(({ bytes: _bytes, ...entry }) => entry), manifest.artifact.inventory, "artifact archive");
invariant(manifest.artifact.special_member_count === 0 && manifest.artifact.hardlink_member_count === 0, "artifact archive special-member claim changed");
invariant(manifest.artifact.extraction_inventory_equal === true && manifest.artifact.extraction_has_source === false && manifest.artifact.extraction_has_node_modules === false, "artifact extraction isolation claim is incomplete");
invariant(Array.isArray(manifest.artifact.datastore_files) && manifest.artifact.datastore_files.length === 0, "artifact datastore inventory is not empty");
for (const entry of artifactEntries) {
  invariant(!entry.path.startsWith("src/") && !entry.path.includes("node_modules"), `artifact contains adjacent source/dependencies: ${entry.path}`);
  invariant(!/(?:\.db|\.sqlite)(?:-(?:wal|shm))?$|-(?:wal|shm)$/.test(entry.path), `artifact contains datastore file: ${entry.path}`);
  if (entry.type === "file") {
    const bytes = Buffer.from(entry.bytes!);
    invariant(!bytes.subarray(0, 16).equals(Buffer.from("SQLite format 3\0")), `artifact contains renamed SQLite content: ${entry.path}`);
    invariant(bytes.length < 4 || (bytes.readUInt32BE(0) !== 0x377f0682 && bytes.readUInt32BE(0) !== 0x377f0683), `artifact contains renamed SQLite WAL content: ${entry.path}`);
  }
}

function validateOutputComparison(record: CommandRecord): void {
  invariant(
    record.output_comparison?.mode === "exact-bytes"
      ? Array.isArray(record.output_comparison.rules) && record.output_comparison.rules.length === 0
      : record.output_comparison?.mode === "normalized-text-v1"
        && Array.isArray(record.output_comparison.rules)
        && record.output_comparison.rules.length > 0
        && record.output_comparison.rules.every((rule) => rule === "duration-tokens" || rule === "namespace-inode"),
    `invalid output comparison contract: ${record.label}`,
  );
}

function normalizeRecordedOutput(bytes: Buffer, rules: CommandRecord["output_comparison"]["rules"]): string {
  let value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  invariant(new Set(rules).size === rules.length, "output normalization rules contain duplicates");
  for (const rule of rules) {
    if (rule === "duration-tokens") value = value.replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "<DURATION>");
    else if (rule === "namespace-inode") value = value.replace(/net:\[[0-9]+\]/g, "net:[NAMESPACE]");
    else invariant(false, `unknown output normalization rule: ${String(rule)}`);
  }
  return value;
}

async function replayRecord(
  record: CommandRecord,
  policyValue: CanonicalCommandPolicy,
  hostWorkspace: string,
): Promise<void> {
  assertCommandRecordMatchesPolicy(record, policyValue, `replay ${policyValue.label}`);
  validateOutputComparison(record);
  const result = await runSandbox(hostWorkspace, { ...policyValue.env }, [...policyValue.argv]);
  invariant(result.status === policyValue.expectedExit, `replay exit mismatch: ${policyValue.label}: ${result.stderr.toString("utf8").slice(0, 1_000)}`);
  const actualStdout = result.stdout;
  const actualStderr = result.stderr;
  const expectedStdout = readEvidenceFile(record.stdout.path);
  const expectedStderr = readEvidenceFile(record.stderr.path);
  if (policyValue.outputComparisonRules.length === 0) {
    invariant(Buffer.compare(actualStdout, expectedStdout) === 0, `replay stdout bytes differ: ${policyValue.label}`);
    invariant(Buffer.compare(actualStderr, expectedStderr) === 0, `replay stderr bytes differ: ${policyValue.label}`);
  } else {
    invariant(normalizeRecordedOutput(actualStdout, [...policyValue.outputComparisonRules]) === normalizeRecordedOutput(expectedStdout, [...policyValue.outputComparisonRules]), `normalized replay stdout differs: ${policyValue.label}`);
    invariant(normalizeRecordedOutput(actualStderr, [...policyValue.outputComparisonRules]) === normalizeRecordedOutput(expectedStderr, [...policyValue.outputComparisonRules]), `normalized replay stderr differs: ${policyValue.label}`);
  }
  const combined = `${actualStdout.toString("utf8")}\n${actualStderr.toString("utf8")}`;
  invariant(combined.split("HOSTED_AUTHORITY_UNAVAILABLE").length - 1 === policyValue.expectedAuthorityFloor, `replay authority floor mismatch: ${policyValue.label}`);
  invariant(!combined.includes("STAGE_A_IMPORT_TRIPWIRE") && !combined.includes("STAGE_A_ENTRYPOINT_TRIPWIRE"), `replay reached tripwire: ${policyValue.label}`);
}

withEvidenceDirectory("runtime-home", (path) => invariant(regularFileCount(path) === 0 && inventoryTree(path).length === 0, "runtime-home contains files or cache/runtime entries before verifier smokes"));
await replayRecord(networkProbe, NETWORK_PROBE_POLICY, verifierRuntimeHome);
{
  const extractionRoot = mkdtempSync(join(tmpdir(), "todos-stage-a-artifact-"));
  try {
    extractTar(artifactEntries, extractionRoot);
    invariant(!existsSync(join(extractionRoot, "src")) && !existsSync(join(extractionRoot, "node_modules")), "extracted artifact has adjacent source/node_modules");
    equalInventory(inventoryTree(extractionRoot), manifest.artifact.inventory, "extracted artifact");
    for (const [index, record] of artifactCommandRecords.entries()) {
      await replayRecord(record, ARTIFACT_REPLAY_POLICY[index]!, extractionRoot);
    }
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true });
  }
}

{
  const sourceReplayRoot = mkdtempSync(join(tmpdir(), "todos-stage-a-source-replay-"));
  try {
    withEvidenceDirectory("workspace", (_path, descriptor) => copyDescriptorAnchoredTree(descriptor, sourceReplayRoot));
    rmSync(join(sourceReplayRoot, "dist"), { recursive: true, force: true });
    extractTar(dependencyEntries, sourceReplayRoot);
    const sdkBefore = sha256File(join(sourceReplayRoot, "src", "sdk", "v1.generated.ts"));
    for (const index of requiredReplay) {
      await replayRecord(commandRecords[index]!, SOURCE_REPLAY_POLICY[index]!, sourceReplayRoot);
    }
    const sdkAfter = sha256File(join(sourceReplayRoot, "src", "sdk", "v1.generated.ts"));
    invariant(sdkBefore === sdkAfter, "source replay changed generated SDK");
    const replayInventory = inventoryTree(sourceReplayRoot, (path) => path === "dist" || path.startsWith("dist/")
      || path === "node_modules" || path.startsWith("node_modules/")
      || path === "dashboard/node_modules" || path.startsWith("dashboard/node_modules/"));
    equalInventory(replayInventory, sourceBefore, "source replay");
  } finally {
    rmSync(sourceReplayRoot, { recursive: true, force: true });
  }
}

withEvidenceDirectory("runtime-home", (path) => invariant(regularFileCount(path) === 0 && inventoryTree(path).length === 0, "runtime-home contains files or cache/runtime entries after verifier smokes"));
invariant(regularFileCount(verifierRuntimeHome) === 0 && inventoryTree(verifierRuntimeHome).length === 0, "verifier replay runtime home contains files or cache entries");
invariant(manifest.runtime_home.recursive_regular_file_count === 0 && manifest.runtime_home.regular_files.length === 0 && manifest.runtime_home.recursive_entry_count === 0 && manifest.runtime_home.entries.length === 0, "runtime-home manifest claim is not empty");
validateIdentity(manifest.verifier);
invariant(manifest.verifier.path === "verifier/verify-stage-a-evidence.js", "standalone verifier bundle path changed");
invariant(
  Array.isArray(manifest.verifier_sources)
    && JSON.stringify(manifest.verifier_sources.map((identity: FileIdentity) => identity.path)) === JSON.stringify([
      "verifier/verify-stage-a-evidence.ts",
      "verifier/stage-a-verifier-policy.ts",
      "verifier/stage-a-process.ts",
      "verifier/stage-a-candidate-identity.ts",
    ]),
  "standalone verifier source closure changed",
);
for (const identity of manifest.verifier_sources as FileIdentity[]) validateIdentity(identity);

process.stdout.write(`${JSON.stringify({
  verified: true,
  schema_version: manifest.schema_version,
  canonical_source_candidate_digest: manifest.canonical_source_candidate_digest,
  containment_smokes: commandRecords.length,
  artifact_smokes: artifactCommandRecords.length,
  replayed_source_claims: requiredReplay.length,
  runtime_home_regular_files: 0,
})}\n`);
