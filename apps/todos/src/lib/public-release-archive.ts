import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  validatePackedFileContents,
  validatePackedTextSurfaces,
  type ReleaseGateFailure,
  type TextFile,
} from "./public-release-gate.js";
import { secretScanByteProjections } from "./secret-redaction.js";

const TAR_BLOCK_BYTES = 512;
const DEFAULT_MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_REGULAR_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 100_000;

export interface PackedArchiveLimits {
  maxCompressedBytes?: number;
  maxExpandedBytes?: number;
  maxFileBytes?: number;
  maxRegularBytes?: number;
  maxEntries?: number;
}

export interface PackedRegularFile {
  path: string;
  bytes: Uint8Array;
  binary: boolean;
}

function fail(message: string): never {
  throw new Error(message);
}

function boundedPositive(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) fail(`${name} must be a positive safe integer`);
  return result;
}

function fieldText(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  const view = end >= 0 ? bytes.subarray(0, end) : bytes;
  return new TextDecoder("utf-8", { fatal: true }).decode(view);
}

function tarNumber(bytes: Uint8Array, label: string): number {
  if ((bytes[0]! & 0x80) !== 0) {
    if ((bytes[0]! & 0x40) !== 0) fail(`${label} uses a negative base-256 value`);
    let value = BigInt(bytes[0]! & 0x3f);
    for (const byte of bytes.subarray(1)) value = (value << 8n) | BigInt(byte);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${label} exceeds the safe integer range`);
    return Number(value);
  }
  const raw = fieldText(bytes).trim();
  if (raw === "") return 0;
  if (!/^[0-7]+$/.test(raw)) fail(`${label} is not a valid octal value`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value)) fail(`${label} exceeds the safe integer range`);
  return value;
}

function verifyHeaderChecksum(header: Uint8Array): void {
  const expected = tarNumber(header.subarray(148, 156), "tar checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]!;
  }
  if (actual !== expected) fail(`tar header checksum mismatch: expected ${expected}, received ${actual}`);
}

function headerPath(header: Uint8Array): string {
  const name = fieldText(header.subarray(0, 100));
  const prefix = fieldText(header.subarray(345, 500));
  return prefix ? `${prefix}/${name}` : name;
}

function canonicalArchivePath(rawPath: string, directory: boolean): string {
  const path = directory ? rawPath.replace(/\/+$/, "") : rawPath;
  if (!path || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    fail(`unsafe archive path: ${JSON.stringify(rawPath)}`);
  }
  const normalized = posix.normalize(path);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized !== path) {
    fail(`non-canonical archive path: ${JSON.stringify(rawPath)}`);
  }
  return normalized;
}

function parsePax(bytes: Uint8Array): Map<string, string> {
  const values = new Map<string, string>();
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space < 0) fail("malformed PAX record length");
    const lengthText = new TextDecoder().decode(bytes.subarray(offset, space));
    if (!/^[1-9][0-9]*$/.test(lengthText)) fail("malformed PAX record length");
    const length = Number.parseInt(lengthText, 10);
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > bytes.length) {
      fail("PAX record exceeds its header payload");
    }
    const record = bytes.subarray(space + 1, offset + length);
    if (record.at(-1) !== 0x0a) fail("PAX record is not newline terminated");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(record.subarray(0, -1));
    const separator = text.indexOf("=");
    if (separator <= 0) fail("malformed PAX key/value record");
    values.set(text.slice(0, separator), text.slice(separator + 1));
    offset += length;
  }
  return values;
}

function mergePax(target: Map<string, string>, source: Map<string, string>): void {
  for (const [key, value] of source) target.set(key, value);
}

function probablyBinary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return true;
  }
  let controls = 0;
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controls += 1;
  }
  // A single embedded control byte is enough to split a credential-shaped
  // ASCII sequence. Do not let padding dilute that byte below a percentage
  // heuristic and suppress the byte-preserving projections below.
  return controls > 0;
}

export function readPackedRegularFiles(
  tarball: string,
  limits: PackedArchiveLimits = {},
): PackedRegularFile[] {
  const maxCompressedBytes = boundedPositive(limits.maxCompressedBytes, DEFAULT_MAX_COMPRESSED_BYTES, "maxCompressedBytes");
  const maxExpandedBytes = boundedPositive(limits.maxExpandedBytes, DEFAULT_MAX_EXPANDED_BYTES, "maxExpandedBytes");
  const maxFileBytes = boundedPositive(limits.maxFileBytes, DEFAULT_MAX_FILE_BYTES, "maxFileBytes");
  const maxRegularBytes = boundedPositive(limits.maxRegularBytes, DEFAULT_MAX_REGULAR_BYTES, "maxRegularBytes");
  const maxEntries = boundedPositive(limits.maxEntries, DEFAULT_MAX_ENTRIES, "maxEntries");
  let descriptor: number | undefined;
  let packed: Buffer;
  try {
    descriptor = openSync(tarball, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor);
    if (!before.isFile()) fail("packed archive must be a regular file, not a symlink or special file");
    if (before.size > maxCompressedBytes) fail(`packed archive exceeds ${maxCompressedBytes} compressed bytes`);
    packed = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || packed.byteLength !== after.size) {
      fail("packed archive changed while it was read");
    }
  } catch (error) {
    if (error instanceof Error && /packed archive/.test(error.message)) throw error;
    fail(`packed archive must be a readable regular file without symlink traversal: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  let archive: Uint8Array;
  if (packed[0] === 0x1f && packed[1] === 0x8b) {
    archive = gunzipSync(packed, { maxOutputLength: maxExpandedBytes });
  } else {
    archive = packed;
  }
  if (archive.byteLength > maxExpandedBytes) fail(`packed archive exceeds ${maxExpandedBytes} expanded bytes`);
  if (archive.byteLength % TAR_BLOCK_BYTES !== 0) fail("tar archive length is not block aligned");

  const files: PackedRegularFile[] = [];
  const paths = new Map<string, boolean>();
  const pathsWithDescendants = new Set<string>();
  const globalPax = new Map<string, string>();
  let nextPax = new Map<string, string>();
  let nextLongPath: string | undefined;
  let totalRegularBytes = 0;
  let offset = 0;
  let zeroBlocks = 0;
  let entryCount = 0;

  while (offset < archive.byteLength) {
    const header = archive.subarray(offset, offset + TAR_BLOCK_BYTES);
    offset += TAR_BLOCK_BYTES;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks !== 0) fail("non-zero tar header follows an end marker");
    verifyHeaderChecksum(header);
    entryCount += 1;
    if (entryCount > maxEntries) fail(`packed archive exceeds ${maxEntries} entries`);

    const headerSize = tarNumber(header.subarray(124, 136), "tar entry size");
    const type = String.fromCharCode(header[156] ?? 0);
    const hasPendingPathMetadata = nextPax.size > 0 || nextLongPath !== undefined;
    const pax = new Map(globalPax);
    mergePax(pax, nextPax);
    nextPax = new Map();
    const metadataEntry = type === "x" || type === "g" || type === "L";
    if (metadataEntry && hasPendingPathMetadata) fail("stacked tar path metadata is not supported");
    const paxSize = metadataEntry ? undefined : pax.get("size");
    if (paxSize !== undefined && !/^(?:0|[1-9][0-9]*)$/.test(paxSize)) fail("PAX size is not canonical decimal");
    const effectiveSize = paxSize === undefined ? headerSize : Number(paxSize);
    if (!Number.isSafeInteger(effectiveSize) || effectiveSize < 0) fail("PAX size is not a non-negative safe integer");
    const paddedSize = Math.ceil(effectiveSize / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
    if (effectiveSize > maxFileBytes) fail(`tar entry exceeds ${maxFileBytes} bytes`);
    if (offset + paddedSize > archive.byteLength) fail("tar entry payload is truncated");
    const payload = archive.subarray(offset, offset + effectiveSize);
    offset += paddedSize;

    if (type === "x" || type === "g") {
      const parsed = parsePax(payload);
      if (type === "g") mergePax(globalPax, parsed);
      else nextPax = parsed;
      continue;
    }
    if (type === "L") {
      nextLongPath = fieldText(payload).replace(/\n$/, "");
      continue;
    }

    const rawPath = pax.get("path") ?? nextLongPath ?? headerPath(header);
    nextLongPath = undefined;
    const directory = type === "5";
    const path = canonicalArchivePath(rawPath, directory);
    if (paths.has(path)) fail(`duplicate archive path: ${path}`);
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const ancestor = parts.slice(0, index).join("/");
      if (paths.get(ancestor) === false) fail(`archive path traverses regular file ${ancestor}: ${path}`);
      pathsWithDescendants.add(ancestor);
    }
    if (!directory && pathsWithDescendants.has(path)) {
      fail(`regular archive file shadows an existing child path: ${path}`);
    }
    paths.set(path, directory);
    if (directory) {
      if (effectiveSize !== 0) fail(`directory entry has a payload: ${path}`);
      continue;
    }
    if (type !== "0" && type !== "\0") fail(`unsupported special archive entry ${JSON.stringify(type)} at ${path}`);
    totalRegularBytes += effectiveSize;
    if (totalRegularBytes > maxRegularBytes) fail(`regular files exceed ${maxRegularBytes} total bytes`);
    files.push({ path, bytes: payload.slice(), binary: probablyBinary(payload) });
  }

  if (zeroBlocks < 2) fail("tar archive is missing its two-block end marker");
  if (nextPax.size > 0 || nextLongPath !== undefined) fail("orphaned tar path metadata at end of archive");
  for (; offset < archive.byteLength; offset += 1) {
    if (archive[offset] !== 0) fail("non-zero bytes follow the tar end marker");
  }
  return files;
}

function uniqueFailures(failures: ReleaseGateFailure[]): ReleaseGateFailure[] {
  return [...new Map(failures.map((failure) => [`${failure.check}\0${failure.message}`, failure])).values()];
}

export function scanPackedArchive(tarball: string, limits: PackedArchiveLimits = {}): ReleaseGateFailure[] {
  let files: PackedRegularFile[];
  try {
    files = readPackedRegularFiles(tarball, limits);
  } catch (error) {
    return [{
      check: "pack-archive",
      message: error instanceof Error ? error.message : String(error),
    }];
  }

  const utf8Files: TextFile[] = files.map((file) => ({
    path: file.path,
    text: new TextDecoder("utf-8").decode(file.bytes),
  }));
  const failures = validatePackedTextSurfaces(utf8Files);
  for (const file of files) {
    // Byte projections are a security scan, not a format guess: run them for
    // every regular member. The `binary` classification remains diagnostic,
    // but no heuristic can suppress scanning by padding or renaming a file.
    failures.push(...validatePackedFileContents(
      secretScanByteProjections(file.bytes).map((projection) => ({
        path: `${file.path}#${projection.name}`,
        text: projection.text,
      })),
    ));
  }
  return uniqueFailures(failures);
}
