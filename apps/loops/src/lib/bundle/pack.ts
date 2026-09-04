/**
 * Packing a loop bundle directory into a single transferable archive.
 *
 * The tar is written here rather than shelled out to `tar`: GNU and BSD tar
 * disagree about extended headers, ordering, and what they put in the mtime and
 * uid fields, and the archive is stored immutably under a version key, so two
 * stations packing the same tree must produce the same bytes. Everything that
 * could vary without the content varying is pinned — entries sorted by path,
 * mtime 0, uid/gid 0, empty uname/gname, mode normalised to exactly two values.
 *
 * Compression is zstd (level 10) rather than gzip: zstd's frame carries no
 * timestamp or OS byte, so unlike gzip there is nothing to blank out afterwards
 * to keep the output a pure function of its input.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { scrubSecrets } from "../redact.js";
import {
  assertSafeBundlePath,
  BundleIntegrityError,
  compareBundlePaths,
  computeBundleDigest,
  MANIFEST_FILE,
  MAX_ARCHIVE_BYTES,
  MAX_BUNDLE_FILES,
  MAX_FILE_BYTES,
  MAX_UNPACKED_BYTES,
  PULL_MARKER_FILE,
  requiredModeFor,
  sha256Hex,
  type BundleManifestFile,
} from "./manifest.js";

/** ustar block size. Every header and every file body is padded to a multiple of it. */
const BLOCK = 512;
const ZSTD_LEVEL = 10;

/**
 * Bytes backed by an ArrayBuffer this process owns.
 *
 * Spelled out rather than left as a bare `Uint8Array` because readFileSync and
 * the compressors return views over pooled buffers, and letting one of those
 * outlive the call is how a view ends up describing bytes that belong to
 * something else.
 */
export type OwnedBytes = Uint8Array<ArrayBuffer>;

export function ownBytes(view: Uint8Array | ArrayBuffer): OwnedBytes {
  const source = view instanceof ArrayBuffer ? new Uint8Array(view) : view;
  const out = new Uint8Array(new ArrayBuffer(source.byteLength));
  out.set(source);
  return out;
}

export interface BundleEntry {
  path: string;
  bytes: OwnedBytes;
  mode: number;
}

/** Never packed, at any depth. Matched case-insensitively — macOS is case-insensitive. */
const ANY_SEGMENT_EXCLUDES = new Set([
  ".git",
  ".ds_store",
  "node_modules",
  "dist",
  ".aws",
  ".ssh",
  ".gnupg",
  ".docker",
]);

/** Credential-bearing filenames, excluded at any depth. */
const EXCLUDED_FILENAMES = new Set([
  ".ds_store",
  ".env",
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".envrc",
  ".pgpass",
  ".git-credentials",
  "credentials",
  PULL_MARKER_FILE.toLowerCase(),
]);

const EXCLUDED_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"];

function isExcludedFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (EXCLUDED_FILENAMES.has(lower)) return true;
  if (lower.startsWith(".env.")) return true;
  if (lower.startsWith("id_rsa")) return true;
  if (lower.startsWith("._")) return true;
  return EXCLUDED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export interface CollectedBundle {
  entries: BundleEntry[];
  files: BundleManifestFile[];
  bundleDigest: string;
  unpackedBytes: number;
}

/**
 * Walk a bundle directory into archive-ordered entries.
 *
 * Symlinks are skipped rather than followed or recorded: a recorded link can
 * point outside the extraction root, and following one can pull a whole home
 * directory into a bundle through a stray link in a scripts folder. The mode of
 * every surviving file is NORMALISED, not copied — `scripts/**` becomes 0700
 * and everything else 0600, so the digest cannot change because someone's umask
 * differed.
 */
export function collectBundleEntries(dir: string): BundleEntry[] {
  const entries: BundleEntry[] = [];
  walk(dir, dir, entries);
  return entries.sort((a, b) => compareBundlePaths(a.path, b.path));
}

function walk(root: string, current: string, out: BundleEntry[]): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (ANY_SEGMENT_EXCLUDES.has(entry.name.toLowerCase())) continue;
    const absolute = join(current, entry.name);
    const rel = relative(root, absolute).split("\\").join("/");
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(root, absolute, out);
      continue;
    }
    if (!entry.isFile()) continue;
    // The exclusion check runs on regular files only, after the directory
    // branch: evaluating it first would prune a whole subtree named
    // `credentials/` before it could be recursed.
    if (isExcludedFile(entry.name)) continue;
    if (rel === MANIFEST_FILE) continue;
    assertSafeBundlePath(rel);
    const stats = statSync(absolute);
    if (stats.size > MAX_FILE_BYTES) {
      throw new BundleIntegrityError(
        "BUNDLE_FILE_TOO_LARGE",
        `${rel} is ${stats.size} bytes, over the ${MAX_FILE_BYTES} byte per-file cap`,
      );
    }
    out.push({ path: rel, bytes: ownBytes(readFileSync(absolute)), mode: requiredModeFor(rel) });
  }
}

/**
 * Refuse to pack a tree that contains credential material.
 *
 * `scrubSecrets` is the write-path scrubber used everywhere else in loops; here
 * it is used as a DETECTOR rather than a filter — if scrubbing would change any
 * byte, the file holds something that must not travel into an immutable,
 * fleet-readable artifact, and the push is refused.
 *
 * There is deliberately no `--allow-secrets`. Scrubbing on the way in would
 * publish a bundle whose scripts no longer work; the fix is always to remove
 * the credential or externalise it. The offending VALUE is never echoed — only
 * the path and the byte offset of the first divergence, which is enough to find
 * it and not enough to leak it.
 */
export function assertNoCredentials(entries: readonly BundleEntry[]): void {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (const entry of entries) {
    // Binary files are not scanned: `scrubSecrets` is a text scrubber, and
    // decoding arbitrary bytes as UTF-8 produces replacement characters that
    // would report a "difference" on every image.
    if (looksBinary(entry.bytes)) continue;
    const text = decoder.decode(entry.bytes);
    const scrubbed = scrubSecrets(text);
    if (scrubbed === text) continue;
    let offset = 0;
    while (offset < text.length && offset < scrubbed.length && text[offset] === scrubbed[offset]) offset += 1;
    throw new BundleIntegrityError(
      "BUNDLE_CONTAINS_SECRET",
      `${entry.path} looks like it contains credential material at byte offset ${offset}; remove or externalise it (there is no --allow-secrets)`,
    );
  }
}

function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.byteLength, 8000);
  for (let index = 0; index < limit; index += 1) if (bytes[index] === 0) return true;
  return false;
}

/** Manifest file entries for a collected set, in the digest's canonical order. */
export function manifestFilesFor(entries: readonly BundleEntry[]): BundleManifestFile[] {
  return [...entries]
    .sort((a, b) => compareBundlePaths(a.path, b.path))
    .map((entry) => ({
      path: entry.path,
      sha256: sha256Hex(entry.bytes),
      mode: entry.mode,
      size: entry.bytes.byteLength,
    }));
}

/** Collect + cap-check + credential-scan a directory, without compressing it. */
export function collectBundle(dir: string): CollectedBundle {
  const entries = collectBundleEntries(dir);
  if (entries.length === 0) {
    throw new BundleIntegrityError("BUNDLE_EMPTY", `nothing to pack: ${dir} contains no files after exclusions`);
  }
  if (entries.length > MAX_BUNDLE_FILES) {
    throw new BundleIntegrityError("BUNDLE_TOO_MANY_FILES", `${entries.length} files, over the ${MAX_BUNDLE_FILES} file cap`);
  }
  const unpackedBytes = entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
  if (unpackedBytes > MAX_UNPACKED_BYTES) {
    throw new BundleIntegrityError("BUNDLE_TOO_LARGE", `${unpackedBytes} bytes uncompressed, over the ${MAX_UNPACKED_BYTES} byte cap`);
  }
  assertNoCredentials(entries);
  const files = manifestFilesFor(entries);
  return { entries, files, bundleDigest: computeBundleDigest(files), unpackedBytes };
}

export interface PackedBundle extends CollectedBundle {
  /** The `bundle.tar.zst` bytes. */
  archive: OwnedBytes;
  /** sha-256 of `archive` — the transport identity. */
  archiveSha256: string;
}

/** Compress a collected set into `bundle.tar.zst`. Reproducible for a given zstd build. */
export function packBundleEntries(collected: CollectedBundle): PackedBundle {
  const archive = ownBytes(Bun.zstdCompressSync(writeTar(collected.entries), { level: ZSTD_LEVEL }));
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new BundleIntegrityError(
      "BUNDLE_TOO_LARGE",
      `compressed archive is ${archive.byteLength} bytes, over the ${MAX_ARCHIVE_BYTES} byte cap`,
    );
  }
  return { ...collected, archive, archiveSha256: sha256Hex(archive) };
}

export function packBundle(dir: string): PackedBundle {
  return packBundleEntries(collectBundle(dir));
}

export function writeTar(entries: readonly BundleEntry[]): OwnedBytes {
  const blocks: Uint8Array[] = [];
  for (const entry of [...entries].sort((a, b) => compareBundlePaths(a.path, b.path))) {
    blocks.push(ustarHeader(entry));
    blocks.push(entry.bytes);
    const remainder = entry.bytes.byteLength % BLOCK;
    if (remainder !== 0) blocks.push(new Uint8Array(new ArrayBuffer(BLOCK - remainder)));
  }
  // Two zero blocks terminate a tar archive.
  blocks.push(new Uint8Array(new ArrayBuffer(BLOCK * 2)));
  return concat(blocks);
}

function ustarHeader(entry: BundleEntry): OwnedBytes {
  const header = new Uint8Array(new ArrayBuffer(BLOCK));
  const encoder = new TextEncoder();
  const put = (offset: number, length: number, value: string) => {
    const encoded = encoder.encode(value);
    if (encoded.byteLength > length) {
      throw new BundleIntegrityError("BUNDLE_PATH_INVALID", `cannot pack '${entry.path}': field does not fit a ustar header`);
    }
    header.set(encoded, offset);
  };
  // ustar can split a long path across prefix(155) + name(100). Supporting the
  // split would give one path two spellings and therefore one content two
  // digests, so long paths are refused instead.
  if (encoder.encode(entry.path).byteLength > 100) {
    throw new BundleIntegrityError("BUNDLE_PATH_INVALID", `cannot pack '${entry.path}': path is longer than the 100 bytes a ustar header holds`);
  }

  put(0, 100, entry.path);
  put(100, 8, `${entry.mode.toString(8).padStart(7, "0")}\0`);
  put(108, 8, "0000000\0"); // uid
  put(116, 8, "0000000\0"); // gid
  put(124, 12, `${entry.bytes.byteLength.toString(8).padStart(11, "0")}\0`);
  put(136, 12, `${(0).toString(8).padStart(11, "0")}\0`); // mtime, pinned to the epoch
  put(148, 8, "        "); // checksum placeholder: spaces, per the format
  put(156, 1, "0"); // typeflag: regular file
  put(257, 6, "ustar\0");
  put(263, 2, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  put(148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

export function concat(chunks: readonly Uint8Array[]): OwnedBytes {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
