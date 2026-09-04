/**
 * Reading a loop bundle archive back, safely.
 *
 * Everything here treats its input as hostile. The archive arrives over the
 * network, and it is about to be written into a directory whose `scripts/**`
 * the executor will run — so the extraction gate (path traversal, typeflag,
 * truncation, caps) and the integrity gate (recomputed digest vs. the manifest)
 * both run BEFORE any byte reaches the filesystem.
 */
import {
  assertSafeBundlePath,
  BundleIntegrityError,
  compareBundlePaths,
  computeBundleDigest,
  MANIFEST_FILE,
  MAX_BUNDLE_FILES,
  MAX_FILE_BYTES,
  MAX_UNPACKED_BYTES,
  PULL_MARKER_FILE,
  requiredModeFor,
  sha256Hex,
  type BundleManifest,
} from "./manifest.js";
import { manifestFilesFor, ownBytes, type BundleEntry, type OwnedBytes } from "./pack.js";

const BLOCK = 512;

/** Decompress + untar, refusing anything a loop bundle has no business containing. */
export function unpackBundle(archive: Uint8Array): BundleEntry[] {
  let tar: OwnedBytes;
  try {
    tar = ownBytes(Bun.zstdDecompressSync(ownBytes(archive)));
  } catch (error) {
    throw new BundleIntegrityError(
      "BUNDLE_ARCHIVE_CORRUPT",
      `bundle archive is not readable zstd: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return readTar(tar);
}

function readTar(tar: OwnedBytes): BundleEntry[] {
  const decoder = new TextDecoder();
  const entries: BundleEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let terminated = false;
  let total = 0;
  while (offset + BLOCK <= tar.byteLength) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      terminated = true;
      break;
    }
    const path = assertSafeBundlePath(trimNul(decoder.decode(header.subarray(0, 100))));
    // Byte 156 is the ustar typeflag. Every value other than regular-file is a
    // thing this format can carry that a bundle must not: a symlink ('2') or
    // hardlink ('1') pointing wherever the author chose, a directory ('5')
    // whose mode is not in the manifest, or a GNU '././@LongLink' ('L') header
    // whose BODY is the real path — which would walk straight past the path
    // check above, since the header path it sees is the harmless placeholder.
    const typeflag = String.fromCharCode(header[156]!);
    if (typeflag !== "0" && typeflag !== "\0") {
      throw new BundleIntegrityError(
        "BUNDLE_ENTRY_UNSAFE",
        `unsafe bundle entry '${path}': only regular files are allowed, found tar type '${typeflag}'`,
      );
    }
    if (path === MANIFEST_FILE || path === PULL_MARKER_FILE) {
      throw new BundleIntegrityError("BUNDLE_ENTRY_UNSAFE", `unsafe bundle entry '${path}': this file is never part of an archive`);
    }
    const key = path.toLowerCase();
    if (seen.has(key)) {
      throw new BundleIntegrityError("BUNDLE_ENTRY_UNSAFE", `unsafe bundle entry '${path}': duplicate path`);
    }
    seen.add(key);
    const mode = Number.parseInt(trimNul(decoder.decode(header.subarray(100, 108))).trim() || "0", 8);
    if (mode !== requiredModeFor(path)) {
      throw new BundleIntegrityError(
        "BUNDLE_ENTRY_UNSAFE",
        `unsafe bundle entry '${path}': mode must be ${requiredModeFor(path).toString(8)}, found ${mode.toString(8)}`,
      );
    }
    const size = Number.parseInt(trimNul(decoder.decode(header.subarray(124, 136))).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new BundleIntegrityError("BUNDLE_ARCHIVE_CORRUPT", `unreadable size for '${path}'`);
    if (size > MAX_FILE_BYTES) throw new BundleIntegrityError("BUNDLE_FILE_TOO_LARGE", `'${path}' is ${size} bytes, over the ${MAX_FILE_BYTES} byte cap`);
    total += size;
    if (total > MAX_UNPACKED_BYTES) throw new BundleIntegrityError("BUNDLE_TOO_LARGE", `archive expands past the ${MAX_UNPACKED_BYTES} byte cap`);
    offset += BLOCK;
    if (offset + size > tar.byteLength) {
      throw new BundleIntegrityError("BUNDLE_ARCHIVE_CORRUPT", `'${path}' claims ${size} bytes past the end of the archive`);
    }
    entries.push({ path, mode, bytes: ownBytes(tar.subarray(offset, offset + size)) });
    if (entries.length > MAX_BUNDLE_FILES) {
      throw new BundleIntegrityError("BUNDLE_TOO_MANY_FILES", `archive holds more than ${MAX_BUNDLE_FILES} files`);
    }
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  // An archive that simply runs out is NOT an archive that ended. Without this
  // the loop's exit condition doubles as a success condition, so a bundle
  // truncated in transit unpacks to however many whole entries survived and
  // reports no error at all — a loop silently missing its last script.
  if (!terminated) {
    throw new BundleIntegrityError("BUNDLE_ARCHIVE_CORRUPT", "the archive ends without its terminating blocks, so it is truncated");
  }
  if (entries.length === 0) throw new BundleIntegrityError("BUNDLE_EMPTY", "the archive contains no files");
  return entries.sort((a, b) => compareBundlePaths(a.path, b.path));
}

/**
 * Prove an unpacked entry set is exactly what a manifest describes.
 *
 * Set equality on (path, sha256, mode, size) AND digest equality. Either check
 * alone is insufficient: the digest is derived from the manifest's own list, so
 * a manifest that agrees with itself but not with the archive would pass a
 * digest-only check.
 */
export function verifyBundleAgainstManifest(entries: readonly BundleEntry[], manifest: BundleManifest): void {
  const actual = manifestFilesFor(entries);
  const expected = manifest.files;
  const mismatch =
    actual.length !== expected.length ||
    actual.some((file, index) => {
      const other = expected[index]!;
      return file.path !== other.path || file.sha256 !== other.sha256 || file.mode !== other.mode || file.size !== other.size;
    });
  if (mismatch) {
    const actualPaths = new Set(actual.map((file) => file.path));
    const expectedPaths = new Set(expected.map((file) => file.path));
    const missing = expected.filter((file) => !actualPaths.has(file.path)).map((file) => file.path);
    const extra = actual.filter((file) => !expectedPaths.has(file.path)).map((file) => file.path);
    const changed = actual
      .filter((file) => {
        const other = expected.find((candidate) => candidate.path === file.path);
        return other && (other.sha256 !== file.sha256 || other.mode !== file.mode || other.size !== file.size);
      })
      .map((file) => file.path);
    throw new BundleIntegrityError(
      "MANIFEST_FILE_MISMATCH",
      `bundle contents do not match manifest.json${missing.length ? `; missing: ${missing.join(", ")}` : ""}` +
        `${extra.length ? `; unexpected: ${extra.join(", ")}` : ""}${changed.length ? `; changed: ${changed.join(", ")}` : ""}`,
    );
  }
  const digest = computeBundleDigest(actual);
  if (digest !== manifest.bundleDigest) {
    throw new BundleIntegrityError("BUNDLE_DIGEST_MISMATCH", `recomputed bundle digest ${digest} does not match manifest ${manifest.bundleDigest}`);
  }
}

/** Prove the transport bytes are the ones the manifest was written for. */
export function verifyArchiveSha256(archive: Uint8Array, expected: string): void {
  const actual = sha256Hex(archive);
  if (actual !== expected) {
    throw new BundleIntegrityError("ARCHIVE_DIGEST_MISMATCH", `archive sha256 ${actual} does not match the declared ${expected}`);
  }
}

function trimNul(value: string): string {
  const end = value.indexOf("\0");
  return end === -1 ? value : value.slice(0, end);
}
