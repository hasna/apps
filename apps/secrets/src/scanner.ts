import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export type ExposureScanKind = "workspace" | "history";
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
  preview: string;
  /** Copy/paste-ready location for task bodies and evidence metadata. */
  evidencePath: string;
  commit?: string;
  remediation: ExposureRemediation;
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
  // blocklist ("example", "dummy", ...) must NOT suppress a match — e.g. the
  // canonical AWS id AKIAIOSFODNN7EXAMPLE is still a real access-key shape.
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
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const GIT_BUFFER_BYTES = 512 * 1024;
const PREVIEW_MAX_LENGTH = 220;
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
    pattern: new RegExp(`${token("sk", "-")}(?:${token("proj", "-")})?[A-Za-z0-9_-]{12,}`, "g"),
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
    pattern: new RegExp(`${token("x", "ai", "-")}[A-Za-z0-9_-]{12,}`, "g"),
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
  `${token("sk", "-")}(${token("proj", "-")})?[A-Za-z0-9_-]{12,}`,
  `${token("[sr]", "k", "_")}(live|test)${token("_")}[0-9A-Za-z]{10,}`,
  `${token("---", "--")}BEGIN ([A-Z0-9]+ )*PRIVATE KEY${token("---", "--")}`,
  `${token("gh", "[opusr]", "_")}[A-Za-z0-9_]{12,}`,
  `${token("npm", "_")}[A-Za-z0-9_]{12,}`,
  `${token("AI", "za")}[A-Za-z0-9_-]{20,}`,
  `${token("AK", "IA")}[0-9A-Z]{12,}`,
  `${token("x", "ai", "-")}[A-Za-z0-9_-]{12,}`,
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
): void {
  const spans = collectMatchSpans(line);
  if (!spans.length) return;

  const preview = truncatePreview(redactSpans(line, spans));
  for (const span of spans) {
    const position: FindingPosition = {
      path: context.path,
      line: lineNumber,
      column: span.start + 1,
      detector: span.detector.id,
    };
    if (after && compareFindingPositions(position, after) <= 0) continue;
    if (result.findings.length >= result.limits.findings) {
      markTruncated(result, "findings");
      return;
    }
    const column = span.start + 1;
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

function redactSpans(line: string, spans: MatchSpan[]): string {
  let output = "";
  let cursor = 0;
  for (const span of mergeSpans(spans)) {
    output += line.slice(cursor, span.start);
    output += REDACTED;
    cursor = span.end;
  }
  output += line.slice(cursor);
  return output;
}

function mergeSpans(spans: MatchSpan[]): Array<{ start: number; end: number }> {
  const sorted = spans.map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (!last || span.start > last.end) {
      merged.push({ ...span });
    } else {
      last.end = Math.max(last.end, span.end);
    }
  }
  return merged;
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
  options: { maxBuffer?: number; timeoutMs?: number } = {},
): { status: number; stdout: string; stderr: string; error?: NodeJS.ErrnoException } {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? GIT_BUFFER_BYTES,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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
  // key shape like AKIAIOSFODNN7EXAMPLE is still reported.
  if (lexical) {
    if (lower.includes("example") || lower.includes("placeholder") || lower.includes("redacted")) return true;
    if (lower.includes("changeme") || lower.includes("dummy")) return true;
  }
  return false;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function truncatePreview(value: string): string {
  if (value.length <= PREVIEW_MAX_LENGTH) return value;
  return `${value.slice(0, PREVIEW_MAX_LENGTH - 3)}...`;
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
