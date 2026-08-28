import { createHash } from "crypto";
import { chmodSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { basename, join, relative, resolve, sep } from "path";
import {
  scanHistoryExposures,
  scanWorkspaceExposures,
  type ExposureScanResult,
} from "./scanner.js";
import { redactTextForPersistence } from "./redaction.js";
import { effectiveOperatorDataDir } from "./data-dir.js";

export {
  REDACTED_SECRET_VALUE,
  createPersistenceRedactor,
  redactForPersistence,
  redactTextForPersistence,
  type PersistenceRedactionHooks,
  type PersistenceRedactionOptions,
  type PersistenceRedactor,
} from "./redaction.js";

export interface SecurityTaskSuggestion {
  fingerprint: string;
  title: string;
  body: string;
  priority: "low" | "medium" | "high" | "critical";
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface SecretPermissionFinding {
  path: string;
  mode: string;
  expected_max_mode: string;
  status: "unsafe" | "fixed";
  fingerprint: string;
}

export interface SecretPermissionAuditResult {
  schema: "open-secrets.permissions.v1";
  generated_at: string;
  roots: string[];
  fixed: boolean;
  summary: {
    checked: number;
    findings: number;
    fixed: number;
    truncated: boolean;
  };
  findings: SecretPermissionFinding[];
  task_suggestions: SecurityTaskSuggestion[];
}

export interface SecretPermissionAuditOptions {
  roots?: string[];
  maxFiles?: number;
  fixPermissions?: boolean;
}

export interface SecurityExposureSweepResult {
  schema: "open-secrets.exposure-sweep.v1";
  generated_at: string;
  mode: "workspace" | "history";
  roots: string[];
  summary: {
    roots: number;
    findings: number;
    errors: number;
    truncated: boolean;
  };
  scans: ExposureScanResult[];
  task_suggestions: SecurityTaskSuggestion[];
}

export interface SecurityExposureSweepOptions {
  roots?: string[];
  mode?: "workspace" | "history";
  limit?: number;
  maxFiles?: number;
  maxBytesScanned?: number;
  maxCommits?: number;
  timeoutMs?: number;
}

export interface SupplyChainFinding {
  path: string;
  line: number;
  signal: string;
  preview: string;
  fingerprint: string;
}

export interface SupplyChainWatchResult {
  schema: "open-secrets.supply-chain-watch.v1";
  generated_at: string;
  roots: string[];
  summary: {
    files_scanned: number;
    findings: number;
    truncated: boolean;
  };
  findings: SupplyChainFinding[];
  task_suggestions: SecurityTaskSuggestion[];
}

export interface SupplyChainWatchOptions {
  roots?: string[];
  maxFiles?: number;
  maxFindings?: number;
}

const DEFAULT_PERMISSION_ROOTS = [
  join(homedir(), ".ssh"),
  join(homedir(), ".secrets"),
  effectiveOperatorDataDir(),
  join(homedir(), ".codewith"),
];

const DEFAULT_WORKSPACE_ROOTS = [join(homedir(), "workspace")];

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  "target",
]);

const SENSITIVE_NAME_PATTERN = /(^id_[a-z0-9_-]+$|\.pem$|\.key$|\.env$|\.env\.|secret|token|credential|password|vault\.db|vault\.key)/i;
const MANIFEST_NAME_PATTERN = /(^package\.json$|bun\.lock$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$)/i;
const SUPPLY_CHAIN_SIGNAL_PATTERN = /\b(preinstall|postinstall|prepare|curl|wget|Invoke-WebRequest|base64\s+-d|eval\s*\(|chmod\s+\+x|\/tmp\/|mktemp)\b/i;

export function auditSecretFilePermissions(options: SecretPermissionAuditOptions = {}): SecretPermissionAuditResult {
  const roots = normalizeRoots(options.roots, DEFAULT_PERMISSION_ROOTS);
  const maxFiles = normalizePositiveInteger(options.maxFiles, 10_000);
  const fixPermissions = Boolean(options.fixPermissions);
  const findings: SecretPermissionFinding[] = [];
  let checked = 0;
  let truncated = false;

  walkFiles(roots, maxFiles, (path) => {
    if (!SENSITIVE_NAME_PATTERN.test(basename(path))) return true;
    checked += 1;
    const stat = statSync(path);
    const mode = stat.mode & 0o777;
    if ((mode & 0o077) === 0) return true;
    if (fixPermissions) chmodSync(path, mode & 0o700);
    findings.push({
      path,
      mode: mode.toString(8).padStart(3, "0"),
      expected_max_mode: "700",
      status: fixPermissions ? "fixed" : "unsafe",
      fingerprint: fingerprint("secret-permission", path),
    });
    return true;
  }, () => {
    truncated = true;
  });

  return {
    schema: "open-secrets.permissions.v1",
    generated_at: new Date().toISOString(),
    roots,
    fixed: fixPermissions,
    summary: {
      checked,
      findings: findings.length,
      fixed: findings.filter((finding) => finding.status === "fixed").length,
      truncated,
    },
    findings,
    task_suggestions: findings.map(permissionTaskSuggestion),
  };
}

export function runSecurityExposureSweep(options: SecurityExposureSweepOptions = {}): SecurityExposureSweepResult {
  const roots = normalizeRoots(options.roots, DEFAULT_WORKSPACE_ROOTS);
  const mode = options.mode ?? "workspace";
  const scans = roots.map((root) => mode === "history"
    ? scanHistoryExposures({
      root,
      limit: options.limit,
      maxCommits: options.maxCommits,
      timeoutMs: options.timeoutMs,
    })
    : scanWorkspaceExposures({
      root,
      limit: options.limit,
      maxFiles: options.maxFiles,
      maxBytesScanned: options.maxBytesScanned,
      timeoutMs: options.timeoutMs,
    }));
  const taskSuggestions = scans.flatMap((scan) => scan.findings.map((finding) => exposureTaskSuggestion(scan.root, finding)));

  return {
    schema: "open-secrets.exposure-sweep.v1",
    generated_at: new Date().toISOString(),
    mode,
    roots,
    summary: {
      roots: roots.length,
      findings: scans.reduce((sum, scan) => sum + scan.findingCount, 0),
      errors: scans.reduce((sum, scan) => sum + scan.stats.errors.length, 0),
      truncated: scans.some((scan) => scan.truncated),
    },
    scans,
    task_suggestions: taskSuggestions,
  };
}

export function runSupplyChainWatch(options: SupplyChainWatchOptions = {}): SupplyChainWatchResult {
  const roots = normalizeRoots(options.roots, DEFAULT_WORKSPACE_ROOTS);
  const maxFiles = normalizePositiveInteger(options.maxFiles, 5_000);
  const maxFindings = normalizePositiveInteger(options.maxFindings, 100);
  const findings: SupplyChainFinding[] = [];
  let filesScanned = 0;
  let truncated = false;

  walkFiles(roots, maxFiles, (path) => {
    if (!MANIFEST_NAME_PATTERN.test(basename(path))) return true;
    filesScanned += 1;
    const content = readFileSync(path, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const match = line.match(SUPPLY_CHAIN_SIGNAL_PATTERN);
      if (!match) continue;
      findings.push({
        path,
        line: index + 1,
        signal: match[1]!,
        preview: redactLine(line).slice(0, 240),
        fingerprint: fingerprint("supply-chain", `${path}:${index + 1}:${match[1]}`),
      });
      if (findings.length >= maxFindings) {
        truncated = true;
        return false;
      }
    }
    return true;
  }, () => {
    truncated = true;
  });

  return {
    schema: "open-secrets.supply-chain-watch.v1",
    generated_at: new Date().toISOString(),
    roots,
    summary: {
      files_scanned: filesScanned,
      findings: findings.length,
      truncated,
    },
    findings,
    task_suggestions: findings.map(supplyChainTaskSuggestion),
  };
}

function walkFiles(
  roots: string[],
  maxFiles: number,
  onFile: (path: string) => boolean,
  onTruncated: () => void,
): void {
  let seen = 0;
  const visit = (dir: string): boolean => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (!visit(path)) return false;
        continue;
      }
      if (!entry.isFile()) continue;
      seen += 1;
      if (seen > maxFiles) {
        onTruncated();
        return false;
      }
      if (!onFile(path)) return false;
    }
    return true;
  };

  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (!visit(root)) break;
  }
}

function normalizeRoots(roots: string[] | undefined, fallback: string[]): string[] {
  const selected = roots?.length ? roots : fallback;
  return [...new Set(selected.map((root) => resolve(root)))];
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function fingerprint(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function permissionTaskSuggestion(finding: SecretPermissionFinding): SecurityTaskSuggestion {
  return {
    fingerprint: finding.fingerprint,
    title: `Fix unsafe permissions on ${basenameForTask(finding.path)}`,
    body: `Sensitive file has mode ${finding.mode}; expected no group/world permissions.\nPath: ${finding.path}`,
    priority: "high",
    tags: ["auto:route", "area:security", "secret-permissions"],
    metadata: {
      path: finding.path,
      mode: finding.mode,
      source: "open-secrets.permissions.v1",
    },
  };
}

function exposureTaskSuggestion(root: string, finding: ExposureScanResult["findings"][number]): SecurityTaskSuggestion {
  return {
    fingerprint: fingerprint("secret-exposure", `${root}:${finding.id}`),
    title: `Review possible leaked secret in ${finding.path}`,
    body: [
      `Finding: ${finding.id}`,
      `Root: ${root}`,
      `Evidence: ${finding.evidencePath}`,
      `Detector: ${finding.detector}`,
      `Severity: ${finding.severity}`,
      `Preview: ${finding.preview}`,
      finding.commit ? `Commit: ${finding.commit}` : "",
    ].filter(Boolean).join("\n"),
    priority: finding.severity === "high" ? "critical" : "high",
    tags: ["auto:route", "area:security", "secret-exposure"],
    metadata: {
      root,
      finding_id: finding.id,
      evidence_path: finding.evidencePath,
      path: finding.path,
      line: finding.line,
      detector: finding.detector,
      remediation: finding.remediation,
      source: "open-secrets.exposure-sweep.v1",
    },
  };
}

function supplyChainTaskSuggestion(finding: SupplyChainFinding): SecurityTaskSuggestion {
  return {
    fingerprint: finding.fingerprint,
    title: `Review supply-chain signal in ${basenameForTask(finding.path)}`,
    body: [
      `Path: ${finding.path}:${finding.line}`,
      `Signal: ${finding.signal}`,
      `Preview: ${finding.preview}`,
      "Inspect package lifecycle scripts or lockfile entries before taking remediation action.",
    ].join("\n"),
    priority: "high",
    tags: ["auto:route", "area:security", "supply-chain"],
    metadata: {
      path: finding.path,
      line: finding.line,
      signal: finding.signal,
      source: "open-secrets.supply-chain-watch.v1",
    },
  };
}

function redactLine(line: string): string {
  return redactTextForPersistence(line);
}

function basenameForTask(path: string): string {
  const parts = path.split(sep).filter(Boolean);
  return parts.at(-1) ?? (relative(process.cwd(), path) || path);
}
