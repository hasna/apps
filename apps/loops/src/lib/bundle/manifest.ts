/**
 * Loop bundle manifest: the schema, the path/name rules, and the canonical
 * content digest.
 *
 * A loop is a database row (the runtime authority) and, once bundled, also a
 * directory of files — `loop.json`, `scripts/**`, notes — because a loop may
 * carry scripts and a row cannot. `manifest.json` is what makes that directory
 * verifiable: it lists every file with its sha-256 and its mode, and it carries
 * the digest of that list.
 *
 * Two digests, deliberately (hasna/apps#1724 §4.3):
 *
 *   - `bundleDigest` names the CONTENT — the sorted (mode, sha256, size, path)
 *     lines. It is independent of tar padding, mtimes and compression level.
 *   - `archiveSha256` names the BYTES on the wire — sha-256 of `bundle.tar.zst`.
 *
 * Skills used the archive's own sha-256 as the whole identity, which made
 * identity depend on framing: re-packing an unchanged tree produced a different
 * digest, so "same content is idempotent" could not be expressed. Splitting the
 * two is what lets a re-push of an unchanged tree return the existing revision
 * instead of allocating a duplicate version.
 */
import { createHash } from "node:crypto";

/** `loop.json`'s schema tag. Gates forward compatibility of the definition file. */
export const LOOP_BUNDLE_SCHEMA = "hasna.loop.bundle.v1";
/** `manifest.json`'s schema tag. */
export const LOOP_BUNDLE_MANIFEST_SCHEMA = "hasna.loop.bundle-manifest.v1";

/** The definition file. Always present, always listed in `files[]`. */
export const LOOP_JSON_FILE = "loop.json";
/** The manifest itself. Never listed in `files[]` — it cannot contain its own digest. */
export const MANIFEST_FILE = "manifest.json";
/** Local-only provenance marker. Never packed, never uploaded. */
export const PULL_MARKER_FILE = ".loops-bundle.json";
/** Executables live here and only here; the mode rule keys on this prefix. */
export const SCRIPTS_DIR = "scripts";

/** Modes are contract, not umask: data 0600, scripts 0700. Nothing else is representable. */
export const MODE_DATA = 0o600;
export const MODE_SCRIPT = 0o700;
export const MODE_DIR = 0o700;

/** Caps. Exceeding any of them is a client refusal AND a server 413. */
export const MAX_BUNDLE_FILES = 512;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 8 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
/** `manifest.json` is parsed as text under its own limit, never the JSON body limit. */
export const MAX_MANIFEST_BYTES = 256 * 1024;

/**
 * Bundle names are an S3 key segment AND a CLI argument AND a directory name,
 * so the charset is the intersection of what all three can carry unambiguously.
 * `.` and `..` are excluded by the anchors (a name must start and end with
 * [a-z0-9]), and case is fixed lowercase because macOS would otherwise let
 * `Drain` and `drain` name the same directory but two different S3 prefixes.
 */
export const BUNDLE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const BUNDLE_DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Coded failure for every integrity refusal. CLI maps `code` to an exit status. */
export class BundleIntegrityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BundleIntegrityError";
    this.code = code;
  }
}

export interface BundleManifestFile {
  /** POSIX-relative to the bundle root. See {@link assertSafeBundlePath}. */
  path: string;
  sha256: string;
  /** 384 (0o600) for data, 448 (0o700) for `scripts/**`. */
  mode: number;
  size: number;
}

export interface BundleManifestSource {
  station: string;
  agent: string;
  packageVersion?: string;
  reason?: string;
}

export interface BundleManifest {
  schema: typeof LOOP_BUNDLE_MANIFEST_SCHEMA;
  /** 0 is a never-pushed local draft; >= 1 is a server-allocated version. */
  version: number;
  loopId: string;
  name: string;
  bundleDigest: string;
  /** Absent in the on-disk copy (the archive does not exist there), present in the S3 copy. */
  archiveSha256?: string;
  createdAt: string;
  files: BundleManifestFile[];
  source: BundleManifestSource;
  /** Server-derived, never trusted from the client: true when `loop.json` carries an agent prompt. */
  carriesPrompt?: boolean;
}

export function isBundleName(value: unknown): value is string {
  return typeof value === "string" && BUNDLE_NAME_PATTERN.test(value);
}

export function assertBundleName(value: unknown, label = "bundle name"): string {
  if (!isBundleName(value)) {
    throw new BundleIntegrityError(
      "BUNDLE_NAME_INVALID",
      `${label} must match ${BUNDLE_NAME_PATTERN.source} (lowercase, no leading/trailing separator); rename the loop or push with --as <bundle-name>`,
    );
  }
  return value;
}

/**
 * Refuse any path that could escape the bundle root, or that spells the same
 * file two ways.
 *
 * Enforced on WRITE and on READ. The writer is ours; the reader's input is an
 * archive downloaded from a server, which is the side that matters — this is
 * the zip-slip gate, and it runs before a single byte is written to disk.
 */
export function assertSafeBundlePath(path: unknown): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new BundleIntegrityError("BUNDLE_PATH_INVALID", "bundle entry has an empty path");
  }
  if (path.length > 255) {
    throw new BundleIntegrityError("BUNDLE_PATH_INVALID", `bundle entry '${path}' exceeds 255 bytes`);
  }
  if (path.includes("\0")) {
    throw new BundleIntegrityError("BUNDLE_PATH_INVALID", "bundle entry path contains a NUL byte");
  }
  if (path.includes("\\")) {
    throw new BundleIntegrityError("BUNDLE_PATH_INVALID", `bundle entry '${path}': backslashes are not allowed`);
  }
  if (path.startsWith("/")) {
    throw new BundleIntegrityError("BUNDLE_PATH_INVALID", `bundle entry '${path}': absolute paths are not allowed`);
  }
  if (/^[A-Za-z]:/.test(path)) {
    throw new BundleIntegrityError("BUNDLE_PATH_INVALID", `bundle entry '${path}': drive-qualified paths are not allowed`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new BundleIntegrityError(
      "BUNDLE_PATH_INVALID",
      `bundle entry '${path}': empty, '.' and '..' segments are not allowed`,
    );
  }
  return path;
}

/**
 * The mode a path is REQUIRED to carry. `scripts/**` executes; nothing else does.
 *
 * Matched case-insensitively. On macOS `Scripts/run.sh` and `scripts/run.sh`
 * are the same file, so a case-sensitive prefix test would let one spelling
 * claim the executable directory while being validated as inert data.
 */
export function requiredModeFor(path: string): number {
  const lower = path.toLowerCase();
  return lower === SCRIPTS_DIR || lower.startsWith(`${SCRIPTS_DIR}/`) ? MODE_SCRIPT : MODE_DATA;
}

/** Byte-order sort. `localeCompare` would order differently per locale and change the digest. */
export function compareBundlePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The canonical, framing-independent content digest.
 *
 * For each file, in path-sorted byte order, one line:
 *
 *     <mode as 4-digit octal> <sha256 hex> <size decimal> <path>\n
 *
 * then `sha256:` + sha-256 over the UTF-8 concatenation. Mode is in the digest
 * because a script losing its executable bit is a real change that a
 * content-only digest would call identical.
 */
export function computeBundleDigest(files: readonly BundleManifestFile[]): string {
  const sorted = [...files].sort((a, b) => compareBundlePaths(a.path, b.path));
  const lines = sorted
    .map((file) => `${file.mode.toString(8).padStart(4, "0")} ${file.sha256} ${file.size} ${file.path}\n`)
    .join("");
  return `sha256:${createHash("sha256").update(lines, "utf8").digest("hex")}`;
}

function fail(message: string): never {
  throw new BundleIntegrityError("BUNDLE_MANIFEST_INVALID", `invalid bundle manifest: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

/**
 * Parse and validate an untrusted manifest.
 *
 * Fails closed on every axis the digest depends on — path safety, mode enum,
 * size cap, sort order, self-exclusion — and finally re-derives `bundleDigest`
 * from `files[]` and compares. A manifest whose declared digest disagrees with
 * its own file list is refused here, before any caller can act on either.
 */
export function validateBundleManifest(value: unknown): BundleManifest {
  const raw = record(value, "manifest");
  if (raw.schema !== LOOP_BUNDLE_MANIFEST_SCHEMA) fail(`schema must be "${LOOP_BUNDLE_MANIFEST_SCHEMA}"`);
  const version = raw.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) fail("version must be an integer >= 0");
  if (typeof raw.loopId !== "string" || raw.loopId.length === 0 || raw.loopId.length > 128) fail("loopId must be a 1..128 character string");
  if (!isBundleName(raw.name)) fail(`name must match ${BUNDLE_NAME_PATTERN.source}`);
  if (typeof raw.bundleDigest !== "string" || !BUNDLE_DIGEST.test(raw.bundleDigest)) fail("bundleDigest must be 'sha256:<64 hex>'");
  if (raw.archiveSha256 !== undefined && (typeof raw.archiveSha256 !== "string" || !SHA256_HEX.test(raw.archiveSha256))) {
    fail("archiveSha256 must be 64 lowercase hex characters");
  }
  if (typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) fail("createdAt must be an ISO date-time");
  if (!Array.isArray(raw.files) || raw.files.length === 0) fail("files must be a non-empty array");
  if (raw.files.length > MAX_BUNDLE_FILES) fail(`files may not exceed ${MAX_BUNDLE_FILES} entries`);

  const files: BundleManifestFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const entry of raw.files) {
    const file = record(entry, "files[]");
    const path = assertSafeBundlePath(file.path);
    if (path === MANIFEST_FILE) fail("files[] must not list manifest.json (it cannot contain its own digest)");
    if (path === PULL_MARKER_FILE) fail("files[] must not list the local pull marker");
    // Case-insensitive duplicate detection: macOS resolves `Scripts/a` and
    // `scripts/a` to one file, so an archive carrying both would install one
    // over the other and still match a manifest that lists two.
    const key = path.toLowerCase();
    if (seen.has(key)) fail(`duplicate path '${path}'`);
    seen.add(key);
    if (typeof file.sha256 !== "string" || !SHA256_HEX.test(file.sha256)) fail(`files['${path}'].sha256 must be 64 lowercase hex characters`);
    if (file.mode !== MODE_DATA && file.mode !== MODE_SCRIPT) fail(`files['${path}'].mode must be ${MODE_DATA} (0600) or ${MODE_SCRIPT} (0700)`);
    if (file.mode !== requiredModeFor(path)) {
      fail(`files['${path}'].mode must be ${requiredModeFor(path)}: scripts/** is 0700, every other file is 0600`);
    }
    if (typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 0) fail(`files['${path}'].size must be a non-negative integer`);
    if (file.size > MAX_FILE_BYTES) fail(`files['${path}'] is ${file.size} bytes, over the ${MAX_FILE_BYTES} byte per-file cap`);
    total += file.size;
    files.push({ path, sha256: file.sha256, mode: file.mode, size: file.size });
  }
  if (total > MAX_UNPACKED_BYTES) fail(`files total ${total} bytes, over the ${MAX_UNPACKED_BYTES} byte cap`);
  if (!files.some((file) => file.path === LOOP_JSON_FILE)) fail(`files must list ${LOOP_JSON_FILE}`);
  for (let index = 1; index < files.length; index += 1) {
    if (compareBundlePaths(files[index - 1]!.path, files[index]!.path) >= 0) {
      fail("files must be sorted by path in ascending byte order");
    }
  }
  const derived = computeBundleDigest(files);
  if (derived !== raw.bundleDigest) {
    throw new BundleIntegrityError(
      "BUNDLE_DIGEST_MISMATCH",
      `manifest bundleDigest ${raw.bundleDigest} does not match its own file list (${derived})`,
    );
  }

  const source = record(raw.source, "source");
  if (typeof source.station !== "string" || source.station.length === 0 || source.station.length > 64) fail("source.station must be a 1..64 character string");
  if (typeof source.agent !== "string" || source.agent.length === 0 || source.agent.length > 128) fail("source.agent must be a 1..128 character string");
  if (source.packageVersion !== undefined && (typeof source.packageVersion !== "string" || source.packageVersion.length > 32)) fail("source.packageVersion must be a string of at most 32 characters");
  if (source.reason !== undefined && (typeof source.reason !== "string" || source.reason.length > 512)) fail("source.reason must be a string of at most 512 characters");
  if (raw.carriesPrompt !== undefined && typeof raw.carriesPrompt !== "boolean") fail("carriesPrompt must be a boolean");

  return {
    schema: LOOP_BUNDLE_MANIFEST_SCHEMA,
    version,
    loopId: raw.loopId,
    name: raw.name,
    bundleDigest: raw.bundleDigest,
    ...(raw.archiveSha256 === undefined ? {} : { archiveSha256: raw.archiveSha256 as string }),
    createdAt: new Date(raw.createdAt).toISOString(),
    files,
    source: {
      station: source.station,
      agent: source.agent,
      ...(source.packageVersion === undefined ? {} : { packageVersion: source.packageVersion as string }),
      ...(source.reason === undefined ? {} : { reason: source.reason as string }),
    },
    ...(raw.carriesPrompt === undefined ? {} : { carriesPrompt: raw.carriesPrompt as boolean }),
  };
}

/** Serialise a manifest the one way, so a round trip through disk is byte-stable. */
export function serializeBundleManifest(manifest: BundleManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
