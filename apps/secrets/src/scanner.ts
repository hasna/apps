import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export type ExposureScanKind = "workspace" | "history";
export type ExposureSeverity = "high" | "medium";

export interface ExposureFinding {
  source: ExposureScanKind;
  detector: string;
  severity: ExposureSeverity;
  path: string;
  line: number;
  column: number;
  preview: string;
  commit?: string;
}

export interface ExposureScanResult {
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
  truncatedReason?: "findings" | "max_files" | "max_bytes" | "timeout" | "git_output";
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
  limit?: number;
  maxFileBytes?: number;
  maxFiles?: number;
  maxBytesScanned?: number;
  timeoutMs?: number;
}

export interface HistoryExposureScanOptions {
  root?: string;
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
    result.stats.errors.push(`Root does not exist: ${root}`);
    return finalizeResult(result);
  }

  walkWorkspace(root, root, { maxFileBytes, maxFiles, maxBytesScanned, deadline }, result);
  return finalizeResult(result);
}

export function scanHistoryExposures(options: HistoryExposureScanOptions = {}): ExposureScanResult {
  const requestedRoot = resolve(options.root ?? process.cwd());
  const limit = normalizeLimit(options.limit);
  const maxCommits = normalizePositiveInteger(options.maxCommits, DEFAULT_MAX_COMMITS, MAX_COMMITS);
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;
  const gitRoot = resolveGitRoot(requestedRoot);
  const result = createResult("history", requestedRoot, limit, { maxCommits, timeoutMs });
  result.stats.commitsScanned = 0;

  if (!gitRoot) {
    result.stats.errors.push(`Not a git workspace: ${requestedRoot}`);
    return finalizeResult(result);
  }

  const pathspec = gitPathspecForRoot(gitRoot, requestedRoot);
  const commits = runGit(gitRoot, [
    "log",
    "--all",
    "--format=%H",
    `--max-count=${maxCommits}`,
    "--",
    pathspec,
  ]);
  if (commits.status !== 0) {
    result.stats.errors.push(trimError(commits.stderr) || "Unable to list git commits.");
    return finalizeResult(result);
  }

  for (const commit of commits.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
    if (result.truncated) break;
    if (Date.now() > deadline) {
      markTruncated(result, "timeout");
      break;
    }
    result.stats.commitsScanned = (result.stats.commitsScanned ?? 0) + 1;
    const remainingFindings = result.limits.findings - result.findings.length;
    const grep = runGit(gitRoot, [
      "grep",
      "-I",
      "-n",
      "-E",
      "-m",
      String(Math.max(1, remainingFindings)),
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
      continue;
    }
    if (grep.status !== 0 && grep.status !== 1) {
      pushError(result, trimError(grep.stderr) || `git grep failed for ${commit}`);
      continue;
    }

    for (const line of grep.stdout.split("\n")) {
      if (!line || result.truncated) continue;
      const parsed = parseGitGrepLine(line);
      if (!parsed) continue;
      if (isExcludedPath(parsed.path)) continue;
      const findingPath = relativePath(requestedRoot, resolve(gitRoot, parsed.path));
      if (isOutsideRoot(findingPath)) continue;
      scanTextLine(parsed.content, parsed.line, {
        source: "history",
        path: findingPath,
        commit,
      }, result);
    }
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
): void {
  if (result.truncated) return;
  if (Date.now() > bounds.deadline) {
    markTruncated(result, "timeout");
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
    const fullPath = resolve(dir, entry.name);
    const relPath = relativePath(root, fullPath);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkWorkspace(root, fullPath, bounds, result);
      else result.stats.filesSkipped++;
      continue;
    }

    if (!entry.isFile() || isExcludedPath(relPath)) {
      result.stats.filesSkipped++;
      continue;
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
      return;
    }
    if (result.stats.bytesScanned + stat.size > bounds.maxBytesScanned) {
      markTruncated(result, "max_bytes");
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
    scanText(buffer.toString("utf8"), { source: "workspace", path: relPath }, result);
  }
}

function scanText(text: string, context: ScanTextContext, result: ExposureScanResult): void {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (result.truncated) return;
    scanTextLine(lines[index], index + 1, context, result);
  }
}

function scanTextLine(line: string, lineNumber: number, context: ScanTextContext, result: ExposureScanResult): void {
  const spans = collectMatchSpans(line);
  if (!spans.length) return;

  const preview = truncatePreview(redactSpans(line, spans));
  for (const span of spans) {
    if (result.findings.length >= result.limits.findings) {
      markTruncated(result, "findings");
      return;
    }
    result.findings.push({
      source: context.source,
      detector: span.detector.id,
      severity: span.detector.severity,
      path: context.path,
      line: lineNumber,
      column: span.start + 1,
      preview,
      ...(context.commit ? { commit: context.commit } : {}),
    });
  }
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

function resolveGitRoot(root: string): string | undefined {
  const result = runGit(root, ["rev-parse", "--show-toplevel"]);
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
  return value.trim().split("\n")[0] ?? "";
}

function pushError(result: ExposureScanResult, message: string): void {
  if (result.stats.errors.length < 10) result.stats.errors.push(message);
}

function markTruncated(result: ExposureScanResult, reason: NonNullable<ExposureScanResult["truncatedReason"]>): void {
  result.truncated = true;
  result.truncatedReason ??= reason;
}
