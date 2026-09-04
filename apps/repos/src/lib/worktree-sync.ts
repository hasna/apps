/**
 * Worktree sync through the app's S3 artifact remote (hasna/apps#1689).
 *
 * This is the PROBE slice of issue #1689: the sync primitives and CLI surface
 * for pushing and pulling a worktree's state — the part git's own remotes do
 * not carry — through the app's S3 bucket, following the artifact-kit pattern
 * from the skills bundle work (hasna/apps#1639):
 *
 *   - the bundle is deterministic byte-for-byte (no timestamps, sorted parts,
 *     pinned gzip level), so its sha256 is a content address that verifies;
 *   - a version is immutable: `<prefix>/<repo>/<worktree>/<version>/` holds
 *     `bundle.tar.gz` plus a `manifest.json` whose sha256s must verify on pull;
 *   - the bucket is configured by environment only (`REPOS_S3_BUCKET`,
 *     standard AWS credential chain), tests inject an in-memory client, and
 *     every verb fails closed when no bucket is configured;
 *   - git's own remote stays the remote of record for *commits*; the bundle
 *     packages what git refuses to carry (uncommitted tracked changes as a
 *     binary-safe patch, untracked files per the repo's ignore rules, the
 *     stash list) and records the refs (branch, head_sha, base_sha) so a pull
 *     can reconstruct the worktree elsewhere.
 *
 * Deliberately NOT in this probe (documented in the PR): bucket/task-role
 * infrastructure, the shared @hasna/contracts artifact-remote kit (#1631), and
 * hosted worktree rows (#1663). Cross-station worktree identity is the repo
 * NAME (numeric registry ids are machine-local); the manifest also records the
 * remote url so a hosted registry can supersede both later.
 *
 * State deliberately NOT restored on pull: the stash list (recorded in the
 * manifest, applied by hand) and the local branch (pull materialises a
 * detached checkout at the recorded head_sha so a foreign worktree can never
 * steal a local branch name; `git switch <branch>` after verification).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { computeWorktreePath, redactGitDiagnostics } from "./worktrees.js";
import { getSourceMachineId } from "./machine-id.js";
import { getRepo } from "../db/repos.js";

/** Schema name for every JSON payload this module emits. */
export const WORKTREE_SYNC_SCHEMA = "repos.worktree-sync.v1" as const;

/** Environment variable naming the S3 bucket that backs the artifact remote. */
export const REPOS_S3_BUCKET_ENV = "REPOS_S3_BUCKET";

/** Default object prefix inside the bucket, as ratified in issue #1689. */
export const DEFAULT_PREFIX = "worktrees";

/** Fixed gzip level so the bundle bytes — and therefore the content address — are reproducible. */
const GZIP_LEVEL = 6;

/** A version is an RFC 3339 timestamp: lexicographic order is chronological order. */
function nowVersion(): string {
  return new Date().toISOString();
}

export type WorktreeSyncErrorCode =
  | "REMOTE_NOT_CONFIGURED"
  | "REMOTE_FAILED"
  | "VERSION_NOT_FOUND"
  | "BUNDLE_VERIFICATION_FAILED"
  // syncWorktree carries a conflict on the RESULT (the push itself succeeded);
  // the sync CLI raises this typed error from that flag so --json and human
  // modes fail identically with exit 1.
  | "SYNC_CONFLICT"
  | "WORKTREE_NOT_FOUND"
  | "PARENT_CHECKOUT_UNHEALTHY"
  | "MATERIALIZED_ALREADY"
  | "PATCH_APPLY_FAILED";

export class WorktreeSyncError extends Error {
  constructor(
    public readonly code: WorktreeSyncErrorCode,
    message: string,
    public readonly details: Record<string, string | number | null | undefined> = {},
  ) {
    super(message);
    this.name = "WorktreeSyncError";
  }
}

function syncFail(
  code: WorktreeSyncErrorCode,
  message: string,
  details: Record<string, string | number | null | undefined> = {},
): never {
  throw new WorktreeSyncError(code, message, details);
}

// ── git plumbing ────────────────────────────────────────────────────────────

interface GitOk {
  ok: boolean;
  /**
   * Raw stdout, un-decoded and un-trimmed. `ls-files -z` listings and
   * `diff --binary` output are BYTE data, not UTF-8 text: decoding them as
   * utf8 mangles non-UTF8 names to U+FFFD (dropping the file on the
   * join/lstat that follows) and corrupts non-UTF8 bytes inside changed lines
   * of legacy-encoded text files. Only genuinely textual call sites decode,
   * via {@link gitText}.
   */
  stdout: Buffer;
  stderr: string;
}

/** Decode a text-mode git stdout: UTF-8, trimmed. Only for textual output. */
function gitText(out: Buffer): string {
  return out.toString("utf8").trim();
}

/** Split NUL-terminated `-z` git output into its (byte-exact) entries. */
function splitNul(bytes: Buffer): Buffer[] {
  const entries: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) {
      entries.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < bytes.length) entries.push(bytes.subarray(start));
  return entries;
}

/** Run git with a fixed timeout, redacting credentials from whatever escapes. */
function runGit(cwd: string, args: string[], input?: Uint8Array): GitOk {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "buffer",
      stdio: ["pipe", "pipe", "pipe"],
      input,
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout as Buffer, stderr: "" };
  } catch (error) {
    const failure = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const rawStderr = typeof failure.stderr === "string" ? failure.stderr : failure.stderr?.toString("utf8") ?? "";
    const stderr = redactGitDiagnostics(rawStderr.trim() || String(failure.message ?? "git failed"));
    return {
      ok: false,
      stdout: typeof failure.stdout === "string" ? Buffer.from(failure.stdout, "utf8") : Buffer.from(failure.stdout ?? ""),
      stderr,
    };
  }
}

/** The git state of the worktree that the bundle must record. */
export interface WorktreeGitState {
  branch: string | null;
  head_sha: string;
  base_sha: string;
  remote_url: string | null;
}

/** Read branch, head, merge base and remote url of a worktree's checkout. */
export function readWorktreeGitState(worktreePath: string): WorktreeGitState {
  const branch = runGit(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branchName = branch.ok && gitText(branch.stdout) !== "HEAD" ? gitText(branch.stdout) : null;

  const head = runGit(worktreePath, ["rev-parse", "HEAD"]);
  const head_sha = head.ok ? gitText(head.stdout) : "";
  if (!head_sha) {
    syncFail("WORKTREE_NOT_FOUND", "the directory is not a git checkout", { path: worktreePath });
  }

  // The base is the merge base with the tracking upstream when one exists, so a
  // pull can reason about how far the worktree has drifted; otherwise the head
  // itself is the base (there is no upstream to fork from).
  let base_sha = head_sha;
  if (branchName) {
    const base = runGit(worktreePath, ["merge-base", "HEAD", "@{upstream}"]);
    if (base.ok && /^[0-9a-f]{40,64}$/.test(gitText(base.stdout))) base_sha = gitText(base.stdout);
  }

  const remote = runGit(worktreePath, ["config", "--get", "remote.origin.url"]);
  return {
    branch: branchName,
    head_sha,
    base_sha,
    remote_url: remote.ok ? gitText(remote.stdout) : null,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ── the bundle: what git does not carry, packed deterministically ───────────

export interface SyncBundlePart {
  /** Relative path inside the bundle: `worktree.patch`, `untracked/<rel>`, `stash.list`. */
  path: string;
  bytes: Uint8Array;
  /** POSIX mode of the source file (0 for synthetic parts). */
  mode: number;
}

export interface SyncBundle {
  /** The gzipped container. The sha256 is the identity. */
  bytes: Uint8Array;
  sha256: string;
  /** Uncompressed byte size of the parts payload (index included). */
  unpackedByteSize: number;
  /** Part paths, sorted. */
  paths: string[];
}

export interface WorktreeSyncManifest {
  schema: typeof WORKTREE_SYNC_SCHEMA;
  app: "repos";
  kind: "worktree";
  repo_name: string;
  worktree_name: string;
  version: string;
  branch: string | null;
  head_sha: string;
  base_sha: string;
  remote_url: string | null;
  bundle_sha256: string;
  bundle_byte_size: number;
  unpacked_byte_size: number;
  includes: { patch: boolean; untracked: number; stash: number };
  machine_id: string;
  agent: string;
  packed_at: string;
}

export interface PackedWorktree {
  manifest: WorktreeSyncManifest;
  bundle: SyncBundle;
}

/** Credential-shaped filenames excluded from the untracked set at any depth. */
const CREDENTIAL_FILENAMES = new Set([
  ".env",
  ".envrc",
  ".netrc",
  ".pgpass",
  ".git-credentials",
  "credentials",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

function isCredentialFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith(".env.")) return true;
  if (
    lower.startsWith("env.")
    && !["ts", "js", "mjs", "cjs", "json", "yaml", "yml", "example", "sample", "template", "dist"].includes(lower.slice(4))
  ) {
    return true;
  }
  if (CREDENTIAL_FILENAMES.has(lower)) return true;
  return [".pem", ".key", ".p12", ".pfx", ".keystore"].some((ext) => lower.endsWith(ext));
}

/**
 * Pack a worktree's git-external state into a deterministic bundle.
 *
 * The container is deliberately tiny and hand-rolled rather than a tar:
 * `parts.json` (sorted index with per-part sha256/size/mode) followed by the
 * part bytes themselves, each length-prefixed with an 8-byte big-endian size.
 * No timestamps, no uid/gid, no filenames in the payload framing — the bytes
 * depend only on the content, so the sha256 is a reproducible content address
 * across stations (the same argument the skills kit makes in #1639).
 *
 * The packing is fail-closed: a plumbing command that ERRORS is a hard
 * REMOTE_FAILED, never an empty part. `runGit` caps stdout at 64 MB, and a
 * worktree whose diff or untracked listing exceeds the cap fails the same way
 * — a push must never publish a version whose uncommitted state was silently
 * dropped (a git failure and "no output" are distinguishable here by design).
 */
export function packWorktreeSyncBundle(worktreePath: string): SyncBundle {
  const parts: SyncBundlePart[] = [];

  // Uncommitted tracked changes: staged + unstaged, binary-safe. This is the
  // state git's remote refuses to carry.
  const patch = runGit(worktreePath, ["diff", "--binary", "HEAD"]);
  if (!patch.ok) {
    syncFail("REMOTE_FAILED", "git diff --binary HEAD failed while packing the worktree", {
      path: worktreePath,
      git_stderr: patch.stderr,
      hint: "a push must never silently drop the worktree's uncommitted state; fix the git error and retry",
    });
  }
  if (patch.stdout.length > 0) {
    // The diff bytes are carried verbatim (no UTF-8 decode — changed lines of
    // legacy-encoded text files may hold arbitrary bytes). A patch that lost
    // its trailing newline is rejected by `git apply` as corrupt ("corrupt
    // patch at line N"), so the final newline is guaranteed here, once.
    const patchBytes =
      patch.stdout[patch.stdout.length - 1] === 0x0a
        ? patch.stdout
        : concatBytes([patch.stdout, new Uint8Array([0x0a])]);
    parts.push({ path: "worktree.patch", bytes: patchBytes, mode: 0 });
  }

  // Untracked files that survive the repo's own ignore rules (git's answer is
  // authoritative for "should this be content"), minus credential-shaped names.
  const untracked = runGit(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!untracked.ok) {
    syncFail("REMOTE_FAILED", "git ls-files failed while packing the worktree's untracked files", {
      path: worktreePath,
      git_stderr: untracked.stderr,
      hint: "a push must never silently drop untracked files; fix the git error and retry",
    });
  }
  if (untracked.stdout.length > 0) {
    for (const nameBytes of splitNul(untracked.stdout)) {
      if (nameBytes.length === 0) continue;
      // Names come from `-z` as raw bytes and must not be decoded lossily: a
      // name that is not valid UTF-8 cannot live in the bundle's JSON index —
      // nor be created faithfully on this UTF-8 filesystem — so the pack
      // refuses loudly instead of silently dropping the file (or corrupting
      // its name on pull).
      const name = nameBytes.toString("utf8");
      if (!nameBytes.equals(Buffer.from(name, "utf8"))) {
        syncFail("REMOTE_FAILED", "an untracked file name is not valid UTF-8 and cannot be packed faithfully", {
          path: worktreePath,
          name_hex: nameBytes.toString("hex"),
          hint: "rename the offending file to a UTF-8 name and push again",
        });
      }
      if (isCredentialFileName(name)) continue;
      const absolute = join(worktreePath, name);
      let mode = 0;
      try {
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink()) continue;
        if (!stat.isFile()) continue;
        mode = stat.mode & 0o777;
      } catch {
        continue; // vanished between listing and packing, or unreadable
      }
      const bytes = new Uint8Array(readFileSync(absolute));
      if (bytes.byteLength === 0 && mode === 0) continue;
      parts.push({ path: `untracked/${name}`, bytes, mode: mode || 0o644 });
    }
  }

  // The stash list is descriptive: recorded so the state is not lost, never
  // auto-applied on pull (applying a stash whose base is gone is a conflict
  // generator, and a silent apply would be exactly the "silent overwrite" this
  // module refuses to do). A failure here is still fail-closed — the same
  // "error vs empty output" distinction as the parts above.
  const stash = runGit(worktreePath, ["stash", "list"]);
  if (!stash.ok) {
    syncFail("REMOTE_FAILED", "git stash list failed while packing the worktree", {
      path: worktreePath,
      git_stderr: stash.stderr,
      hint: "fix the git error and retry; the stash list is recorded so the state is not lost",
    });
  }
  const stashText = gitText(stash.stdout);
  const stashCount = stashText.length > 0 ? stashText.split("\n").length : 0;
  if (stashCount > 0) {
    parts.push({ path: "stash.list", bytes: new TextEncoder().encode(stashText), mode: 0 });
  }

  parts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const index = JSON.stringify(
    parts.map((part) => ({ path: part.path, sha256: sha256Hex(part.bytes), size: part.bytes.byteLength, mode: part.mode })),
    null,
    2,
  );
  // The index is framed by its own u32 length prefix — unambiguous by
  // construction, with no content-scanning in the unpacker — followed by the
  // parts, each framed by an 8-byte big-endian size.
  const indexBytes = new TextEncoder().encode(index);
  const indexFrame = new Uint8Array(4);
  new DataView(indexFrame.buffer).setUint32(0, indexBytes.byteLength);
  const payload = concatBytes([indexFrame, indexBytes, ...parts.map((part) => framePart(part.bytes))]);

  const bytes = gzipSync(payload, { level: GZIP_LEVEL });
  return {
    bytes,
    sha256: sha256Hex(bytes),
    unpackedByteSize: payload.byteLength,
    paths: parts.map((part) => part.path),
  };
}

function framePart(bytes: Uint8Array): Uint8Array {
  const header = new Uint8Array(8);
  new DataView(header.buffer).setBigUint64(0, BigInt(bytes.byteLength));
  return concatBytes([header, bytes]);
}

interface IndexEntry {
  path: string;
  sha256: string;
  size: number;
  mode: number;
}

/**
 * Unpack a bundle, verifying every part's sha256 against the embedded index.
 * Any deviation — bad gzip, truncated framing, a part whose digest disagrees —
 * is a hard BUNDLE_VERIFICATION_FAILED, never a silent partial restore.
 */
export function unpackWorktreeSyncBundle(bytes: Uint8Array): Map<string, SyncBundlePart> {
  let payload: Uint8Array;
  try {
    payload = gunzipSync(bytes);
  } catch {
    syncFail("BUNDLE_VERIFICATION_FAILED", "bundle is not a valid gzip container");
  }

  // Frame: u32 index length, index JSON, then each part framed by an 8-byte
  // big-endian size. The index declares how many parts to expect; a payload
  // that runs out early is truncated, one with surplus bytes is corrupt.
  if (payload.byteLength < 4) syncFail("BUNDLE_VERIFICATION_FAILED", "bundle payload is truncated");
  const indexLength = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0);
  const indexEnd = 4 + indexLength;
  if (payload.byteLength < indexEnd) syncFail("BUNDLE_VERIFICATION_FAILED", "bundle index is truncated");

  let index: IndexEntry[];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload.subarray(4, indexEnd))) as IndexEntry[];
    if (!Array.isArray(parsed)) syncFail("BUNDLE_VERIFICATION_FAILED", "bundle index is corrupt");
    index = parsed;
  } catch {
    syncFail("BUNDLE_VERIFICATION_FAILED", "bundle index is corrupt");
  }

  const parts = new Map<string, SyncBundlePart>();
  let cursor = payload.subarray(indexEnd);
  for (const entry of index) {
    if (cursor.byteLength < 8) syncFail("BUNDLE_VERIFICATION_FAILED", "bundle payload is truncated");
    const size = Number(new DataView(cursor.buffer, cursor.byteOffset, 8).getBigUint64(0));
    cursor = cursor.subarray(8);
    if (cursor.byteLength < size) syncFail("BUNDLE_VERIFICATION_FAILED", `bundle payload is truncated at ${entry.path}`);
    const partBytes = cursor.subarray(0, size);
    cursor = cursor.subarray(size);
    if (sha256Hex(partBytes) !== entry.sha256) {
      syncFail("BUNDLE_VERIFICATION_FAILED", `bundle part ${entry.path} failed its sha256 verification`);
    }
    parts.set(entry.path, { path: entry.path, bytes: new Uint8Array(partBytes), mode: entry.mode });
  }
  return parts;
}

function concatBytes(views: Uint8Array[]): Uint8Array {
  const total = views.reduce((sum, view) => sum + view.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const view of views) {
    out.set(view, offset);
    offset += view.byteLength;
  }
  return out;
}

// ── the S3 artifact remote ───────────────────────────────────────────────────

/**
 * The slice of the AWS client the remote uses; injectable so tests stand in an
 * in-memory bucket. The real client is constructed from a dynamic import only
 * when a bucket is configured, so a station without `REPOS_S3_BUCKET` never
 * loads the SDK.
 */
export interface S3ClientLike {
  send(command: unknown): Promise<{ Body?: unknown; Contents?: Array<{ Key?: string }> }>;
}

/**
 * The command constructors the remote builds. `any` is confined to this
 * injectable boundary on purpose: the real SDK's per-command input types are
 * structurally wider and narrower than the handful of fields this module
 * touches, and the fake client in tests routes on input shape, so the seam is
 * the only place either shape is seen.
 */
type CommandSet = {
  put: new (input: any) => unknown;
  get: new (input: any) => unknown;
  list: new (input: any) => unknown;
};

export interface WorktreeRemoteOptions {
  bucket?: string;
  prefix?: string;
  /** AWS region for the lazily constructed real client; `AWS_REGION`, default `us-east-1`. */
  region?: string;
  /** Overrides the real S3 client (tests). When omitted and a bucket is configured, the real client is constructed lazily on first use. */
  client?: S3ClientLike;
}

export class WorktreeSyncRemote {
  private bucket?: string;
  private prefix: string;
  private region?: string;
  private s3?: S3ClientLike;
  /** Lazily resolved command constructors; undefined until the SDK is needed. */
  private commands?: CommandSet;

  constructor(options: WorktreeRemoteOptions = {}) {
    this.bucket = options.bucket;
    this.prefix = (options.prefix || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, "");
    this.region = options.region;
    this.s3 = options.client;
  }

  /**
   * True when a bucket is configured, so the verbs may proceed. The real
   * client is not constructed here: when no client was injected it is built
   * lazily in {@link requireClient} from the region and the standard AWS
   * credential chain, so a station without `REPOS_S3_BUCKET` never loads the
   * AWS SDK.
   */
  get usesS3(): boolean {
    return Boolean(this.bucket);
  }

  /**
   * Object key for one version's bundle or manifest:
   * `worktrees/<repo_name>/<worktree_name>/<version>/<file>`. Versions are
   * immutable: writing the same version twice is the same object, and nothing
   * in this module ever deletes or overwrites a published version. This is the
   * shape the issue's acceptance names: objects under
   * `worktrees/<repo_id>/<worktree_name>/<version>/`.
   */
  fileKeyFor(repoName: string, worktreeName: string, version: string, file: "bundle.tar.gz" | "manifest.json"): string {
    return `${this.prefix}/${encodeURIComponent(repoName)}/${encodeURIComponent(worktreeName)}/${encodeURIComponent(version)}/${file}`;
  }

  /** Publish one immutable version (bundle + manifest). */
  async pushVersion(packed: PackedWorktree): Promise<{ storageKey: string }> {
    const commands = await this.requireClient();
    await this.s3!.send(new commands.put({
      Bucket: this.bucket,
      Key: this.fileKeyFor(packed.manifest.repo_name, packed.manifest.worktree_name, packed.manifest.version, "bundle.tar.gz"),
      Body: packed.bundle.bytes,
      ContentType: "application/gzip",
    }));
    await this.s3!.send(new commands.put({
      Bucket: this.bucket,
      Key: this.fileKeyFor(packed.manifest.repo_name, packed.manifest.worktree_name, packed.manifest.version, "manifest.json"),
      Body: new TextEncoder().encode(JSON.stringify(packed.manifest, null, 2)),
      ContentType: "application/json",
    }));
    return {
      storageKey: this.fileKeyFor(packed.manifest.repo_name, packed.manifest.worktree_name, packed.manifest.version, "bundle.tar.gz"),
    };
  }

  /** List published versions, newest first (RFC 3339 sorts lexicographically). */
  async listVersions(repoName: string, worktreeName: string): Promise<WorktreeSyncManifest[]> {
    const commands = await this.requireClient();
    const response = await this.s3!.send(new commands.list({
      Bucket: this.bucket,
      Prefix: `${this.prefix}/${encodeURIComponent(repoName)}/${encodeURIComponent(worktreeName)}/`,
    }));
    const keys = (response.Contents ?? [])
      .map((entry) => entry.Key ?? "")
      .filter((key) => key.endsWith("/manifest.json"));
    const manifests: WorktreeSyncManifest[] = [];
    for (const key of keys) {
      const version = key.split("/").at(-2);
      if (!version) continue;
      const decoded = decodeURIComponent(version);
      const fetched = await this.fetchVersion(repoName, worktreeName, decoded);
      if (fetched) manifests.push(fetched.manifest);
    }
    return manifests.sort((a, b) => (a.version < b.version ? 1 : a.version > b.version ? -1 : 0));
  }

  /** Fetch one version's manifest, or null when the version has no manifest object. */
  async fetchManifest(repoName: string, worktreeName: string, version: string): Promise<WorktreeSyncManifest | null> {
    const commands = await this.requireClient();
    const response = await this.s3!.send(new commands.get({
      Bucket: this.bucket,
      Key: this.fileKeyFor(repoName, worktreeName, version, "manifest.json"),
    }));
    const body = await bodyBytes(response.Body);
    if (body.byteLength === 0) return null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body)) as WorktreeSyncManifest;
      if (parsed.schema !== WORKTREE_SYNC_SCHEMA) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Fetch a version's bundle and verify its sha256 against the manifest —
   * the digest is the identity, and a bundle whose sha256 does not verify is
   * refused, never silently accepted.
   */
  async fetchVersion(
    repoName: string,
    worktreeName: string,
    version: string,
  ): Promise<{ manifest: WorktreeSyncManifest; bundleBytes: Uint8Array } | null> {
    const manifest = await this.fetchManifest(repoName, worktreeName, version);
    if (!manifest) return null;
    const commands = await this.requireClient();
    const response = await this.s3!.send(new commands.get({
      Bucket: this.bucket,
      Key: this.fileKeyFor(repoName, worktreeName, version, "bundle.tar.gz"),
    }));
    const bundleBytes = await bodyBytes(response.Body);
    const actual = sha256Hex(bundleBytes);
    if (actual !== manifest.bundle_sha256) {
      syncFail("BUNDLE_VERIFICATION_FAILED", "bundle sha256 does not match the manifest", {
        version,
        expected: manifest.bundle_sha256,
        actual,
      });
    }
    return { manifest, bundleBytes };
  }

  private async requireClient(): Promise<CommandSet> {
    if (!this.bucket) {
      syncFail(
        "REMOTE_NOT_CONFIGURED",
        `no artifact remote is configured: set ${REPOS_S3_BUCKET_ENV} to the app's S3 bucket`,
        {
          hint: "the bucket and task role are the infra follow-up for hasna/apps#1689; without a bucket every worktree-sync verb fails closed",
        },
      );
    }
    if (!this.s3) {
      // Production path: when a bucket is configured and no client was
      // injected (tests), the real client is constructed lazily on first use.
      // The dynamic import keeps a station without REPOS_S3_BUCKET from ever
      // loading the AWS SDK; the region was resolved from AWS_REGION (default
      // us-east-1) and credentials come from the standard AWS credential chain
      // when a command is actually sent.
      try {
        const sdk = await import("@aws-sdk/client-s3");
        this.s3 = new sdk.S3Client({
          region: this.region ?? process.env["AWS_REGION"] ?? "us-east-1",
        }) as unknown as S3ClientLike;
        this.commands = {
          put: sdk.PutObjectCommand,
          get: sdk.GetObjectCommand,
          list: sdk.ListObjectsV2Command,
        };
      } catch (error) {
        syncFail(
          "REMOTE_NOT_CONFIGURED",
          "the S3 client could not be constructed from the configured bucket",
          {
            hint:
              `@aws-sdk/client-s3 is an optional dependency of @hasna/repos: install the package ` +
              `(or unset ${REPOS_S3_BUCKET_ENV}) before using the worktree artifact remote`,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    let commands = this.commands;
    if (!commands) {
      // A client was injected (tests) but commands are not yet resolved:
      // loaded lazily so a station without a bucket never loads the AWS SDK.
      const sdk = await import("@aws-sdk/client-s3");
      commands = {
        put: sdk.PutObjectCommand,
        get: sdk.GetObjectCommand,
        list: sdk.ListObjectsV2Command,
      };
      this.commands = commands;
    }
    return commands;
  }
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  if (body instanceof Uint8Array) return body;
  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    return new Uint8Array(await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }
  if (typeof (body as { getReader?: unknown }).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return concatBytes(chunks);
  }
  throw new Error("unreadable S3 object body");
}

/** Resolve the remote configuration from the environment, fail-closed. */
export function resolveWorktreeRemote(env: NodeJS.ProcessEnv = process.env): WorktreeRemoteOptions {
  const bucket = env[REPOS_S3_BUCKET_ENV];
  if (!bucket) return {};
  return { bucket, region: env["AWS_REGION"] || "us-east-1" };
}

// ── the verbs ───────────────────────────────────────────────────────────────

export interface PushWorktreeOptions {
  remote?: WorktreeSyncRemote;
  /** Explicit version; defaults to the current RFC 3339 timestamp. */
  version?: string;
  agent?: string;
}

export interface PushWorktreeResult {
  schema: typeof WORKTREE_SYNC_SCHEMA;
  repo_name: string;
  worktree_name: string;
  version: string;
  path: string;
  bundle_sha256: string;
  byte_size: number;
  packed_at: string;
  includes: { patch: boolean; untracked: number; stash: number };
}

/**
 * `repos worktree push <repo>/<name>` — pack the worktree's git-external state
 * and publish one immutable version to the artifact remote.
 */
export async function pushWorktree(
  repoName: string,
  worktreeName: string,
  options: PushWorktreeOptions = {},
): Promise<PushWorktreeResult> {
  const remote = options.remote ?? new WorktreeSyncRemote(resolveWorktreeRemote());
  if (!remote.usesS3) {
    syncFail(
      "REMOTE_NOT_CONFIGURED",
      `no artifact remote is configured: set ${REPOS_S3_BUCKET_ENV} to the app's S3 bucket`,
      { hint: "push refuses to run without a bucket — there must never be a silent local-only version" },
    );
  }

  const path = computeWorktreePath(repoName, worktreeName);
  if (!existsSync(path)) {
    syncFail("WORKTREE_NOT_FOUND", "no worktree at the canonical path", {
      path,
      repo: repoName,
      name: worktreeName,
      hint: "create it first with `repos worktree add <repo> --name <name>` (or `--task <id>`)",
    });
  }

  const state = readWorktreeGitState(path);
  const bundle = packWorktreeSyncBundle(path);
  const manifest: WorktreeSyncManifest = {
    schema: WORKTREE_SYNC_SCHEMA,
    app: "repos",
    kind: "worktree",
    repo_name: repoName,
    worktree_name: worktreeName,
    version: options.version ?? nowVersion(),
    branch: state.branch,
    head_sha: state.head_sha,
    base_sha: state.base_sha,
    remote_url: state.remote_url,
    bundle_sha256: bundle.sha256,
    bundle_byte_size: bundle.bytes.byteLength,
    unpacked_byte_size: bundle.unpackedByteSize,
    includes: {
      patch: bundle.paths.includes("worktree.patch"),
      untracked: bundle.paths.filter((p) => p.startsWith("untracked/")).length,
      stash: bundle.paths.includes("stash.list") ? 1 : 0,
    },
    machine_id: getSourceMachineId(),
    agent: options.agent ?? "repos-cli",
    packed_at: new Date().toISOString(),
  };

  await remote.pushVersion({ manifest, bundle });

  return {
    schema: WORKTREE_SYNC_SCHEMA,
    repo_name: repoName,
    worktree_name: worktreeName,
    version: manifest.version,
    path,
    bundle_sha256: bundle.sha256,
    byte_size: bundle.bytes.byteLength,
    packed_at: manifest.packed_at,
    includes: manifest.includes,
  };
}

export interface PullWorktreeOptions {
  remote?: WorktreeSyncRemote;
  /** Exact version to pull; defaults to the newest published version. */
  version?: string;
  /**
   * The parent checkout to materialise against. Probe escape hatch for a fresh
   * station (no local registry yet — the hosted registry is #1663): when
   * omitted, the local db is consulted, and when no row exists either, pull
   * fails closed with a hint to pass this option.
   */
  parentCheckout?: string;
}

export interface PullWorktreeResult {
  schema: typeof WORKTREE_SYNC_SCHEMA;
  repo_name: string;
  worktree_name: string;
  version: string;
  path: string;
  branch: string | null;
  head_sha: string;
  patch_applied: boolean;
  untracked_restored: number;
  stash_count: number;
}

/**
 * `repos worktree pull <repo>/<name>[@version]` — fetch one version's bundle,
 * verify its sha256, and materialise the worktree in the canonical path.
 */
export async function pullWorktree(
  repoName: string,
  worktreeName: string,
  options: PullWorktreeOptions = {},
): Promise<PullWorktreeResult> {
  const remote = options.remote ?? new WorktreeSyncRemote(resolveWorktreeRemote());
  const target = computeWorktreePath(repoName, worktreeName);
  if (existsSync(target)) {
    syncFail("MATERIALIZED_ALREADY", "a directory already occupies the canonical worktree path", {
      path: target,
      hint: "sync never overwrites; reconcile the existing worktree by hand or remove it first",
    });
  }

  const version = options.version ?? (await latestVersionOrFail(remote, repoName, worktreeName));
  const fetched = await remote.fetchVersion(repoName, worktreeName, version);
  if (!fetched) {
    syncFail("VERSION_NOT_FOUND", `version '${version}' does not exist on the artifact remote`, {
      version,
      repo: repoName,
      name: worktreeName,
    });
  }
  const { manifest, bundleBytes } = fetched;

  // Verify the bundle contents BEFORE touching disk; unpack is inspect-only.
  const parts = unpackWorktreeSyncBundle(bundleBytes);
  const stashCount = manifest.includes.stash;

  const parent = options.parentCheckout ?? resolveParentCheckout(repoName);
  assertParentHealthy(parent);

  // The commits live on git's remote of record; the parent must reach the
  // recorded head before the worktree can be materialised at it.
  const headPresent = runGit(parent, ["cat-file", "-e", `${manifest.head_sha}^{commit}`]);
  if (!headPresent.ok) {
    if (!manifest.remote_url) {
      syncFail("REMOTE_FAILED", `commit ${manifest.head_sha} is not in the parent checkout and the manifest records no remote url`, {
        path: parent,
        hint: "fetch the recorded head into the parent checkout first, or pass --parent-checkout",
      });
    }
    const fetchedBranch = manifest.branch
      ? runGit(parent, ["fetch", "--quiet", "origin", manifest.branch])
      : { ok: false as const, stdout: "", stderr: "no branch recorded in the manifest" };
    const fetchedSha = fetchedBranch.ok
      ? runGit(parent, ["cat-file", "-e", `${manifest.head_sha}^{commit}`])
      : runGit(parent, ["fetch", "--quiet", "--no-tags", "origin", manifest.head_sha]);
    if (!fetchedSha.ok) {
      syncFail("REMOTE_FAILED", `commit ${manifest.head_sha} could not be fetched into the parent checkout`, {
        path: parent,
        git_stderr: fetchedBranch.stderr || fetchedSha.stderr,
        hint: "the commits live on the git remote of record; make sure origin is reachable with the station's ambient git credentials",
      });
    }
  }

  mkdirSync(resolve(target, ".."), { recursive: true });

  let branchOut: string | null = manifest.branch;
  let addResult = manifest.branch
    ? runGit(parent, ["worktree", "add", "--quiet", "-b", manifest.branch, target, manifest.head_sha])
    : { ok: false as const, stdout: "", stderr: "no branch recorded" };
  if (!addResult.ok) {
    // The branch name may already be owned by the parent clone (or the fetch
    // created it); fall back to a detached checkout rather than stealing it.
    addResult = runGit(parent, ["worktree", "add", "--quiet", "--detach", target, manifest.head_sha]);
    branchOut = null;
  }
  if (!addResult.ok) {
    syncFail("REMOTE_FAILED", "git worktree add failed during materialisation", {
      path: parent,
      git_stderr: addResult.stderr,
    });
  }

  // Restore the patch (uncommitted tracked changes), then the untracked files.
  let patchApplied = false;
  const patchPart = parts.get("worktree.patch");
  if (patchPart) {
    const applied = runGit(target, ["apply", "--whitespace=nowarn", "-"], patchPart.bytes);
    if (!applied.ok) {
      syncFail("PATCH_APPLY_FAILED", "the recorded patch does not apply to the fetched head", {
        path: target,
        git_stderr: applied.stderr,
        hint: "the head diverged from the recorded base_sha; reconcile against git's remote of record",
      });
    }
    patchApplied = true;
  }

  let untrackedRestored = 0;
  const targetResolved = resolve(target);
  for (const part of parts.values()) {
    if (!part.path.startsWith("untracked/")) continue;
    const relativePath = part.path.slice("untracked/".length);
    if (!relativePath || relativePath.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) continue;
    const destination = resolve(targetResolved, relativePath);
    // Containment re-check: a hostile bundle must not escape the worktree.
    // The lexical check alone cannot hold that: mkdirSync and writeFileSync
    // FOLLOW symlinks, and the worktree.patch applied above is fully
    // writer-controlled (git apply happily materialises mode-120000 symlinks
    // from a patch), so a crafted bundle can plant a symlink named e.g. `sub`
    // pointing at an arbitrary directory of this station and then an
    // `untracked/sub/<file>` part whose write follows it out of the worktree.
    // Every existing component of the destination path is therefore lstat'ed:
    // a symlink at any depth (the final name included), or a non-directory
    // where a parent directory is required, refuses the part outright. Honest
    // packs never hit this — git ls-files does not descend symlinked
    // directories, and pack skips symlinks — so the refusal costs nothing but
    // keeps the hostile case contained.
    if (!destination.startsWith(targetResolved + "/")) continue;
    let cursor = targetResolved;
    let contained = true;
    const segments = relativePath.split("/");
    for (let i = 0; i < segments.length && contained; i += 1) {
      cursor = join(cursor, segments[i]!);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(cursor);
      } catch {
        break; // not on disk yet — mkdirSync below creates real directories only
      }
      if (stat.isSymbolicLink()) contained = false;
      else if (i < segments.length - 1 && !stat.isDirectory()) contained = false;
      else if (i === segments.length - 1 && !stat.isFile()) contained = false;
    }
    if (!contained) continue;
    mkdirSync(resolve(destination, ".."), { recursive: true });
    writeFileSync(destination, part.bytes, { mode: part.mode || 0o644 });
    untrackedRestored += 1;
  }

  return {
    schema: WORKTREE_SYNC_SCHEMA,
    repo_name: repoName,
    worktree_name: worktreeName,
    version,
    path: target,
    branch: branchOut,
    head_sha: manifest.head_sha,
    patch_applied: patchApplied,
    untracked_restored: untrackedRestored,
    stash_count: stashCount,
  };
}

async function latestVersionOrFail(remote: WorktreeSyncRemote, repoName: string, worktreeName: string): Promise<string> {
  const versions = await remote.listVersions(repoName, worktreeName);
  const newest = versions[0];
  if (!newest) {
    syncFail("VERSION_NOT_FOUND", "no published versions on the artifact remote", { repo: repoName, name: worktreeName });
  }
  return newest.version;
}

export interface ListWorktreeVersionsOptions {
  remote?: WorktreeSyncRemote;
}

export interface ListWorktreeVersionsResult {
  schema: typeof WORKTREE_SYNC_SCHEMA;
  repo_name: string;
  worktree_name: string;
  versions: Array<{
    version: string;
    packed_at: string;
    branch: string | null;
    head_sha: string;
    bundle_sha256: string;
    machine_id: string;
    agent: string;
  }>;
}

/** `repos worktree versions <repo>/<name>` — newest first. */
export async function listWorktreeVersions(
  repoName: string,
  worktreeName: string,
  options: ListWorktreeVersionsOptions = {},
): Promise<ListWorktreeVersionsResult> {
  const remote = options.remote ?? new WorktreeSyncRemote(resolveWorktreeRemote());
  const manifests = await remote.listVersions(repoName, worktreeName);
  return {
    schema: WORKTREE_SYNC_SCHEMA,
    repo_name: repoName,
    worktree_name: worktreeName,
    versions: manifests.map((manifest) => ({
      version: manifest.version,
      packed_at: manifest.packed_at,
      branch: manifest.branch,
      head_sha: manifest.head_sha,
      bundle_sha256: manifest.bundle_sha256,
      machine_id: manifest.machine_id,
      agent: manifest.agent,
    })),
  };
}

export interface SyncWorktreeOptions extends PullWorktreeOptions {
  remote?: WorktreeSyncRemote;
  agent?: string;
}

export interface SyncWorktreeResult {
  schema: typeof WORKTREE_SYNC_SCHEMA;
  repo_name: string;
  worktree_name: string;
  pushed_version: string;
  remote_latest: string;
  conflict: boolean;
  conflict_detail: string | null;
}

/**
 * `repos worktree sync <repo>/<name>` — push a new version, then re-read the
 * remote. If anything newer appeared after our push, refuse: the remote is the
 * arbiter, and sync never silently clobbers a foreign push or overwrites a
 * published version.
 */
export async function syncWorktree(
  repoName: string,
  worktreeName: string,
  options: SyncWorktreeOptions = {},
): Promise<SyncWorktreeResult> {
  const pushed = await pushWorktree(repoName, worktreeName, options);
  const versions = await listWorktreeVersions(repoName, worktreeName, options);
  const remoteLatest = versions.versions[0]?.version ?? pushed.version;
  const conflict = remoteLatest !== pushed.version;
  return {
    schema: WORKTREE_SYNC_SCHEMA,
    repo_name: repoName,
    worktree_name: worktreeName,
    pushed_version: pushed.version,
    remote_latest: remoteLatest,
    conflict,
    conflict_detail: conflict
      ? `the remote's newest version (${remoteLatest}) is not the version this sync pushed (${pushed.version}); ` +
        "refusing to pull or overwrite — inspect `repos worktree versions` and reconcile by hand"
      : null,
  };
}

// ── ref parsing and parent resolution ───────────────────────────────────────

export interface ParsedSyncRef {
  repoName: string;
  worktreeName: string;
  version?: string;
}

/** Parse `<repo>/<name>` with an optional `@<version>` suffix. Paths are refused on shape. */
export function parseSyncRef(ref: string): ParsedSyncRef {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 260 || ref.includes("\0")) {
    syncFail("WORKTREE_NOT_FOUND", "a <repo>/<worktree> reference is required (optionally <repo>/<worktree>@<version>)");
  }
  const at = ref.lastIndexOf("@");
  const refPart = at > 0 ? ref.slice(0, at) : ref;
  const version = at > 0 ? ref.slice(at + 1) : undefined;
  const parts = refPart.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    syncFail("WORKTREE_NOT_FOUND", "a sync reference must be exactly <repo>/<worktree> (optionally @<version>)", {
      name: ref.slice(0, 64),
    });
  }
  if (version !== undefined && version.length === 0) {
    syncFail("WORKTREE_NOT_FOUND", "a version after '@' must not be empty", { name: ref.slice(0, 64) });
  }
  // The canonical path computation is the single source of name validation.
  computeWorktreePath(parts[0]!, parts[1]!);
  return { repoName: parts[0]!, worktreeName: parts[1]!, version };
}

/** Resolve the parent checkout: db row when one exists, else fail closed. */
function resolveParentCheckout(repoName: string): string {
  // The local registry is consulted through the existing db boundary; a fresh
  // station without a row must pass --parent-checkout explicitly (the hosted
  // registry is #1663).
  try {
    const repo = getRepo(repoName);
    if (repo?.path) return repo.path;
  } catch {
    // db not initialised on this machine — fall through to the fail-closed path
  }
  syncFail("WORKTREE_NOT_FOUND", "no local registry row for the parent checkout", {
    repo: repoName,
    hint: "clone the repo on this station first, or pass --parent-checkout <path> explicitly",
  });
}

function assertParentHealthy(parent: string): void {
  if (!existsSync(parent)) {
    syncFail("PARENT_CHECKOUT_UNHEALTHY", "the parent checkout does not exist", { path: parent });
  }
  const probe = runGit(parent, ["rev-parse", "--is-inside-work-tree"]);
  if (!probe.ok || gitText(probe.stdout) !== "true") {
    syncFail("PARENT_CHECKOUT_UNHEALTHY", "the parent checkout is not a working git repository", {
      path: parent,
      git_stderr: probe.stderr,
    });
  }
}