import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export type ExposureScanKind = "workspace" | "history" | "staged" | "input";
export type ExposureSeverity = "high" | "medium";
export type ExposureRemediationPriority = "critical" | "high";
export type ExposureRemediationStep =
  | "verify_finding"
  | "revoke_credential"
  | "rotate_credential"
  | "remove_from_source"
  | "purge_git_history"
  | "update_dependents"
  | "rescan";

export interface ExposureRemediation {
  kind: "credential_exposure";
  priority: ExposureRemediationPriority;
  steps: ExposureRemediationStep[];
}

export interface ExposureFinding {
  /** Stable across repeated scans of the same source location. */
  id: string;
  source: ExposureScanKind;
  detector: string;
  severity: ExposureSeverity;
  path: string;
  line: number;
  column: number;
  /**
   * A constant redaction marker. It carries NO bytes from the scanned line —
   * not the matched value, and not the surrounding context either.
   *
   * This field used to be the line with only the detected spans masked. That
   * leaked two ways while `redacted: true` said otherwise. A detector whose
   * value group stops early (`credential_assignment` cannot cross `#`) left the
   * tail of the matched credential in the clear; and any secret on the line that
   * no detector recognised — a bare high-entropy value — was emitted verbatim.
   *
   * `detector`, `line` and `column` are the load-bearing outputs and locate the
   * finding without reproducing it. Read those; open the file only when you have
   * decided it is safe to.
   */
  preview: string;
  /** Copy/paste-ready location for task bodies and evidence metadata. */
  evidencePath: string;
  commit?: string;
  /**
   * Set when the finding came from a blob that is not text. `line` is always 1
   * and `column` is a 1-based BYTE OFFSET into the blob, because a PNG or a
   * sqlite file has no lines to count. Stated on the finding so a reader is
   * never left to guess which of the two coordinate systems they are holding.
   */
  binary?: true;
  remediation: ExposureRemediation;
}

/** Why a staged blob was not scanned. Every skip is reported; none is silent. */
export type ExposureSkipReason =
  | "max_file_bytes"
  | "max_bytes_scanned"
  | "max_files"
  | "unreadable";

export interface ExposureSkip {
  path: string;
  reason: ExposureSkipReason;
  bytes?: number;
}

export interface ExposureScanResult {
  schema: "open-secrets.exposure-scan.v1";
  version: 1;
  source: ExposureScanKind;
  root: string;
  redacted: true;
  limits: {
    findings: number;
    maxFileBytes?: number;
    maxFiles?: number;
    maxBytesScanned?: number;
    maxCommits?: number;
    timeoutMs?: number;
  };
  stats: {
    filesScanned: number;
    filesSkipped: number;
    bytesScanned: number;
    commitsScanned?: number;
    /**
     * Named skips, not just a count. A gate that silently declines to read a
     * staged blob reproduces the defect this scan mode exists to close, so the
     * path and the reason travel in the result and drive a non-zero exit.
     */
    skipped?: ExposureSkip[];
    errors: string[];
  };
  findings: ExposureFinding[];
  findingCount: number;
  truncated: boolean;
  truncatedReason?: "findings" | "max_files" | "max_bytes" | "max_commits" | "timeout" | "git_output";
  /** Opaque, redacted continuation token. Pass it back with the same mode/root. */
  nextCursor?: string;
}

interface Detector {
  id: string;
  severity: ExposureSeverity;
  pattern: RegExp;
  valueGroup?: number;
  // High-signal detectors whose match is a rigid, vendor-specific structure
  // (fixed prefixes, PEM markers, etc.). For these the lexical placeholder
  // blocklist ("example", "dummy", ...) must NOT suppress a match — e.g. AWS's
  // canonical published id (AKIA… …EXAMPLE) is still a real access-key shape.
  // The id is elided rather than spelled out for the same reason the patterns
  // below are assembled by token(): a literal credential shape in this file is
  // a finding in every scan of this repo, including this scanner's own.
  // Only structural placeholder checks (interpolation syntax, too short) apply.
  structuralOnly?: boolean;
}

interface MatchSpan {
  detector: Detector;
  start: number;
  end: number;
  value: string;
}

interface ScanTextContext {
  source: ExposureScanKind;
  path: string;
  commit?: string;
  binary?: boolean;
}

interface FindingPosition {
  path: string;
  line: number;
  column: number;
  detector: string;
}

interface WorkspaceCursorState {
  path: string;
  position: "before" | "after" | "finding";
  line?: number;
  column?: number;
  detector?: string;
}

interface HistoryCursorState {
  offset: number;
  commit: string;
  after?: FindingPosition;
}

interface EncodedCursor {
  version: 1;
  source: ExposureScanKind;
  root: string;
  workspace?: WorkspaceCursorState;
  history?: HistoryCursorState;
}

interface WorkspaceWalkState {
  cursor?: WorkspaceCursorState;
  cursorReached: boolean;
  lastFile?: string;
  continuation?: WorkspaceCursorState;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const DEFAULT_MAX_FILES = 5_000;
const DEFAULT_MAX_BYTES_SCANNED = 25_000_000;
const DEFAULT_MAX_COMMITS = 200;
const MAX_COMMITS = 1_000;
// Staged bounds are deliberately far looser than the workspace walk's. The
// population is one commit's worth of content rather than a whole tree, and a
// skip here is not a deferred chunk — it is a blob the gate did not read, which
// forces a non-zero exit. Bounds tight enough to trip on an ordinary asset
// commit would turn the gate into noise, and noise is how a gate gets bypassed.
const DEFAULT_STAGED_MAX_FILE_BYTES = 10_000_000;
const MAX_STAGED_MAX_FILE_BYTES = 200_000_000;
const DEFAULT_STAGED_MAX_FILES = 10_000;
const MAX_STAGED_MAX_FILES = 100_000;
const DEFAULT_STAGED_MAX_BYTES_SCANNED = 200_000_000;
// Input bounds sit far below the staged ones. The population is one command's
// output rather than a commit's worth of blobs, and the caller is typically a
// synchronous guard in front of something else — so the default is small enough
// that scanning is cheap, and exceeding it is a REFUSAL rather than a quiet
// truncation.
const DEFAULT_INPUT_MAX_BYTES = 5_000_000;
const MAX_INPUT_MAX_BYTES = 200_000_000;
const STDIN_READ_CHUNK_BYTES = 65_536;
const STDIN_LABEL = "<stdin>";
// Bytes 0x20..0x7e plus tab. Shortest detector match is 12+ characters, so an
// 8-byte floor cannot drop a run that could have carried one.
const MIN_PRINTABLE_RUN = 8;
const BINARY_DEADLINE_CHECK_STRIDE = 65_536;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const GIT_BUFFER_BYTES = 512 * 1024;
const ERROR_MAX_LENGTH = 500;
const MAX_CURSOR_LENGTH = 4_096;
const REDACTED = "***REDACTED***";

const EXCLUDED_DIRS = new Set([
  ".git",
  ".hasna",
  ".secrets",
  ".connect",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
]);

const EXCLUDED_EXTENSIONS = new Set([
  ".db",
  ".sqlite",
  ".sqlite3",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".zip",
  ".gz",
  ".tgz",
]);

const token = (...parts: string[]): string => parts.join("");

const DETECTORS: Detector[] = [
  {
    id: "anthropic_api_key",
    severity: "high",
    structuralOnly: true,
    pattern: new RegExp(`${token("sk", "-", "ant", "-")}[A-Za-z0-9_-]{12,}`, "g"),
  },
  {
    id: "openai_api_key",
    severity: "high",
    structuralOnly: true,
    pattern: new RegExp(`(?:^|[^A-Za-z0-9_])(${token("sk", "-")}(?:${token("proj", "-")})?[A-Za-z0-9_-]{12,})`, "g"),
    valueGroup: 1,
  },
  {
    id: "stripe_secret_key",
    severity: "high",
    structuralOnly: true,
    // Stripe secret ("sk_") and restricted ("rk_") keys, live or test. These
    // use an underscore, so the openai "sk-" detector never matched them.
    pattern: new RegExp(`${token("[sr]", "k", "_")}(?:live|test)${token("_")}[0-9A-Za-z]{10,}`, "g"),
  },
  {
    id: "private_key_block",
    severity: "high",
    structuralOnly: true,
    // PEM private-key markers (RSA/EC/DSA/OPENSSH/ENCRYPTED/plain PKCS#8).
    pattern: new RegExp(`${token("---", "--")}BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY${token("---", "--")}`, "g"),
  },
  {
    id: "github_token",
    severity: "high",
    structuralOnly: true,
    pattern: new RegExp(`${token("gh", "[opusr]", "_")}[A-Za-z0-9_]{12,}`, "g"),
  },
  {
    id: "package_registry_token",
    severity: "high",
    structuralOnly: true,
    pattern: new RegExp(`${token("npm", "_")}[A-Za-z0-9_]{12,}`, "g"),
  },
  {
    id: "google_api_key",
    severity: "high",
    structuralOnly: true,
    pattern: new RegExp(`${token("AI", "za")}[A-Za-z0-9_-]{20,}`, "g"),
  },
  {
    id: "aws_access_key_id",
    severity: "high",
    structuralOnly: true,
    pattern: new RegExp(`${token("AK", "IA")}[0-9A-Z]{12,}`, "g"),
  },
  {
    id: "xai_api_key",
    severity: "high",
    structuralOnly: true,
    // Value-shaped only: the vendor's published shape (xai-org/xai-proto
    // .gitleaks.toml) is xai-[a-z0-9]{20,80} (case-insensitive). Model ids
    // are hyphenated words after the prefix and must not match; matching on
    // the bare 'xai-' prefix blocked commits on files containing no
    // credential (bug a869386e).
    pattern: new RegExp(`${token("x", "ai", "-")}[A-Za-z0-9]{20,80}`, "g"),
  },
  {
    id: "context7_api_key",
    severity: "high",
    structuralOnly: true,
    pattern: new RegExp(`${token("ctx", "7", "sk", "-")}[A-Za-z0-9_-]{12,}`, "g"),
  },
  {
    id: "secret_token_header",
    severity: "high",
    pattern: new RegExp(`${token("secret", "-", "token", ":")}[^\\s'"]{8,}`, "gi"),
  },
  {
    id: "credential_assignment",
    severity: "medium",
    pattern: /\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|PASSWORD|PASSWD|PWD|DATABASE_URL|PRIVATE[_-]?KEY|TOKEN))\s*=\s*(['"]?)([^'"\s#]{8,})\2/g,
    valueGroup: 3,
  },
];

const GIT_GREP_PATTERN = [
  `${token("sk", "-", "ant", "-")}[A-Za-z0-9_-]{12,}`,
  `(^|[^A-Za-z0-9_])${token("sk", "-")}(${token("proj", "-")})?[A-Za-z0-9_-]{12,}`,
  `${token("[sr]", "k", "_")}(live|test)${token("_")}[0-9A-Za-z]{10,}`,
  `${token("---", "--")}BEGIN ([A-Z0-9]+ )*PRIVATE KEY${token("---", "--")}`,
  `${token("gh", "[opusr]", "_")}[A-Za-z0-9_]{12,}`,
  `${token("npm", "_")}[A-Za-z0-9_]{12,}`,
  `${token("AI", "za")}[A-Za-z0-9_-]{20,}`,
  `${token("AK", "IA")}[0-9A-Z]{12,}`,
  `${token("x", "ai", "-")}[A-Za-z0-9]{20,80}`,
  `${token("ctx", "7", "sk", "-")}[A-Za-z0-9_-]{12,}`,
  `${token("secret", "-", "token", ":")}[^[:space:]'"]{8,}`,
  "[A-Z0-9_]*(API_KEY|APIKEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|PASSWD|PWD|DATABASE_URL|PRIVATE_KEY|TOKEN)[[:space:]]*=[[:space:]]*['\"]?[^'\"#[:space:]]{8,}",
].join("|");

export interface WorkspaceExposureScanOptions {
  root?: string;
  cursor?: string;
  limit?: number;
  maxFileBytes?: number;
  maxFiles?: number;
  maxBytesScanned?: number;
  timeoutMs?: number;
}

export interface HistoryExposureScanOptions {
  root?: string;
  cursor?: string;
  limit?: number;
  maxCommits?: number;
  timeoutMs?: number;
}

export interface StagedExposureScanOptions {
  /** Any path inside the repository. Used to LOCATE the repo, not to narrow it. */
  root?: string;
  /**
   * Opt in to scanning only the subtree under `root` instead of the whole
   * staged set. Off by default, and deliberately so: `git commit` from a
   * subdirectory still commits every staged blob in the repository, so a gate
   * that quietly inherited the caller's cwd would pass commits the shell
   * one-liner it replaces would have caught. Scoping narrower than the commit
   * has to be asked for.
   */
  subtree?: boolean;
  limit?: number;
  maxFileBytes?: number;
  maxFiles?: number;
  maxBytesScanned?: number;
  timeoutMs?: number;
}

/**
 * Text or bytes handed in directly, rather than discovered by walking a tree.
 *
 * Exactly one source is used, in this order: `buffer`, `text`, `path`, stdin.
 * `path` of "-" means stdin, matching the CLI convention.
 */
export interface InputExposureScanOptions {
  /** Raw bytes. Scanned binary-aware, exactly as a staged blob would be. */
  buffer?: Buffer;
  /** Text to scan. */
  text?: string;
  /** File to read, or "-" for stdin. Omit both this and text/buffer to read stdin. */
  path?: string;
  limit?: number;
  /**
   * Ceiling on the input. Exceeding it records a skip and drives exit 2 — the
   * input is never scanned in part and reported as if it were scanned whole.
   */
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Exit code for a scan used as a gate — staged blobs before a commit, or
 * arbitrary input before it is persisted.
 *
 *   0  read the whole input, found nothing           -> safe to proceed
 *   1  found at least one exposure                   -> block
 *   2  could not read everything, found nothing      -> block
 *
 * 2 exists because "I looked at everything and it was clean" and "I could not
 * look" must not share an exit code. A gate that inspects nothing and a gate
 * that inspects everything and finds nothing are byte-identical from outside
 * unless the incomplete case is given its own answer.
 */
export function stagedScanExitCode(result: ExposureScanResult): 0 | 1 | 2 {
  if (result.findingCount > 0) return 1;
  if (result.truncated) return 2;
  if (result.stats.errors.length > 0) return 2;
  if ((result.stats.skipped?.length ?? 0) > 0) return 2;
  return 0;
}

export function scanWorkspaceExposures(options: WorkspaceExposureScanOptions = {}): ExposureScanResult {
  const root = resolve(options.root ?? process.cwd());
  const limit = normalizeLimit(options.limit);
  const maxFileBytes = normalizePositiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES);
  const maxFiles = normalizePositiveInteger(options.maxFiles, DEFAULT_MAX_FILES, DEFAULT_MAX_FILES);
  const maxBytesScanned = normalizePositiveInteger(
    options.maxBytesScanned,
    DEFAULT_MAX_BYTES_SCANNED,
    DEFAULT_MAX_BYTES_SCANNED,
  );
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;
  const result = createResult("workspace", root, limit, { maxFileBytes, maxFiles, maxBytesScanned, timeoutMs });

  if (!existsSync(root)) {
    pushError(result, `Root does not exist: ${root}`);
    return finalizeResult(result);
  }

  const decoded = decodeCursor(options.cursor, "workspace", root);
  if (!decoded.ok) {
    pushError(result, decoded.error);
    return finalizeResult(result);
  }
  const state: WorkspaceWalkState = {
    cursor: decoded.cursor?.workspace,
    cursorReached: !decoded.cursor,
  };
  walkWorkspace(root, root, { maxFileBytes, maxFiles, maxBytesScanned, deadline }, result, state);
  if (state.cursor && !state.cursorReached && !result.truncated) {
    pushError(result, "Cursor no longer matches the working tree; restart the scan without --cursor.");
  }
  if (result.truncatedReason === "findings" && result.findings.length > 0) {
    const last = result.findings.at(-1)!;
    state.continuation = {
      path: last.path,
      position: "finding",
      line: last.line,
      column: last.column,
      detector: last.detector,
    };
  }
  if (state.continuation) {
    result.nextCursor = encodeCursor("workspace", root, { workspace: state.continuation });
  }
  return finalizeResult(result);
}

export function scanHistoryExposures(options: HistoryExposureScanOptions = {}): ExposureScanResult {
  const requestedRoot = resolve(options.root ?? process.cwd());
  const limit = normalizeLimit(options.limit);
  const maxCommits = normalizePositiveInteger(options.maxCommits, DEFAULT_MAX_COMMITS, MAX_COMMITS);
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;
  const result = createResult("history", requestedRoot, limit, { maxCommits, timeoutMs });
  result.stats.commitsScanned = 0;
  const gitRoot = resolveGitRoot(requestedRoot, Math.max(1, deadline - Date.now()));

  if (!gitRoot) {
    pushError(result, `Not a git workspace: ${requestedRoot}`);
    return finalizeResult(result);
  }

  const decoded = decodeCursor(options.cursor, "history", requestedRoot);
  if (!decoded.ok) {
    pushError(result, decoded.error);
    return finalizeResult(result);
  }
  const cursor = decoded.cursor?.history;
  const offset = cursor?.offset ?? 0;

  const pathspec = gitPathspecForRoot(gitRoot, requestedRoot);
  const commits = runGit(gitRoot, [
    "log",
    "--all",
    "--format=%H",
    `--skip=${offset}`,
    `--max-count=${maxCommits + 1}`,
    "--",
    pathspec,
  ], { timeoutMs: Math.max(1, deadline - Date.now()) });
  if (commits.error?.code === "ETIMEDOUT") {
    markTruncated(result, "timeout");
    pushError(result, "Timed out while listing git commits.");
    return finalizeResult(result);
  }
  if (commits.status !== 0) {
    pushError(result, trimError(commits.stderr) || "Unable to list git commits.");
    return finalizeResult(result);
  }

  const commitList = commits.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (cursor && commitList[0] !== cursor.commit) {
    pushError(result, "Cursor no longer matches git history; restart the scan without --cursor.");
    return finalizeResult(result);
  }

  const chunkCommits = commitList.slice(0, maxCommits);
  for (let commitIndex = 0; commitIndex < chunkCommits.length; commitIndex++) {
    const commit = chunkCommits[commitIndex]!;
    if (result.truncated) break;
    if (Date.now() > deadline) {
      markTruncated(result, "timeout");
      result.nextCursor = encodeCursor("history", requestedRoot, {
        history: { offset: offset + commitIndex, commit },
      });
      break;
    }
    result.stats.commitsScanned = (result.stats.commitsScanned ?? 0) + 1;
    const grep = runGit(gitRoot, [
      "grep",
      "-I",
      "-n",
      "-E",
      GIT_GREP_PATTERN,
      commit,
      "--",
      pathspec,
      ":(exclude).hasna/**",
      ":(exclude).git/**",
      ":(exclude)node_modules/**",
      ":(exclude)dist/**",
      ":(exclude)build/**",
      ":(exclude)coverage/**",
      ":(exclude)*.db",
      ":(exclude)*.sqlite",
      ":(exclude)*.sqlite3",
      ":(exclude)*.png",
      ":(exclude)*.zip",
    ], { maxBuffer: GIT_BUFFER_BYTES, timeoutMs: Math.max(1, deadline - Date.now()) });

    if (grep.status === 1 && !grep.stdout) continue;
    if (grep.error) {
      if (grep.error.code === "ENOBUFS") markTruncated(result, "git_output");
      else if (grep.error.code === "ETIMEDOUT") markTruncated(result, "timeout");
      pushError(result, grep.error.message);
      result.nextCursor = encodeCursor("history", requestedRoot, {
        history: { offset: offset + commitIndex, commit },
      });
      continue;
    }
    if (grep.status !== 0 && grep.status !== 1) {
      pushError(result, trimError(grep.stderr) || `git grep failed for ${commit}`);
      continue;
    }

    for (const line of grep.stdout.split("\n")) {
      if (!line || result.truncated) continue;
      if (Date.now() > deadline) {
        const last = result.findings.at(-1);
        markTruncated(result, "timeout");
        result.nextCursor = encodeCursor("history", requestedRoot, {
          history: {
            offset: offset + commitIndex,
            commit,
            ...(last?.commit === commit ? { after: findingPosition(last) } : {}),
          },
        });
        break;
      }
      const parsed = parseGitGrepLine(line);
      if (!parsed) continue;
      if (isExcludedPath(parsed.path)) continue;
      const findingPath = relativePath(requestedRoot, resolve(gitRoot, parsed.path));
      if (isOutsideRoot(findingPath)) continue;
      scanTextLine(parsed.content, parsed.line, {
        source: "history",
        path: findingPath,
        commit,
      }, result, commitIndex === 0 ? cursor?.after : undefined);
      if (result.truncatedReason === "findings") {
        const last = result.findings.at(-1)!;
        result.nextCursor = encodeCursor("history", requestedRoot, {
          history: {
            offset: offset + commitIndex,
            commit,
            after: findingPosition(last),
          },
        });
      }
    }
  }

  if (!result.truncated && commitList.length > maxCommits) {
    const nextCommit = commitList[maxCommits]!;
    markTruncated(result, "max_commits");
    result.nextCursor = encodeCursor("history", requestedRoot, {
      history: { offset: offset + maxCommits, commit: nextCommit },
    });
  }

  return finalizeResult(result);
}

/**
 * Scan the STAGED INDEX — the exact bytes `git commit` would write.
 *
 * Two things separate this from the workspace walk, and both are the point:
 *
 * 1. It reads each path's staged BLOB (`git cat-file`), never the working-tree
 *    file and never a textual diff. Git emits no content whatsoever for a
 *    binary in a diff, so no diff-based gate can ever see a credential inside a
 *    PNG tEXt chunk, JPEG EXIF, a PDF, or a sqlite file. Reading the blob is
 *    the only thing that can, and it covers every file extension for free.
 * 2. NOTHING staged is excluded by path, directory, or extension. The workspace
 *    walk skips node_modules/dist/*.png because it is sampling a tree it does
 *    not intend to commit; everything here is about to become a commit, so an
 *    exclusion list is just a hole with a rationale attached.
 */
export function scanStagedExposures(options: StagedExposureScanOptions = {}): ExposureScanResult {
  const requestedRoot = resolve(options.root ?? process.cwd());
  const limit = normalizeLimit(options.limit);
  const maxFileBytes = normalizePositiveInteger(
    options.maxFileBytes,
    DEFAULT_STAGED_MAX_FILE_BYTES,
    MAX_STAGED_MAX_FILE_BYTES,
  );
  const maxFiles = normalizePositiveInteger(options.maxFiles, DEFAULT_STAGED_MAX_FILES, MAX_STAGED_MAX_FILES);
  const maxBytesScanned = normalizePositiveInteger(
    options.maxBytesScanned,
    DEFAULT_STAGED_MAX_BYTES_SCANNED,
    DEFAULT_STAGED_MAX_BYTES_SCANNED,
  );
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;

  // The repository root is resolved BEFORE the result is built, because the
  // default scan root IS the repository root — `root` locates the repo rather
  // than narrowing it. `result.root` then reports what was actually scanned, so
  // the output can never imply a narrower reading than the one performed.
  const gitRoot = resolveGitRoot(requestedRoot, Math.max(1, deadline - Date.now()));
  const scanRoot = gitRoot && !options.subtree ? gitRoot : requestedRoot;
  const result = createResult("staged", scanRoot, limit, {
    maxFileBytes,
    maxFiles,
    maxBytesScanned,
    timeoutMs,
  });
  result.stats.skipped = [];

  if (!gitRoot) {
    pushError(result, `Not a git workspace: ${requestedRoot}`);
    return finalizeResult(result);
  }

  // ACMRT, not the ACM that the hand-rolled shell gates use. A rename-with-edit
  // is reported as R and is therefore INVISIBLE to ACM at any extension —
  // measured on git 2.43.0: an edit that adds a line to a renamed file yields
  // an empty ACM name list and an empty ACM diff, while the staged blob plainly
  // carries the new line. T covers a symlink replaced by a regular file. D is
  // excluded because a deletion has no staged blob to read, and U because git
  // refuses to commit with unmerged paths at all.
  const names = runGit(gitRoot, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--diff-filter=ACMRT",
    "--",
    gitPathspecForRoot(gitRoot, scanRoot),
  ], { timeoutMs: Math.max(1, deadline - Date.now()) });

  if (names.error?.code === "ETIMEDOUT") {
    markTruncated(result, "timeout");
    pushError(result, "Timed out while listing staged paths.");
    return finalizeResult(result);
  }
  if (names.status !== 0) {
    pushError(result, trimError(names.stderr) || "Unable to list staged paths.");
    return finalizeResult(result);
  }

  // -z keeps paths raw: no core.quotePath mangling, and newlines in a filename
  // cannot forge an extra entry.
  const staged = names.stdout.split("\0").filter(Boolean).sort();
  if (!staged.length) return finalizeResult(result);

  const meta = stagedBlobMetadata(gitRoot, staged, Math.max(1, deadline - Date.now()));

  for (const path of staged) {
    if (result.truncated) break;
    if (Date.now() > deadline) {
      markTruncated(result, "timeout");
      break;
    }

    const findingPath = relativePath(scanRoot, resolve(gitRoot, path));
    if (isOutsideRoot(findingPath)) continue;

    const entry = meta.get(path);
    if (!entry) {
      recordSkip(result, findingPath, "unreadable");
      pushError(result, `Unable to resolve the staged blob for ${findingPath}.`);
      continue;
    }
    if (entry.size > maxFileBytes) {
      recordSkip(result, findingPath, "max_file_bytes", entry.size);
      continue;
    }
    if (result.stats.filesScanned >= maxFiles) {
      markTruncated(result, "max_files");
      recordSkip(result, findingPath, "max_files", entry.size);
      break;
    }
    if (result.stats.bytesScanned + entry.size > maxBytesScanned) {
      markTruncated(result, "max_bytes");
      recordSkip(result, findingPath, "max_bytes_scanned", entry.size);
      break;
    }

    const blob = readGitBlob(gitRoot, entry.sha, Math.max(1, deadline - Date.now()));
    if (!blob) {
      recordSkip(result, findingPath, "unreadable", entry.size);
      pushError(result, `Unable to read the staged blob for ${findingPath}.`);
      continue;
    }

    result.stats.filesScanned++;
    result.stats.bytesScanned += blob.length;

    if (!isLikelyBinary(blob)) {
      scanText(blob.toString("utf8"), { source: "staged", path: findingPath }, result, deadline);
      continue;
    }

    // A UTF-16 file is "binary" to git and to the heuristic, but it is text,
    // and it must be decoded rather than scanned as bytes — see decodeUtf16.
    const decoded = decodeUtf16(blob);
    if (decoded !== undefined) {
      scanText(decoded, { source: "staged", path: findingPath }, result, deadline);
    } else {
      scanBinaryBuffer(blob, { source: "staged", path: findingPath, binary: true }, result, deadline);
    }
  }

  return finalizeResult(result);
}

/**
 * Scan text or bytes that were handed in, rather than found on disk or in git.
 *
 * This exists so the detector set can be pointed at output BEFORE that output
 * is persisted. The tree and history modes can only ever find a credential that
 * has already been written down; a caller holding a command's stdout has the
 * one opportunity to catch it while it is still in memory.
 *
 * It deliberately knows nothing about where the text came from. No tool name,
 * no verb, no allowlist — the input side of that question is unknowable, since
 * a tool can print a credential from a verb the caller never invoked. Keying on
 * the OUTPUT is what makes this a fix rather than another list to fall behind.
 */
export function scanInputExposures(options: InputExposureScanOptions = {}): ExposureScanResult {
  const limit = normalizeLimit(options.limit);
  const maxBytes = normalizePositiveInteger(options.maxBytes, DEFAULT_INPUT_MAX_BYTES, MAX_INPUT_MAX_BYTES);
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;

  const inlined = options.buffer !== undefined || options.text !== undefined;
  const usesFile = !inlined && options.path !== undefined && options.path !== "-";
  const label = usesFile ? resolve(options.path as string) : STDIN_LABEL;

  const result = createResult("input", label, limit, { maxFileBytes: maxBytes, timeoutMs });
  result.stats.skipped = [];

  let payload: Buffer;
  if (options.buffer !== undefined) {
    payload = options.buffer;
  } else if (options.text !== undefined) {
    payload = Buffer.from(options.text, "utf8");
  } else if (usesFile) {
    let size: number;
    try {
      const stats = statSync(label);
      if (!stats.isFile()) {
        pushError(result, `Not a readable file: ${label}`);
        return finalizeResult(result);
      }
      size = stats.size;
    } catch (error) {
      pushError(result, `Unable to stat ${label}: ${(error as Error).message}`);
      return finalizeResult(result);
    }
    if (size > maxBytes) {
      recordSkip(result, label, "max_file_bytes", size);
      return finalizeResult(result);
    }
    try {
      payload = readFileSync(label);
    } catch (error) {
      pushError(result, `Unable to read ${label}: ${(error as Error).message}`);
      return finalizeResult(result);
    }
  } else {
    const read = readBoundedStdin(maxBytes, deadline);
    if (read.timedOut) {
      markTruncated(result, "timeout");
      pushError(result, "Timed out while reading standard input.");
      return finalizeResult(result);
    }
    if (read.error) {
      pushError(result, `Unable to read standard input: ${read.error}`);
      return finalizeResult(result);
    }
    if (read.oversize) {
      recordSkip(result, STDIN_LABEL, "max_file_bytes", read.bytes);
      return finalizeResult(result);
    }
    // Zero bytes off stdin is "could not look", not "looked and it was clean".
    //
    // This is the ONE payload source that cannot tell the two apart. A stdin
    // redirected from /dev/null, a closed descriptor, a producer that exited
    // before writing, and a hook wired to the wrong stream all return an
    // identical successful read of zero bytes with no error. Nothing later in
    // this function can recover the distinction, so the gate has to refuse.
    //
    // A named file and an inlined buffer/text are deliberately NOT covered:
    // both carry positive evidence that a real unit was read — statSync plus
    // readFileSync succeeded on an identified path, or the caller affirmatively
    // supplied the value — so an empty one is a true clean and keeps exit 0.
    //
    // Note the return happens BEFORE filesScanned is set, so this case reports
    // filesScanned 0 rather than claiming a unit that produced no bytes.
    if (read.buffer === undefined || read.buffer.length === 0) {
      pushError(
        result,
        "Read 0 bytes from standard input: nothing was scanned. Pipe the text in, or name a file.",
      );
      return finalizeResult(result);
    }
    payload = read.buffer;
  }

  // An inlined buffer/text can also exceed the bound; the same refusal applies
  // however the payload arrived.
  if (payload.length > maxBytes) {
    recordSkip(result, label, "max_file_bytes", payload.length);
    return finalizeResult(result);
  }

  result.stats.filesScanned = 1;
  result.stats.bytesScanned = payload.length;

  if (!isLikelyBinary(payload)) {
    scanText(payload.toString("utf8"), { source: "input", path: label }, result, deadline);
    return finalizeResult(result);
  }

  // Same three-way handling the staged mode uses: a UTF-16 payload is "binary"
  // to the heuristic but is text and must be decoded, or no detector can span
  // an ASCII run that is one byte wide.
  const decoded = decodeUtf16(payload);
  if (decoded !== undefined) {
    scanText(decoded, { source: "input", path: label }, result, deadline);
  } else {
    scanBinaryBuffer(payload, { source: "input", path: label, binary: true }, result, deadline);
  }

  return finalizeResult(result);
}

/**
 * Read stdin to EOF, stopping one byte past the ceiling.
 *
 * Bounded rather than a single slurp so the ceiling is real: a caller that asks
 * for a 64-byte bound must not first buffer a gigabyte to discover it was
 * exceeded. Going over returns `oversize` and the remainder is left unread —
 * the gate is refusing anyway, so draining it would only spend time.
 *
 * The deadline is checked BETWEEN reads. That covers a slow producer, not a
 * wedged one: `readSync` blocks, so a writer that opens the pipe and never
 * writes cannot be timed out from here. A caller that cannot tolerate that
 * bounds the whole process from outside.
 */
function readBoundedStdin(
  maxBytes: number,
  deadline: number,
): { buffer?: Buffer; bytes: number; oversize?: boolean; timedOut?: boolean; error?: string } {
  const chunks: Buffer[] = [];
  const scratch = Buffer.allocUnsafe(STDIN_READ_CHUNK_BYTES);
  let total = 0;

  for (;;) {
    if (Date.now() > deadline) return { bytes: total, timedOut: true };

    let read: number;
    try {
      read = readSync(0, scratch, 0, STDIN_READ_CHUNK_BYTES, null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // EOF is reported as an exception on some platforms rather than a 0 read.
      if (code === "EOF") break;
      // A non-blocking stdin yields EAGAIN before data is ready. Retry, but the
      // deadline check at the top of the loop keeps that from spinning forever.
      if (code === "EAGAIN") continue;
      return { bytes: total, error: (error as Error).message };
    }

    if (read <= 0) break;
    total += read;
    if (total > maxBytes) return { bytes: total, oversize: true };
    chunks.push(Buffer.from(scratch.subarray(0, read)));
  }

  return { buffer: Buffer.concat(chunks), bytes: total };
}

/**
 * Walk the printable-ASCII runs of a non-text blob.
 *
 * A credential is by construction an ASCII run, so extracting runs finds every
 * shape the detectors know and keeps the matching bounded — where splitting a
 * PNG on newlines would hand the detectors megabyte-long lines of binary noise.
 * `column` is the run's byte offset, which for a binary is the only coordinate
 * that means anything.
 */
function scanBinaryBuffer(
  buffer: Buffer,
  context: ScanTextContext,
  result: ExposureScanResult,
  deadline: number,
): void {
  let runStart = -1;

  const flush = (end: number): void => {
    if (runStart < 0) return;
    if (end - runStart >= MIN_PRINTABLE_RUN) {
      scanTextLine(buffer.toString("latin1", runStart, end), 1, context, result, undefined, runStart);
    }
    runStart = -1;
  };

  for (let index = 0; index < buffer.length; index++) {
    if (result.truncated) return;
    if (index % BINARY_DEADLINE_CHECK_STRIDE === 0 && Date.now() > deadline) {
      markTruncated(result, "timeout");
      return;
    }
    const byte = buffer[index]!;
    if (byte === 0x09 || (byte >= 0x20 && byte <= 0x7e)) {
      if (runStart < 0) runStart = index;
      continue;
    }
    flush(index);
  }
  flush(buffer.length);
}

/**
 * Decode a UTF-16 blob, or undefined when it is not UTF-16.
 *
 * Two separate things make this load-bearing rather than a nicety. Git treats a
 * UTF-16 file as BINARY, so a UTF-16LE `.json` — a covered extension carrying
 * ordinary configuration — contributes nothing but "Binary files differ" to
 * every diff, at any pathspec. And byte-level run extraction cannot rescue it
 * either: in UTF-16LE an ASCII run is `X\0X\0X\0`, so every printable run is a
 * single byte and no detector can span one. Decoding first turns the blob back
 * into the text it always was, with real lines and real column numbers.
 */
function decodeUtf16(buffer: Buffer): string | undefined {
  if (buffer.length < 4 || buffer.length % 2 !== 0) return undefined;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return swapEndian(buffer.subarray(2)).toString("utf16le");

  // No BOM: infer the endianness from where the NUL bytes land. ASCII-dominant
  // UTF-16LE puts them on odd indices, UTF-16BE on even ones. Requiring the
  // opposite parity to be entirely NUL-free keeps genuine binaries — a PNG has
  // NULs on both parities — out of this branch.
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  let evenZero = 0;
  let oddZero = 0;
  for (let index = 0; index < sample.length; index++) {
    if (sample[index] !== 0) continue;
    if (index % 2 === 0) evenZero++;
    else oddZero++;
  }
  const threshold = (sample.length / 2) * 0.6;
  if (oddZero > threshold && evenZero === 0) return buffer.toString("utf16le");
  if (evenZero > threshold && oddZero === 0) return swapEndian(buffer).toString("utf16le");
  return undefined;
}

function swapEndian(buffer: Buffer): Buffer {
  return Buffer.from(buffer).swap16();
}

/**
 * One `git cat-file --batch-check` for every staged path: sha, type and size.
 *
 * `--batch-check` answers one line per input line, in order, so the mapping
 * back to a path is POSITIONAL. A path containing a newline would therefore
 * consume two input lines and silently shift every later answer by one —
 * attributing one file's blob to a different file's name, in both directions.
 * Such paths are excluded from the batch instead; they resolve to no metadata,
 * which the caller turns into a reported skip and a non-zero exit. Failing
 * loudly on a pathological filename beats mis-attributing a clean blob.
 */
function stagedBlobMetadata(
  gitRoot: string,
  paths: string[],
  timeoutMs: number,
): Map<string, { sha: string; size: number }> {
  const meta = new Map<string, { sha: string; size: number }>();
  const batchable = paths.filter((path) => !path.includes("\n") && !path.includes("\r"));
  if (!batchable.length) return meta;

  const result = runGit(gitRoot, ["cat-file", "--batch-check"], {
    timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    // `:0:<path>`, never `:<path>`. A file legally named `0:foo` queried as
    // `:0:foo` is parsed by git as "stage 0 of foo" — a DIFFERENT object — so
    // the real blob is never read while a clean one is counted twice, at zero
    // findings and exit 0. Any name matching ^[0-3]: is a silent bypass of the
    // whole gate, and the filename is the entire attack. The explicit stage
    // prefix disambiguates it: `:0:0:foo` resolves the file named `0:foo`.
    input: `${batchable.map((path) => `:0:${path}`).join("\n")}\n`,
  });
  if (result.status !== 0) return meta;

  const lines = result.stdout.split("\n");
  for (let index = 0; index < batchable.length && index < lines.length; index++) {
    // `<sha> <type> <size>` for a resolvable blob; anything else ("missing",
    // "ambiguous") stays out of the map and becomes a reported skip. Note the
    // lines are NOT filtered for emptiness — dropping a blank would reintroduce
    // exactly the positional shift this function exists to avoid.
    const parts = lines[index]!.trim().split(/\s+/);
    if (parts.length !== 3 || parts[1] !== "blob") continue;
    const size = Number.parseInt(parts[2]!, 10);
    if (!Number.isFinite(size) || size < 0) continue;
    meta.set(batchable[index]!, { sha: parts[0]!, size });
  }
  return meta;
}

/** Read a blob as raw bytes. utf8 here would corrupt exactly the binary class. */
function readGitBlob(gitRoot: string, sha: string, timeoutMs: number): Buffer | undefined {
  const result = spawnSync("git", ["-C", gitRoot, "cat-file", "blob", sha], {
    maxBuffer: MAX_STAGED_MAX_FILE_BYTES,
    timeout: timeoutMs,
  });
  if (result.status !== 0 || result.error || !result.stdout) return undefined;
  return result.stdout as unknown as Buffer;
}

function recordSkip(
  result: ExposureScanResult,
  path: string,
  reason: ExposureSkipReason,
  bytes?: number,
): void {
  result.stats.filesSkipped++;
  result.stats.skipped ??= [];
  if (result.stats.skipped.length < 100) {
    result.stats.skipped.push({ path, reason, ...(bytes === undefined ? {} : { bytes }) });
  }
}

function createResult(
  source: ExposureScanKind,
  root: string,
  limit: number,
  bounds: { maxFileBytes?: number; maxFiles?: number; maxBytesScanned?: number; maxCommits?: number; timeoutMs?: number },
): ExposureScanResult {
  return {
    schema: "open-secrets.exposure-scan.v1",
    version: 1,
    source,
    root,
    redacted: true,
    limits: {
      findings: limit,
      ...bounds,
    },
    stats: {
      filesScanned: 0,
      filesSkipped: 0,
      bytesScanned: 0,
      errors: [],
    },
    findings: [],
    findingCount: 0,
    truncated: false,
  };
}

function walkWorkspace(
  root: string,
  dir: string,
  bounds: { maxFileBytes: number; maxFiles: number; maxBytesScanned: number; deadline: number },
  result: ExposureScanResult,
  state: WorkspaceWalkState,
): void {
  if (result.truncated) return;
  if (Date.now() > bounds.deadline) {
    markTruncated(result, "timeout");
    if (state.lastFile) state.continuation = { path: state.lastFile, position: "after" };
    return;
  }

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    pushError(result, `Unable to read ${relativePath(root, dir)}: ${(error as Error).message}`);
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (result.truncated) return;
    if (Date.now() > bounds.deadline) {
      markTruncated(result, "timeout");
      return;
    }
    const fullPath = resolve(dir, entry.name);
    const relPath = relativePath(root, fullPath);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkWorkspace(root, fullPath, bounds, result, state);
      else result.stats.filesSkipped++;
      continue;
    }

    if (!entry.isFile() || isExcludedPath(relPath)) {
      result.stats.filesSkipped++;
      continue;
    }

    let findingCursor: FindingPosition | undefined;
    if (!state.cursorReached) {
      if (state.cursor?.path !== relPath) continue;
      state.cursorReached = true;
      if (state.cursor.position === "after") {
        state.lastFile = relPath;
        continue;
      }
      if (state.cursor.position === "finding") {
        findingCursor = {
          path: relPath,
          line: state.cursor.line!,
          column: state.cursor.column!,
          detector: state.cursor.detector!,
        };
      }
    }

    let stat;
    try {
      stat = statSync(fullPath);
    } catch (error) {
      pushError(result, `Unable to stat ${relPath}: ${(error as Error).message}`);
      continue;
    }

    if (stat.size > bounds.maxFileBytes) {
      result.stats.filesSkipped++;
      continue;
    }
    if (result.stats.filesScanned >= bounds.maxFiles) {
      markTruncated(result, "max_files");
      state.continuation = { path: relPath, position: "before" };
      return;
    }
    if (result.stats.bytesScanned + stat.size > bounds.maxBytesScanned) {
      markTruncated(result, "max_bytes");
      // A file larger than an otherwise empty byte budget can never fit in a
      // later chunk. Advance past it instead of returning the same cursor forever.
      state.continuation = {
        path: relPath,
        position: result.stats.bytesScanned === 0 ? "after" : "before",
      };
      return;
    }

    let buffer;
    try {
      buffer = readFileSync(fullPath);
    } catch (error) {
      pushError(result, `Unable to read ${relPath}: ${(error as Error).message}`);
      continue;
    }

    if (isLikelyBinary(buffer)) {
      result.stats.filesSkipped++;
      continue;
    }

    result.stats.filesScanned++;
    result.stats.bytesScanned += buffer.length;
    state.lastFile = relPath;
    scanText(buffer.toString("utf8"), { source: "workspace", path: relPath }, result, bounds.deadline, findingCursor);
    if (result.truncatedReason === "timeout") state.continuation = { path: relPath, position: "before" };
  }
}

function scanText(
  text: string,
  context: ScanTextContext,
  result: ExposureScanResult,
  deadline: number,
  after?: FindingPosition,
): void {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (result.truncated) return;
    if (Date.now() > deadline) {
      markTruncated(result, "timeout");
      return;
    }
    scanTextLine(lines[index], index + 1, context, result, after);
  }
}

function scanTextLine(
  line: string,
  lineNumber: number,
  context: ScanTextContext,
  result: ExposureScanResult,
  after?: FindingPosition,
  /**
   * Added to every reported column. Zero for real lines; for a printable run
   * carved out of a binary blob it is the run's byte offset, so the finding
   * points at the credential's position in the FILE rather than in the run.
   */
  columnOffset = 0,
): void {
  const spans = collectMatchSpans(line);
  if (!spans.length) return;

  // Constant, and deliberately not derived from `line`. Masking only the spans
  // the detectors matched is not redaction: it publishes everything they did
  // not match. See the note on ExposureFinding.preview.
  const preview = REDACTED;
  for (const span of spans) {
    const column = span.start + 1 + columnOffset;
    const position: FindingPosition = {
      path: context.path,
      line: lineNumber,
      column,
      detector: span.detector.id,
    };
    if (after && compareFindingPositions(position, after) <= 0) continue;
    if (result.findings.length >= result.limits.findings) {
      markTruncated(result, "findings");
      return;
    }
    result.findings.push({
      id: exposureFindingId(context, span.detector.id, lineNumber, column),
      source: context.source,
      detector: span.detector.id,
      severity: span.detector.severity,
      path: context.path,
      line: lineNumber,
      column,
      preview,
      evidencePath: evidencePath(position, context.commit),
      ...(context.commit ? { commit: context.commit } : {}),
      ...(context.binary ? { binary: true as const } : {}),
      remediation: exposureRemediation(context.source, span.detector.severity),
    });
  }
}

function exposureFindingId(
  context: ScanTextContext,
  detector: string,
  line: number,
  column: number,
): string {
  const locator = [context.source, context.path, line, column, detector, context.commit ?? ""].join("\0");
  return `secret-exposure:${createHash("sha256").update(locator).digest("hex").slice(0, 24)}`;
}

function exposureRemediation(source: ExposureScanKind, severity: ExposureSeverity): ExposureRemediation {
  return {
    kind: "credential_exposure",
    priority: severity === "high" ? "critical" : "high",
    steps: [
      "verify_finding",
      "revoke_credential",
      "rotate_credential",
      "remove_from_source",
      ...(source === "history" ? ["purge_git_history" as const] : []),
      "update_dependents",
      "rescan",
    ],
  };
}

function collectMatchSpans(line: string): MatchSpan[] {
  const spans: MatchSpan[] = [];
  for (const detector of DETECTORS) {
    detector.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = detector.pattern.exec(line)) !== null) {
      const rawValue = detector.valueGroup ? match[detector.valueGroup] : match[0];
      if (!rawValue || isPlaceholder(rawValue, { lexical: !detector.structuralOnly })) continue;
      const localStart = detector.valueGroup ? match[0].indexOf(rawValue) : 0;
      if (localStart < 0) continue;
      const start = match.index + localStart;
      const end = start + rawValue.length;
      if (spans.some((existing) => rangesOverlap(start, end, existing.start, existing.end))) continue;
      spans.push({ detector, start, end, value: rawValue });
    }
  }
  return spans.sort((a, b) => a.start - b.start || a.detector.id.localeCompare(b.detector.id));
}

function parseGitGrepLine(line: string): { path: string; line: number; content: string } | undefined {
  const firstColon = line.indexOf(":");
  if (firstColon < 0) return undefined;
  const secondColon = line.indexOf(":", firstColon + 1);
  if (secondColon < 0) return undefined;
  const thirdColon = line.indexOf(":", secondColon + 1);
  if (thirdColon < 0) return undefined;
  const path = line.slice(firstColon + 1, secondColon);
  const lineNumber = Number.parseInt(line.slice(secondColon + 1, thirdColon), 10);
  if (!Number.isFinite(lineNumber)) return undefined;
  return { path, line: lineNumber, content: line.slice(thirdColon + 1) };
}

function resolveGitRoot(root: string, timeoutMs: number): string | undefined {
  const result = runGit(root, ["rev-parse", "--show-toplevel"], { timeoutMs });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

function gitPathspecForRoot(gitRoot: string, requestedRoot: string): string {
  const rel = relativePath(gitRoot, requestedRoot);
  return rel === "." ? "." : rel;
}

function runGit(
  cwd: string,
  args: string[],
  options: { maxBuffer?: number; timeoutMs?: number; input?: string } = {},
): { status: number; stdout: string; stderr: string; error?: NodeJS.ErrnoException } {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? GIT_BUFFER_BYTES,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error as NodeJS.ErrnoException } : {}),
  };
}

function finalizeResult(result: ExposureScanResult): ExposureScanResult {
  result.findings.sort((a, b) => {
    const commitCompare = (a.commit ?? "").localeCompare(b.commit ?? "");
    if (commitCompare) return commitCompare;
    const pathCompare = a.path.localeCompare(b.path);
    if (pathCompare) return pathCompare;
    return a.line - b.line || a.column - b.column || a.detector.localeCompare(b.detector);
  });
  result.findingCount = result.findings.length;
  return result;
}

function findingPosition(finding: ExposureFinding): FindingPosition {
  return {
    path: finding.path,
    line: finding.line,
    column: finding.column,
    detector: finding.detector,
  };
}

function evidencePath(position: FindingPosition, commit?: string): string {
  const location = `${position.path}:${position.line}:${position.column}`;
  return commit ? `${commit}:${location}` : location;
}

function compareFindingPositions(a: FindingPosition, b: FindingPosition): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  if (a.detector === b.detector) return 0;
  return a.detector < b.detector ? -1 : 1;
}

function encodeCursor(
  source: ExposureScanKind,
  root: string,
  state: Pick<EncodedCursor, "workspace" | "history">,
): string {
  const cursor: EncodedCursor = {
    version: 1,
    source,
    root: cursorRoot(source, root),
    ...state,
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(
  value: string | undefined,
  source: ExposureScanKind,
  root: string,
): { ok: true; cursor?: EncodedCursor } | { ok: false; error: string } {
  if (!value) return { ok: true };
  if (value.length > MAX_CURSOR_LENGTH) return { ok: false, error: "Invalid scan cursor." };
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<EncodedCursor>;
    if (parsed.version !== 1 || parsed.source !== source || parsed.root !== cursorRoot(source, root)) {
      return { ok: false, error: "Scan cursor does not match the requested mode and root." };
    }
    if (source === "workspace" && !isWorkspaceCursor(parsed.workspace)) {
      return { ok: false, error: "Invalid workspace scan cursor." };
    }
    if (source === "history" && !isHistoryCursor(parsed.history)) {
      return { ok: false, error: "Invalid history scan cursor." };
    }
    return { ok: true, cursor: parsed as EncodedCursor };
  } catch {
    return { ok: false, error: "Invalid scan cursor." };
  }
}

function isWorkspaceCursor(value: unknown): value is WorkspaceCursorState {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Partial<WorkspaceCursorState>;
  if (typeof cursor.path !== "string" || !cursor.path || isOutsideRoot(cursor.path)) return false;
  if (cursor.position !== "before" && cursor.position !== "after" && cursor.position !== "finding") return false;
  if (cursor.position !== "finding") return true;
  return Number.isInteger(cursor.line) && cursor.line! > 0 &&
    Number.isInteger(cursor.column) && cursor.column! > 0 &&
    typeof cursor.detector === "string" && cursor.detector.length > 0 && cursor.detector.length <= 100;
}

function isHistoryCursor(value: unknown): value is HistoryCursorState {
  if (!value || typeof value !== "object") return false;
  const cursor = value as Partial<HistoryCursorState>;
  if (!Number.isSafeInteger(cursor.offset) || cursor.offset! < 0 || cursor.offset! > 10_000_000) return false;
  if (typeof cursor.commit !== "string" || !/^[0-9a-f]{40}$/.test(cursor.commit)) return false;
  return cursor.after === undefined || isFindingPosition(cursor.after);
}

function isFindingPosition(value: unknown): value is FindingPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<FindingPosition>;
  return typeof position.path === "string" && Boolean(position.path) && !isOutsideRoot(position.path) &&
    Number.isInteger(position.line) && position.line! > 0 &&
    Number.isInteger(position.column) && position.column! > 0 &&
    typeof position.detector === "string" && position.detector.length > 0 && position.detector.length <= 100;
}

function cursorRoot(source: ExposureScanKind, root: string): string {
  return createHash("sha256").update(`${source}\0${root}`).digest("hex").slice(0, 24);
}

function normalizeLimit(value: number | undefined): number {
  return normalizePositiveInteger(value, DEFAULT_LIMIT, MAX_LIMIT);
}

function normalizePositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

function isExcludedPath(path: string): boolean {
  const normalized = path.split(sep).join("/");
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED_DIRS.has(part))) return true;
  const lower = normalized.toLowerCase();
  return [...EXCLUDED_EXTENSIONS].some((extension) => lower.endsWith(extension));
}

function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/") || ".";
}

function isOutsideRoot(path: string): boolean {
  return path === ".." || path.startsWith("../") || path.startsWith("..\\") || isAbsolutePath(path);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
  }
  return sample.length > 0 && suspicious / sample.length > 0.2;
}

function isPlaceholder(value: string, options: { lexical?: boolean } = {}): boolean {
  const lexical = options.lexical !== false;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed.length < 8) return true;
  if (trimmed.startsWith("$") || trimmed.startsWith("<") || trimmed.includes("...")) return true;
  if (/[(),;]/.test(trimmed)) return true;
  if (/^[*x_-]+$/i.test(trimmed)) return true;
  // Lexical hints only suppress loosely-structured detectors (assignments,
  // header values). Rigid vendor formats (structuralOnly) skip these so a real
  // key shape like AWS's canonical published id is still reported.
  if (lexical) {
    if (lower.includes("example") || lower.includes("placeholder") || lower.includes("redacted")) return true;
    if (lower.includes("changeme") || lower.includes("dummy")) return true;
  }
  return false;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function trimError(value: string): string {
  return truncateError(value.trim().split("\n")[0] ?? "");
}

function pushError(result: ExposureScanResult, message: string): void {
  if (result.stats.errors.length < 10) result.stats.errors.push(truncateError(message));
}

function truncateError(message: string): string {
  if (message.length <= ERROR_MAX_LENGTH) return message;
  return `${message.slice(0, ERROR_MAX_LENGTH - 3)}...`;
}

function markTruncated(result: ExposureScanResult, reason: NonNullable<ExposureScanResult["truncatedReason"]>): void {
  result.truncated = true;
  result.truncatedReason ??= reason;
}
