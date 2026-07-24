import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGE_A_CANDIDATE_IDENTITY_VERSION = "todos-stage-a-candidate-identity-v6";
export const STAGE_A_CANDIDATE_REGULAR_FILE_TYPE = "regular-file" as const;
export const STAGE_A_CANDIDATE_ABSENT_TYPE = "absent" as const;
export const MAX_CANDIDATE_PATH_BYTES = 4_096;
export const MAX_CANDIDATE_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_CANDIDATE_TRACKED_FILES = 200_000;
export const MAX_CANDIDATE_UNTRACKED_FILES = 200_000;

const VERSION_MARKER = Buffer.from(`${STAGE_A_CANDIDATE_IDENTITY_VERSION}\0`, "ascii");
const TRACKED_FILE_MARKER = Buffer.from("tracked-file\0", "ascii");
const TRACKED_NONE_MARKER = Buffer.from("tracked-none\0", "ascii");
const UNTRACKED_FILE_MARKER = Buffer.from("untracked-file\0", "ascii");
const CLOSURE_VERSION_MARKER = Buffer.from("todos-stage-a-filesystem-closure-v2\0", "ascii");
const CLOSURE_ROOT_MARKER = Buffer.from("root\0", "ascii");
const CLOSURE_VISIBLE_MARKER = Buffer.from("visible\0", "ascii");
const CLOSURE_IGNORED_MARKER = Buffer.from("ignored\0", "ascii");
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export interface CanonicalRegularFileIdentity {
  path: string;
  type: typeof STAGE_A_CANDIDATE_REGULAR_FILE_TYPE;
  mode: string;
  size: number;
  sha256: string;
}

export interface CanonicalAbsentIdentity {
  path: string;
  type: typeof STAGE_A_CANDIDATE_ABSENT_TYPE;
}

export type CanonicalTrackedIdentity = CanonicalRegularFileIdentity | CanonicalAbsentIdentity;
export interface CanonicalUntrackedIdentity extends CanonicalRegularFileIdentity {}

export interface CanonicalCandidate {
  version: typeof STAGE_A_CANDIDATE_IDENTITY_VERSION;
  trackedDiff: Buffer;
  sortedTrackedPaths: string[];
  tracked: CanonicalTrackedIdentity[];
  trackedRecords: Buffer;
  sortedUntrackedPaths: string[];
  untracked: CanonicalUntrackedIdentity[];
  untrackedRecords: Buffer;
  input: Buffer;
  digest: string;
}

interface StableStatIdentity {
  dev: bigint;
  ino: bigint;
  mode: bigint;
  nlink: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

interface CandidateGitSnapshot {
  trackedDiff: Buffer;
  rawTrackedPaths: Buffer;
  rawUntrackedPaths: Buffer;
  rawIgnoredPaths: Buffer;
  sortedTrackedPaths: string[];
  sortedUntrackedPaths: string[];
  ignoredPaths: string[];
  filesystemClosure: Buffer;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function uint32(value: number): Buffer {
  invariant(Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff, "candidate uint32 is out of range");
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function uint64(value: number): Buffer {
  invariant(Number.isSafeInteger(value) && value >= 0, "candidate uint64 is out of range");
  return uint64Big(BigInt(value));
}

function uint64Big(value: bigint): Buffer {
  invariant(value >= 0n && value <= 0xffff_ffff_ffff_ffffn, "candidate uint64 bigint is out of range");
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeBigUInt64BE(value);
  return bytes;
}

function stableStat(stat: ReturnType<typeof fstatSync> | ReturnType<typeof lstatSync>): StableStatIdentity {
  const value = stat as typeof stat & { mtimeNs?: bigint; ctimeNs?: bigint };
  return {
    dev: BigInt(value.dev),
    ino: BigInt(value.ino),
    mode: BigInt(value.mode),
    nlink: BigInt(value.nlink),
    size: BigInt(value.size),
    mtimeNs: value.mtimeNs ?? BigInt(Math.trunc(value.mtimeMs * 1_000_000)),
    ctimeNs: value.ctimeNs ?? BigInt(Math.trunc(value.ctimeMs * 1_000_000)),
  };
}

function equalStableStat(left: StableStatIdentity, right: StableStatIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function canonicalStatRecord(stat: StableStatIdentity): Buffer {
  return Buffer.concat([
    uint64Big(stat.dev),
    uint64Big(stat.ino),
    uint64Big(stat.mode),
    uint64Big(stat.nlink),
    uint64Big(stat.size),
    uint64Big(stat.mtimeNs),
    uint64Big(stat.ctimeNs),
  ]);
}

export function normalizedCandidateMode(mode: number | bigint): string {
  const permissions = Number(BigInt(mode) & 0o7777n);
  return permissions.toString(8).padStart(4, "0");
}

export function safeCandidatePath(path: string): string[] {
  invariant(path.length > 0 && !isAbsolute(path), "unsafe candidate path: expected a non-empty relative path");
  invariant(!path.includes("\0") && !path.includes("\\"), "unsafe candidate path: NUL and backslash are forbidden");
  invariant(path.normalize("NFC") === path, "unsafe candidate path: path must be NFC-normalized");
  const encoded = Buffer.from(path, "utf8");
  invariant(encoded.byteLength <= MAX_CANDIDATE_PATH_BYTES, "unsafe candidate path: path exceeds the byte bound");
  invariant(!encoded.some((byte) => byte < 0x20 || byte === 0x7f), "unsafe candidate path: control bytes are forbidden");
  const parts = path.split("/");
  invariant(
    parts.every((part) => part.length > 0 && part !== "." && part !== ".." && Buffer.byteLength(part) <= 255),
    "unsafe candidate path component",
  );
  return parts;
}

function decodeCanonicalPath(pathBytes: Uint8Array): string {
  const bytes = Buffer.from(pathBytes);
  const path = STRICT_UTF8.decode(bytes);
  safeCandidatePath(path);
  invariant(Buffer.compare(Buffer.from(path, "utf8"), bytes) === 0, "candidate path is not canonical UTF-8");
  return path;
}

function openAnchoredParent(rootDescriptor: number, parts: readonly string[]): { descriptor: number; owned: boolean } {
  let descriptor = rootDescriptor;
  try {
    for (const part of parts.slice(0, -1)) {
      const next = openSync(
        `/proc/self/fd/${descriptor}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      if (descriptor !== rootDescriptor) closeSync(descriptor);
      descriptor = next;
    }
    return { descriptor, owned: descriptor !== rootDescriptor };
  } catch (error) {
    if (descriptor !== rootDescriptor) closeSync(descriptor);
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function anchoredPathExists(rootDescriptor: number, path: string): boolean {
  const parts = safeCandidatePath(path);
  let parent: { descriptor: number; owned: boolean } | undefined;
  try {
    try {
      parent = openAnchoredParent(rootDescriptor, parts);
      lstatSync(`/proc/self/fd/${parent.descriptor}/${parts.at(-1)!}`, { bigint: true });
      return true;
    } catch (error) {
      if (isMissingPathError(error)) return false;
      throw error;
    }
  } finally {
    if (parent?.owned) closeSync(parent.descriptor);
  }
}

function readCanonicalRegularFileIdentity(
  rootDescriptor: number,
  path: string,
  scope: "tracked" | "untracked",
  maxBytes = MAX_CANDIDATE_FILE_BYTES,
): { identity: CanonicalRegularFileIdentity; bytes: Buffer } {
  const parts = safeCandidatePath(path);
  invariant(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= MAX_CANDIDATE_FILE_BYTES, "invalid candidate file bound");
  const initialParent = openAnchoredParent(rootDescriptor, parts);
  let fileDescriptor: number | undefined;
  try {
    const anchoredPath = `/proc/self/fd/${initialParent.descriptor}/${parts.at(-1)!}`;
    const lexicalBeforeRaw = lstatSync(anchoredPath, { bigint: true });
    invariant(
      lexicalBeforeRaw.isFile() && !lexicalBeforeRaw.isSymbolicLink(),
      `${scope} candidate input is not a regular file: ${path}`,
    );
    const lexicalBefore = stableStat(lexicalBeforeRaw as unknown as ReturnType<typeof lstatSync>);
    invariant(lexicalBefore.nlink === 1n, `${scope} candidate input has a multi-link identity: ${path}`);
    invariant(lexicalBefore.size <= BigInt(maxBytes), `${scope} candidate input exceeds its byte bound: ${path}`);

    try {
      fileDescriptor = openSync(anchoredPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new Error(`${scope} candidate input is not an openable regular file: ${path}`, { cause: error });
    }
    const descriptorBeforeRaw = fstatSync(fileDescriptor, { bigint: true });
    invariant(descriptorBeforeRaw.isFile(), `${scope} candidate input is not a regular file: ${path}`);
    const descriptorBefore = stableStat(descriptorBeforeRaw as unknown as ReturnType<typeof fstatSync>);
    invariant(descriptorBefore.nlink === 1n, `${scope} candidate input has a multi-link identity: ${path}`);
    invariant(equalStableStat(lexicalBefore, descriptorBefore), `${scope} candidate identity changed before read: ${path}`);

    const bytes = readFileSync(fileDescriptor);
    const descriptorAfterRaw = fstatSync(fileDescriptor, { bigint: true });
    const descriptorAfter = stableStat(descriptorAfterRaw as unknown as ReturnType<typeof fstatSync>);
    invariant(
      descriptorAfterRaw.isFile()
        && descriptorAfter.nlink === 1n
        && bytes.byteLength === Number(descriptorAfter.size)
        && equalStableStat(descriptorBefore, descriptorAfter),
      `${scope} candidate identity changed while read: ${path}`,
    );

    const finalParent = openAnchoredParent(rootDescriptor, parts);
    try {
      const initialParentIdentity = stableStat(fstatSync(initialParent.descriptor, { bigint: true }) as unknown as ReturnType<typeof fstatSync>);
      const finalParentIdentity = stableStat(fstatSync(finalParent.descriptor, { bigint: true }) as unknown as ReturnType<typeof fstatSync>);
      invariant(equalStableStat(initialParentIdentity, finalParentIdentity), `${scope} candidate parent identity changed while read: ${path}`);
      const lexicalAfterRaw = lstatSync(
        `/proc/self/fd/${finalParent.descriptor}/${parts.at(-1)!}`,
        { bigint: true },
      );
      const lexicalAfter = stableStat(lexicalAfterRaw as unknown as ReturnType<typeof lstatSync>);
      invariant(
        lexicalAfterRaw.isFile()
          && !lexicalAfterRaw.isSymbolicLink()
          && lexicalAfter.nlink === 1n
          && equalStableStat(descriptorAfter, lexicalAfter),
        `${scope} candidate identity changed while read: ${path}`,
      );
    } finally {
      if (finalParent.owned) closeSync(finalParent.descriptor);
    }

    return {
      identity: {
        path,
        type: STAGE_A_CANDIDATE_REGULAR_FILE_TYPE,
        mode: normalizedCandidateMode(descriptorBefore.mode),
        size: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      },
      bytes,
    };
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
    if (initialParent.owned) closeSync(initialParent.descriptor);
  }
}

export function readCanonicalTrackedIdentity(
  rootDescriptor: number,
  path: string,
  maxBytes = MAX_CANDIDATE_FILE_BYTES,
): { identity: CanonicalTrackedIdentity; bytes?: Buffer } {
  if (!anchoredPathExists(rootDescriptor, path)) {
    return { identity: { path, type: STAGE_A_CANDIDATE_ABSENT_TYPE } };
  }
  return readCanonicalRegularFileIdentity(rootDescriptor, path, "tracked", maxBytes);
}

export function readCanonicalUntrackedIdentity(
  rootDescriptor: number,
  path: string,
  maxBytes = MAX_CANDIDATE_FILE_BYTES,
): { identity: CanonicalUntrackedIdentity; bytes: Buffer } {
  return readCanonicalRegularFileIdentity(rootDescriptor, path, "untracked", maxBytes);
}

function validateRegularIdentity(identity: CanonicalRegularFileIdentity): void {
  safeCandidatePath(identity.path);
  invariant(identity.type === STAGE_A_CANDIDATE_REGULAR_FILE_TYPE, "candidate identity is not a regular-file record");
  invariant(/^[0-7]{4}$/.test(identity.mode), `candidate identity has an invalid normalized mode: ${identity.path}`);
  invariant(
    Number.isSafeInteger(identity.size) && identity.size >= 0 && identity.size <= MAX_CANDIDATE_FILE_BYTES,
    `candidate identity has an invalid size: ${identity.path}`,
  );
  invariant(/^[a-f0-9]{64}$/.test(identity.sha256), `candidate identity has an invalid digest: ${identity.path}`);
}

function appendPathRecord(chunks: Buffer[], path: string): void {
  const pathBytes = Buffer.from(path, "utf8");
  chunks.push(uint32(pathBytes.byteLength), pathBytes);
}

function assertStrictIdentityOrder(
  identity: { path: string },
  previous: Buffer | undefined,
  seen: Set<string>,
): Buffer {
  safeCandidatePath(identity.path);
  invariant(!seen.has(identity.path), `duplicate candidate path: ${identity.path}`);
  seen.add(identity.path);
  const pathBytes = Buffer.from(identity.path, "utf8");
  if (previous) invariant(Buffer.compare(previous, pathBytes) < 0, "candidate paths are not in strict byte order");
  return pathBytes;
}

export function canonicalTrackedRecords(identities: readonly CanonicalTrackedIdentity[]): Buffer {
  invariant(identities.length <= MAX_CANDIDATE_TRACKED_FILES, "candidate tracked record count exceeds its bound");
  const chunks: Buffer[] = [];
  let previous: Buffer | undefined;
  const seen = new Set<string>();
  for (const identity of identities) {
    previous = assertStrictIdentityOrder(identity, previous, seen);
    if (identity.type === STAGE_A_CANDIDATE_ABSENT_TYPE) {
      chunks.push(TRACKED_NONE_MARKER);
      appendPathRecord(chunks, identity.path);
      continue;
    }
    validateRegularIdentity(identity);
    chunks.push(TRACKED_FILE_MARKER);
    appendPathRecord(chunks, identity.path);
    chunks.push(Buffer.from(identity.mode, "ascii"), uint64(identity.size), Buffer.from(identity.sha256, "hex"));
  }
  return Buffer.concat(chunks);
}

export function canonicalUntrackedRecords(identities: readonly CanonicalUntrackedIdentity[]): Buffer {
  invariant(identities.length <= MAX_CANDIDATE_UNTRACKED_FILES, "candidate untracked record count exceeds its bound");
  const chunks: Buffer[] = [];
  let previous: Buffer | undefined;
  const seen = new Set<string>();
  for (const identity of identities) {
    validateRegularIdentity(identity);
    previous = assertStrictIdentityOrder(identity, previous, seen);
    chunks.push(UNTRACKED_FILE_MARKER);
    appendPathRecord(chunks, identity.path);
    chunks.push(Buffer.from(identity.mode, "ascii"), uint64(identity.size), Buffer.from(identity.sha256, "hex"));
  }
  return Buffer.concat(chunks);
}

export function canonicalCandidateInput(
  trackedDiff: Uint8Array,
  tracked: readonly CanonicalTrackedIdentity[],
  untracked: readonly CanonicalUntrackedIdentity[],
): { input: Buffer; trackedRecords: Buffer; untrackedRecords: Buffer } {
  const diff = Buffer.from(trackedDiff);
  const trackedRecords = canonicalTrackedRecords(tracked);
  const untrackedRecords = canonicalUntrackedRecords(untracked);
  return {
    input: Buffer.concat([
      VERSION_MARKER,
      uint64(diff.byteLength),
      diff,
      uint32(tracked.length),
      trackedRecords,
      uint32(untracked.length),
      untrackedRecords,
    ]),
    trackedRecords,
    untrackedRecords,
  };
}

export function decodeCanonicalCandidateInput(input: Uint8Array): {
  version: typeof STAGE_A_CANDIDATE_IDENTITY_VERSION;
  trackedDiff: Buffer;
  tracked: CanonicalTrackedIdentity[];
  trackedRecords: Buffer;
  untracked: CanonicalUntrackedIdentity[];
  untrackedRecords: Buffer;
} {
  const bytes = Buffer.from(input);
  let offset = 0;
  const take = (length: number, label: string): Buffer => {
    invariant(Number.isSafeInteger(length) && length >= 0 && offset + length <= bytes.byteLength, `truncated canonical candidate ${label}`);
    const value = bytes.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const takePath = (): string => {
    const pathLength = take(4, "path length").readUInt32BE();
    invariant(pathLength > 0 && pathLength <= MAX_CANDIDATE_PATH_BYTES, "canonical candidate path length is invalid");
    return decodeCanonicalPath(take(pathLength, "path"));
  };
  const takeRegular = (path: string): CanonicalRegularFileIdentity => {
    const mode = take(4, "mode").toString("ascii");
    const sizeBig = take(8, "size").readBigUInt64BE();
    invariant(sizeBig <= BigInt(Number.MAX_SAFE_INTEGER), "canonical candidate size exceeds the safe integer range");
    const sha256 = take(32, "digest").toString("hex");
    return { path, type: STAGE_A_CANDIDATE_REGULAR_FILE_TYPE, mode, size: Number(sizeBig), sha256 };
  };

  invariant(Buffer.compare(take(VERSION_MARKER.byteLength, "version marker"), VERSION_MARKER) === 0, "unsupported canonical candidate version marker");
  const trackedLength = Number(take(8, "tracked length").readBigUInt64BE());
  invariant(Number.isSafeInteger(trackedLength), "canonical candidate tracked diff is too large");
  const trackedDiff = Buffer.from(take(trackedLength, "tracked diff"));

  const trackedCount = take(4, "tracked record count").readUInt32BE();
  invariant(trackedCount <= MAX_CANDIDATE_TRACKED_FILES, "canonical candidate tracked record count exceeds its bound");
  const trackedRecordsOffset = offset;
  const tracked: CanonicalTrackedIdentity[] = [];
  for (let index = 0; index < trackedCount; index += 1) {
    const marker = take(TRACKED_FILE_MARKER.byteLength, "tracked record type");
    const path = takePath();
    if (Buffer.compare(marker, TRACKED_NONE_MARKER) === 0) {
      tracked.push({ path, type: STAGE_A_CANDIDATE_ABSENT_TYPE });
    } else {
      invariant(Buffer.compare(marker, TRACKED_FILE_MARKER) === 0, "canonical candidate tracked record has an unsupported type");
      tracked.push(takeRegular(path));
    }
  }
  const trackedRecords = Buffer.from(bytes.subarray(trackedRecordsOffset, offset));

  const untrackedCount = take(4, "untracked record count").readUInt32BE();
  invariant(untrackedCount <= MAX_CANDIDATE_UNTRACKED_FILES, "canonical candidate untracked record count exceeds its bound");
  const untrackedRecordsOffset = offset;
  const untracked: CanonicalUntrackedIdentity[] = [];
  for (let index = 0; index < untrackedCount; index += 1) {
    invariant(
      Buffer.compare(take(UNTRACKED_FILE_MARKER.byteLength, "untracked record type"), UNTRACKED_FILE_MARKER) === 0,
      "canonical candidate untracked record has an unsupported type",
    );
    untracked.push(takeRegular(takePath()));
  }
  invariant(offset === bytes.byteLength, "canonical candidate input has trailing bytes");
  const untrackedRecords = Buffer.from(bytes.subarray(untrackedRecordsOffset));
  invariant(Buffer.compare(canonicalTrackedRecords(tracked), trackedRecords) === 0, "canonical tracked record encoding is not canonical");
  invariant(Buffer.compare(canonicalUntrackedRecords(untracked), untrackedRecords) === 0, "canonical untracked record encoding is not canonical");
  return {
    version: STAGE_A_CANDIDATE_IDENTITY_VERSION,
    trackedDiff,
    tracked,
    trackedRecords,
    untracked,
    untrackedRecords,
  };
}

function splitNulPaths(raw: Uint8Array): Buffer[] {
  const bytes = Buffer.from(raw);
  if (bytes.byteLength === 0) return [];
  invariant(bytes.at(-1) === 0, "Git path stream is not NUL terminated");
  const paths: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0) continue;
    invariant(index > start, "Git path stream contains an empty path");
    paths.push(Buffer.from(bytes.subarray(start, index)));
    start = index + 1;
  }
  return paths;
}

function canonicalSortedGitPaths(raw: Uint8Array, maximum: number, label: string): string[] {
  const encoded = splitNulPaths(raw).sort(Buffer.compare);
  invariant(encoded.length <= maximum, `candidate ${label} path count exceeds its bound`);
  const result: string[] = [];
  let previous: Buffer | undefined;
  for (const pathBytes of encoded) {
    if (previous) invariant(Buffer.compare(previous, pathBytes) !== 0, `duplicate candidate ${label} path in Git path stream`);
    previous = pathBytes;
    result.push(decodeCanonicalPath(pathBytes));
  }
  return result;
}

export function canonicalSortedTrackedPaths(raw: Uint8Array): string[] {
  return canonicalSortedGitPaths(raw, MAX_CANDIDATE_TRACKED_FILES, "tracked");
}

export function canonicalSortedUntrackedPaths(raw: Uint8Array): string[] {
  return canonicalSortedGitPaths(raw, MAX_CANDIDATE_UNTRACKED_FILES, "untracked");
}

function canonicalIgnoredPaths(raw: Uint8Array): string[] {
  const normalized = splitNulPaths(raw).map((path) => path.at(-1) === 0x2f ? path.subarray(0, -1) : path);
  return canonicalSortedGitPaths(canonicalSortedPathBytes(normalized.map(decodeCanonicalPath)), MAX_CANDIDATE_UNTRACKED_FILES, "ignored");
}

export function canonicalSortedPathBytes(paths: readonly string[]): Buffer {
  if (paths.length === 0) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for (const path of paths) {
    safeCandidatePath(path);
    chunks.push(Buffer.from(path, "utf8"), Buffer.from([0]));
  }
  return Buffer.concat(chunks);
}

function closureEntryRecord(
  path: string,
  type: "directory" | "regular-file" | "symlink" | "special",
  stat: StableStatIdentity,
  ignored: boolean,
  symlinkTarget?: Buffer,
): Buffer {
  const pathBytes = Buffer.from(path, "utf8");
  const typeBytes = Buffer.from(`${type}\0`, "ascii");
  return Buffer.concat([
    ignored ? CLOSURE_IGNORED_MARKER : CLOSURE_VISIBLE_MARKER,
    uint32(pathBytes.byteLength),
    pathBytes,
    typeBytes,
    canonicalStatRecord(stat),
    symlinkTarget === undefined ? uint32(0) : Buffer.concat([uint32(symlinkTarget.byteLength), symlinkTarget]),
  ]);
}

function captureCandidateFilesystemClosure(
  rootDescriptor: number,
  trackedPaths: ReadonlySet<string>,
  untrackedPaths: ReadonlySet<string>,
  ignoredPaths: ReadonlySet<string>,
): Buffer {
  let entryCount = 0;
  const rootBefore = stableStat(fstatSync(rootDescriptor, { bigint: true }) as unknown as ReturnType<typeof fstatSync>);
  const chunks: Buffer[] = [CLOSURE_VERSION_MARKER, CLOSURE_ROOT_MARKER, canonicalStatRecord(rootBefore)];

  const visit = (directoryDescriptor: number, prefix: string, depth: number, inheritedIgnored: boolean): void => {
    invariant(depth <= 256, "candidate filesystem depth exceeds its bound");
    const names = (readdirSync(`/proc/self/fd/${directoryDescriptor}`, { encoding: "buffer" }) as Buffer[])
      .sort(Buffer.compare);
    for (const nameBytes of names) {
      const name = decodeCanonicalPath(nameBytes);
      const path = prefix ? `${prefix}/${name}` : name;
      if (path === ".git" || path.startsWith(".git/")) continue;
      safeCandidatePath(path);
      entryCount += 1;
      invariant(entryCount <= (MAX_CANDIDATE_TRACKED_FILES + MAX_CANDIDATE_UNTRACKED_FILES) * 16, "candidate filesystem entry count exceeds its bound");
      const anchored = `/proc/self/fd/${directoryDescriptor}/${name}`;
      const beforeRaw = lstatSync(anchored, { bigint: true });
      const before = stableStat(beforeRaw as unknown as ReturnType<typeof lstatSync>);
      const ignored = inheritedIgnored || ignoredPaths.has(path);

      if (beforeRaw.isDirectory()) {
        chunks.push(closureEntryRecord(path, "directory", before, ignored));
        const child = openSync(anchored, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
          const openedRaw = fstatSync(child, { bigint: true });
          const opened = stableStat(openedRaw as unknown as ReturnType<typeof fstatSync>);
          invariant(openedRaw.isDirectory() && equalStableStat(before, opened), `candidate directory identity changed during scan: ${path}`);
          visit(child, path, depth + 1, ignored);
          const afterRaw = fstatSync(child, { bigint: true });
          const after = stableStat(afterRaw as unknown as ReturnType<typeof fstatSync>);
          invariant(afterRaw.isDirectory() && equalStableStat(opened, after), `candidate directory identity changed during scan: ${path}`);
          const lexicalAfterRaw = lstatSync(anchored, { bigint: true });
          const lexicalAfter = stableStat(lexicalAfterRaw as unknown as ReturnType<typeof lstatSync>);
          invariant(lexicalAfterRaw.isDirectory() && equalStableStat(after, lexicalAfter), `candidate directory identity changed during scan: ${path}`);
        } finally {
          closeSync(child);
        }
        continue;
      }

      if (!ignored) {
        invariant(
          trackedPaths.has(path) || untrackedPaths.has(path),
          `candidate filesystem entry is absent from the tracked and untracked inventories: ${path}`,
        );
      }
      if (beforeRaw.isFile()) {
        const descriptor = openSync(anchored, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const openedRaw = fstatSync(descriptor, { bigint: true });
          const opened = stableStat(openedRaw as unknown as ReturnType<typeof fstatSync>);
          invariant(openedRaw.isFile() && equalStableStat(before, opened), `candidate file identity changed during closure scan: ${path}`);
          chunks.push(closureEntryRecord(path, "regular-file", opened, ignored));
          const descriptorAfterRaw = fstatSync(descriptor, { bigint: true });
          const descriptorAfter = stableStat(descriptorAfterRaw as unknown as ReturnType<typeof fstatSync>);
          const lexicalAfterRaw = lstatSync(anchored, { bigint: true });
          const lexicalAfter = stableStat(lexicalAfterRaw as unknown as ReturnType<typeof lstatSync>);
          invariant(
            descriptorAfterRaw.isFile()
              && lexicalAfterRaw.isFile()
              && equalStableStat(opened, descriptorAfter)
              && equalStableStat(descriptorAfter, lexicalAfter),
            `candidate file identity changed during closure scan: ${path}`,
          );
        } finally {
          closeSync(descriptor);
        }
      } else if (beforeRaw.isSymbolicLink()) {
        const target = Buffer.from(readlinkSync(anchored, { encoding: "buffer" }));
        const afterRaw = lstatSync(anchored, { bigint: true });
        const after = stableStat(afterRaw as unknown as ReturnType<typeof lstatSync>);
        invariant(afterRaw.isSymbolicLink() && equalStableStat(before, after), `candidate symlink identity changed during closure scan: ${path}`);
        chunks.push(closureEntryRecord(path, "symlink", before, ignored, target));
      } else {
        const afterRaw = lstatSync(anchored, { bigint: true });
        const after = stableStat(afterRaw as unknown as ReturnType<typeof lstatSync>);
        invariant(equalStableStat(before, after), `candidate special identity changed during closure scan: ${path}`);
        chunks.push(closureEntryRecord(path, "special", before, ignored));
      }
    }
  };

  visit(rootDescriptor, "", 0, false);
  const rootAfter = stableStat(fstatSync(rootDescriptor, { bigint: true }) as unknown as ReturnType<typeof fstatSync>);
  invariant(equalStableStat(rootBefore, rootAfter), "candidate root identity changed during closure scan");
  return Buffer.concat(chunks);
}

export function identifyCanonicalTrackedFiles(
  rootDescriptor: number,
  sortedPaths: readonly string[],
): CanonicalTrackedIdentity[] {
  const identities = sortedPaths.map((path) => readCanonicalTrackedIdentity(rootDescriptor, path).identity);
  canonicalTrackedRecords(identities);
  return identities;
}

export function identifyCanonicalUntrackedFiles(
  rootDescriptor: number,
  sortedPaths: readonly string[],
): CanonicalUntrackedIdentity[] {
  const identities = sortedPaths.map((path) => readCanonicalUntrackedIdentity(rootDescriptor, path).identity);
  canonicalUntrackedRecords(identities);
  return identities;
}

function runGit(rootDescriptor: number, args: readonly string[]): Buffer {
  const result = spawnSync("git", ["-C", "/proc/self/fd/3", ...args], {
    cwd: "/",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C",
      HOME: "/nonexistent",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
    encoding: null,
    stdio: ["ignore", "pipe", "pipe", rootDescriptor],
    maxBuffer: 1024 * 1024 * 1024,
  });
  invariant(result.error === undefined && result.signal === null && result.status === 0, `Git candidate command failed: ${args[0] ?? "unknown"}`);
  return Buffer.from(result.stdout);
}

function captureCandidateGitSnapshot(rootDescriptor: number, baseRef: string): CandidateGitSnapshot {
  const trackedDiff = runGit(rootDescriptor, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", baseRef, "--"]);
  const rawTrackedPaths = runGit(rootDescriptor, ["ls-files", "-z"]);
  const rawUntrackedPaths = runGit(rootDescriptor, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const rawIgnoredPaths = runGit(rootDescriptor, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
  const sortedTrackedPaths = canonicalSortedTrackedPaths(rawTrackedPaths);
  const sortedUntrackedPaths = canonicalSortedUntrackedPaths(rawUntrackedPaths);
  const ignoredPaths = canonicalIgnoredPaths(rawIgnoredPaths);
  return {
    trackedDiff,
    rawTrackedPaths,
    rawUntrackedPaths,
    rawIgnoredPaths,
    sortedTrackedPaths,
    sortedUntrackedPaths,
    ignoredPaths,
    filesystemClosure: captureCandidateFilesystemClosure(
      rootDescriptor,
      new Set(sortedTrackedPaths),
      new Set(sortedUntrackedPaths),
      new Set(ignoredPaths),
    ),
  };
}

function assertStableSnapshot(before: CandidateGitSnapshot, after: CandidateGitSnapshot): void {
  for (const [label, left, right] of [
    ["tracked diff", before.trackedDiff, after.trackedDiff],
    ["tracked inventory", before.rawTrackedPaths, after.rawTrackedPaths],
    ["untracked inventory", before.rawUntrackedPaths, after.rawUntrackedPaths],
    ["ignored inventory", before.rawIgnoredPaths, after.rawIgnoredPaths],
    ["filesystem closure", before.filesystemClosure, after.filesystemClosure],
  ] as const) {
    invariant(Buffer.compare(left, right) === 0, `candidate stable snapshot changed: ${label}`);
  }
}

export function collectCanonicalCandidate(root: string, baseRef: string): CanonicalCandidate {
  invariant(/^[a-f0-9]{40}$/.test(baseRef), "base ref must be a lowercase full commit identity");
  const repository = resolve(root);
  const rootDescriptor = openSync(repository, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const before = captureCandidateGitSnapshot(rootDescriptor, baseRef);
    const tracked = identifyCanonicalTrackedFiles(rootDescriptor, before.sortedTrackedPaths);
    const untracked = identifyCanonicalUntrackedFiles(rootDescriptor, before.sortedUntrackedPaths);
    const { input, trackedRecords, untrackedRecords } = canonicalCandidateInput(before.trackedDiff, tracked, untracked);
    const after = captureCandidateGitSnapshot(rootDescriptor, baseRef);
    assertStableSnapshot(before, after);
    return {
      version: STAGE_A_CANDIDATE_IDENTITY_VERSION,
      trackedDiff: before.trackedDiff,
      sortedTrackedPaths: before.sortedTrackedPaths,
      tracked,
      trackedRecords,
      sortedUntrackedPaths: before.sortedUntrackedPaths,
      untracked,
      untrackedRecords,
      input,
      digest: sha256Bytes(input),
    };
  } finally {
    closeSync(rootDescriptor);
  }
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return typeof entry === "string"
    && basename(entry) === "stage-a-candidate-identity.ts"
    && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isEntrypoint()) {
  const [baseRef, mode = "candidate"] = process.argv.slice(2);
  invariant(baseRef, "base ref is required");
  const candidate = collectCanonicalCandidate(process.cwd(), baseRef);
  if (mode === "candidate") process.stdout.write(`${candidate.digest}\n`);
  else if (mode === "tracked") process.stdout.write(`${sha256Bytes(candidate.trackedDiff)}\n`);
  else if (mode === "tracked-records") process.stdout.write(candidate.trackedRecords);
  else if (mode === "tracked-paths") process.stdout.write(canonicalSortedPathBytes(candidate.sortedTrackedPaths));
  else if (mode === "tracked-inventory") process.stdout.write(`${JSON.stringify(candidate.tracked, null, 2)}\n`);
  else if (mode === "untracked") process.stdout.write(`${sha256Bytes(candidate.untrackedRecords)}\n`);
  else if (mode === "input") process.stdout.write(candidate.input);
  else if (mode === "records") process.stdout.write(candidate.untrackedRecords);
  else if (mode === "paths") process.stdout.write(canonicalSortedPathBytes(candidate.sortedUntrackedPaths));
  else if (mode === "inventory") process.stdout.write(`${JSON.stringify(candidate.untracked, null, 2)}\n`);
  else throw new Error(`unknown digest mode: ${mode}`);
}
