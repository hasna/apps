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
} from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGE_A_CANDIDATE_IDENTITY_VERSION = "todos-stage-a-candidate-identity-v5";
export const STAGE_A_CANDIDATE_REGULAR_FILE_TYPE = "regular-file" as const;
export const MAX_CANDIDATE_PATH_BYTES = 4_096;
export const MAX_CANDIDATE_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_CANDIDATE_UNTRACKED_FILES = 200_000;

const VERSION_MARKER = Buffer.from(`${STAGE_A_CANDIDATE_IDENTITY_VERSION}\0`, "ascii");
const REGULAR_FILE_MARKER = Buffer.from(`${STAGE_A_CANDIDATE_REGULAR_FILE_TYPE}\0`, "ascii");
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

export interface CanonicalUntrackedIdentity {
  path: string;
  type: typeof STAGE_A_CANDIDATE_REGULAR_FILE_TYPE;
  mode: string;
  size: number;
  sha256: string;
}

export interface CanonicalCandidate {
  version: typeof STAGE_A_CANDIDATE_IDENTITY_VERSION;
  trackedDiff: Buffer;
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
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeBigUInt64BE(BigInt(value));
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

export function readCanonicalUntrackedIdentity(
  rootDescriptor: number,
  path: string,
  maxBytes = MAX_CANDIDATE_FILE_BYTES,
): { identity: CanonicalUntrackedIdentity; bytes: Buffer } {
  const parts = safeCandidatePath(path);
  invariant(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= MAX_CANDIDATE_FILE_BYTES, "invalid candidate file bound");
  const initialParent = openAnchoredParent(rootDescriptor, parts);
  let fileDescriptor: number | undefined;
  try {
    const anchoredPath = `/proc/self/fd/${initialParent.descriptor}/${parts.at(-1)!}`;
    const lexicalBeforeRaw = lstatSync(anchoredPath, { bigint: true });
    invariant(lexicalBeforeRaw.isFile() && !lexicalBeforeRaw.isSymbolicLink(), `candidate input is not a regular file: ${path}`);
    const lexicalBefore = stableStat(lexicalBeforeRaw as unknown as ReturnType<typeof lstatSync>);
    invariant(lexicalBefore.nlink === 1n, `candidate input has a multi-link identity: ${path}`);
    invariant(lexicalBefore.size <= BigInt(maxBytes), `candidate input exceeds its byte bound: ${path}`);

    try {
      fileDescriptor = openSync(anchoredPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new Error(`candidate input is not an openable regular file: ${path}`, { cause: error });
    }
    const descriptorBeforeRaw = fstatSync(fileDescriptor, { bigint: true });
    invariant(descriptorBeforeRaw.isFile(), `candidate input is not a regular file: ${path}`);
    const descriptorBefore = stableStat(descriptorBeforeRaw as unknown as ReturnType<typeof fstatSync>);
    invariant(descriptorBefore.nlink === 1n, `candidate input has a multi-link identity: ${path}`);
    invariant(equalStableStat(lexicalBefore, descriptorBefore), `candidate identity changed before read: ${path}`);

    const bytes = readFileSync(fileDescriptor);
    const descriptorAfterRaw = fstatSync(fileDescriptor, { bigint: true });
    const descriptorAfter = stableStat(descriptorAfterRaw as unknown as ReturnType<typeof fstatSync>);
    invariant(
      descriptorAfterRaw.isFile()
        && descriptorAfter.nlink === 1n
        && bytes.byteLength === Number(descriptorAfter.size)
        && equalStableStat(descriptorBefore, descriptorAfter),
      `candidate identity changed while read: ${path}`,
    );

    const finalParent = openAnchoredParent(rootDescriptor, parts);
    try {
      const initialParentIdentity = stableStat(fstatSync(initialParent.descriptor, { bigint: true }) as unknown as ReturnType<typeof fstatSync>);
      const finalParentIdentity = stableStat(fstatSync(finalParent.descriptor, { bigint: true }) as unknown as ReturnType<typeof fstatSync>);
      invariant(equalStableStat(initialParentIdentity, finalParentIdentity), `candidate parent identity changed while read: ${path}`);
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
        `candidate identity changed while read: ${path}`,
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

function validateCanonicalIdentity(identity: CanonicalUntrackedIdentity): void {
  safeCandidatePath(identity.path);
  invariant(identity.type === STAGE_A_CANDIDATE_REGULAR_FILE_TYPE, "candidate identity is not a regular-file record");
  invariant(/^[0-7]{4}$/.test(identity.mode), `candidate identity has an invalid normalized mode: ${identity.path}`);
  invariant(Number.isSafeInteger(identity.size) && identity.size >= 0 && identity.size <= MAX_CANDIDATE_FILE_BYTES, `candidate identity has an invalid size: ${identity.path}`);
  invariant(/^[a-f0-9]{64}$/.test(identity.sha256), `candidate identity has an invalid digest: ${identity.path}`);
}

export function canonicalUntrackedRecords(identities: readonly CanonicalUntrackedIdentity[]): Buffer {
  invariant(identities.length <= MAX_CANDIDATE_UNTRACKED_FILES, "candidate untracked record count exceeds its bound");
  const chunks: Buffer[] = [];
  let previous: Buffer | undefined;
  const seen = new Set<string>();
  for (const identity of identities) {
    validateCanonicalIdentity(identity);
    invariant(!seen.has(identity.path), `duplicate candidate path: ${identity.path}`);
    seen.add(identity.path);
    const pathBytes = Buffer.from(identity.path, "utf8");
    if (previous) invariant(Buffer.compare(previous, pathBytes) < 0, "candidate paths are not in strict byte order");
    previous = pathBytes;
    chunks.push(
      REGULAR_FILE_MARKER,
      uint32(pathBytes.byteLength),
      pathBytes,
      Buffer.from(identity.mode, "ascii"),
      uint64(identity.size),
      Buffer.from(identity.sha256, "hex"),
    );
  }
  return Buffer.concat(chunks);
}

export function canonicalCandidateInput(
  trackedDiff: Uint8Array,
  identities: readonly CanonicalUntrackedIdentity[],
): { input: Buffer; untrackedRecords: Buffer } {
  const diff = Buffer.from(trackedDiff);
  const untrackedRecords = canonicalUntrackedRecords(identities);
  return {
    input: Buffer.concat([
      VERSION_MARKER,
      uint64(diff.byteLength),
      diff,
      uint32(identities.length),
      untrackedRecords,
    ]),
    untrackedRecords,
  };
}

export function decodeCanonicalCandidateInput(input: Uint8Array): {
  version: typeof STAGE_A_CANDIDATE_IDENTITY_VERSION;
  trackedDiff: Buffer;
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
  invariant(Buffer.compare(take(VERSION_MARKER.byteLength, "version marker"), VERSION_MARKER) === 0, "unsupported canonical candidate version marker");
  const trackedLength = Number(take(8, "tracked length").readBigUInt64BE());
  invariant(Number.isSafeInteger(trackedLength), "canonical candidate tracked diff is too large");
  const trackedDiff = Buffer.from(take(trackedLength, "tracked diff"));
  const count = take(4, "record count").readUInt32BE();
  invariant(count <= MAX_CANDIDATE_UNTRACKED_FILES, "canonical candidate record count exceeds its bound");
  const recordsOffset = offset;
  const untracked: CanonicalUntrackedIdentity[] = [];
  for (let index = 0; index < count; index += 1) {
    invariant(Buffer.compare(take(REGULAR_FILE_MARKER.byteLength, "record type"), REGULAR_FILE_MARKER) === 0, "canonical candidate record has an unsupported type");
    const pathLength = take(4, "path length").readUInt32BE();
    invariant(pathLength > 0 && pathLength <= MAX_CANDIDATE_PATH_BYTES, "canonical candidate path length is invalid");
    const path = STRICT_UTF8.decode(take(pathLength, "path"));
    const mode = take(4, "mode").toString("ascii");
    const sizeBig = take(8, "size").readBigUInt64BE();
    invariant(sizeBig <= BigInt(Number.MAX_SAFE_INTEGER), "canonical candidate size exceeds the safe integer range");
    const sha256 = take(32, "digest").toString("hex");
    untracked.push({ path, type: STAGE_A_CANDIDATE_REGULAR_FILE_TYPE, mode, size: Number(sizeBig), sha256 });
  }
  invariant(offset === bytes.byteLength, "canonical candidate input has trailing bytes");
  const untrackedRecords = Buffer.from(bytes.subarray(recordsOffset));
  invariant(Buffer.compare(canonicalUntrackedRecords(untracked), untrackedRecords) === 0, "canonical candidate record encoding is not canonical");
  return { version: STAGE_A_CANDIDATE_IDENTITY_VERSION, trackedDiff, untracked, untrackedRecords };
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

function decodedNulPaths(raw: Uint8Array): string[] {
  return splitNulPaths(raw).map((path) => {
    const decoded = STRICT_UTF8.decode(path);
    invariant(Buffer.compare(Buffer.from(decoded, "utf8"), path) === 0, "Git path is not canonical UTF-8");
    return decoded;
  });
}

function assertCandidateFilesystemClosure(
  rootDescriptor: number,
  trackedPaths: ReadonlySet<string>,
  untrackedPaths: ReadonlySet<string>,
  ignoredPaths: readonly string[],
): void {
  let entryCount = 0;
  const isIgnored = (path: string): boolean => ignoredPaths.some((ignored) =>
    path === ignored || path.startsWith(`${ignored}/`));
  const visit = (directoryDescriptor: number, prefix: string, depth: number): void => {
    invariant(depth <= 256, "candidate filesystem depth exceeds its bound");
    for (const name of readdirSync(`/proc/self/fd/${directoryDescriptor}`).sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (path === ".git" || path.startsWith(".git/")) continue;
      if (isIgnored(path)) continue;
      safeCandidatePath(path);
      entryCount += 1;
      invariant(entryCount <= MAX_CANDIDATE_UNTRACKED_FILES * 16, "candidate filesystem entry count exceeds its bound");
      const anchored = `/proc/self/fd/${directoryDescriptor}/${name}`;
      const before = lstatSync(anchored, { bigint: true });
      if (before.isDirectory()) {
        const child = openSync(anchored, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
          const opened = fstatSync(child, { bigint: true });
          invariant(
            opened.isDirectory() && opened.dev === before.dev && opened.ino === before.ino,
            `candidate directory identity changed during scan: ${path}`,
          );
          visit(child, path, depth + 1);
          const after = fstatSync(child, { bigint: true });
          invariant(
            after.isDirectory() && after.dev === opened.dev && after.ino === opened.ino,
            `candidate directory identity changed during scan: ${path}`,
          );
        } finally {
          closeSync(child);
        }
        continue;
      }
      if (trackedPaths.has(path)) continue;
      if (before.isFile() || before.isSymbolicLink()) {
        invariant(untrackedPaths.has(path), `candidate filesystem entry is absent from the untracked inventory: ${path}`);
        continue;
      }
      throw new Error(`candidate filesystem contains an untracked special file: ${path}`);
    }
  };
  visit(rootDescriptor, "", 0);
}

export function canonicalCandidateFromGitInputs(
  rootDescriptor: number,
  trackedDiffInput: Uint8Array,
  rawUntrackedPaths: Uint8Array,
  rawTrackedPaths: Uint8Array,
  rawIgnoredPaths: Uint8Array,
): CanonicalCandidate {
  const trackedDiff = Buffer.from(trackedDiffInput);
  const sortedUntrackedPaths = canonicalSortedUntrackedPaths(rawUntrackedPaths);
  const trackedPaths = new Set(decodedNulPaths(rawTrackedPaths));
  const ignoredPaths = decodedNulPaths(rawIgnoredPaths)
    .map((path) => path.endsWith("/") ? path.slice(0, -1) : path);
  assertCandidateFilesystemClosure(rootDescriptor, trackedPaths, new Set(sortedUntrackedPaths), ignoredPaths);
  const untracked = identifyCanonicalUntrackedFiles(rootDescriptor, sortedUntrackedPaths);
  const { input, untrackedRecords } = canonicalCandidateInput(trackedDiff, untracked);
  return {
    version: STAGE_A_CANDIDATE_IDENTITY_VERSION,
    trackedDiff,
    sortedUntrackedPaths,
    untracked,
    untrackedRecords,
    input,
    digest: sha256Bytes(input),
  };
}

export function canonicalSortedUntrackedPaths(raw: Uint8Array): string[] {
  const encoded = splitNulPaths(raw).sort(Buffer.compare);
  invariant(encoded.length <= MAX_CANDIDATE_UNTRACKED_FILES, "candidate untracked path count exceeds its bound");
  const result: string[] = [];
  let previous: Buffer | undefined;
  for (const pathBytes of encoded) {
    if (previous) invariant(Buffer.compare(previous, pathBytes) !== 0, "duplicate candidate path in Git path stream");
    previous = pathBytes;
    const path = STRICT_UTF8.decode(pathBytes);
    safeCandidatePath(path);
    invariant(Buffer.compare(Buffer.from(path, "utf8"), pathBytes) === 0, "candidate path is not canonical UTF-8");
    result.push(path);
  }
  return result;
}

export function canonicalSortedPathBytes(paths: readonly string[]): Buffer {
  return paths.length === 0 ? Buffer.alloc(0) : Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

export function identifyCanonicalUntrackedFiles(
  rootDescriptor: number,
  sortedPaths: readonly string[],
): CanonicalUntrackedIdentity[] {
  const identities = sortedPaths.map((path) => readCanonicalUntrackedIdentity(rootDescriptor, path).identity);
  canonicalUntrackedRecords(identities);
  return identities;
}

function runGit(root: string, args: readonly string[]): Buffer {
  const result = spawnSync("git", ["-C", root, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C" },
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 1024,
  });
  invariant(result.error === undefined && result.signal === null && result.status === 0, `Git candidate command failed: ${args[0] ?? "unknown"}`);
  return Buffer.from(result.stdout);
}

export function collectCanonicalCandidate(root: string, baseRef: string): CanonicalCandidate {
  invariant(/^[a-f0-9]{40}$/.test(baseRef), "base ref must be a lowercase full commit identity");
  const repository = resolve(root);
  const rootDescriptor = openSync(repository, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const trackedDiff = runGit(repository, ["diff", "--binary", "--full-index", "--no-ext-diff", baseRef, "--"]);
    const rawPaths = runGit(repository, ["ls-files", "--others", "--exclude-standard", "-z"]);
    return canonicalCandidateFromGitInputs(
      rootDescriptor,
      trackedDiff,
      rawPaths,
      runGit(repository, ["ls-files", "-z"]),
      runGit(repository, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]),
    );
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
  else if (mode === "untracked") process.stdout.write(`${sha256Bytes(candidate.untrackedRecords)}\n`);
  else if (mode === "input") process.stdout.write(candidate.input);
  else if (mode === "records") process.stdout.write(candidate.untrackedRecords);
  else if (mode === "paths") process.stdout.write(canonicalSortedPathBytes(candidate.sortedUntrackedPaths));
  else if (mode === "inventory") process.stdout.write(`${JSON.stringify(candidate.untracked, null, 2)}\n`);
  else throw new Error(`unknown digest mode: ${mode}`);
}
