import { execFileSync } from "child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { basename, join, relative, resolve, sep } from "path";
import { isBinaryFile, scanFile } from "../scanners/secrets.js";
import { SEVERITY_ORDER, Severity } from "../types/index.js";

export interface OssSecretPolicyOptions {
  roots: string[];
  includeNoncanonical?: boolean;
  maxFileBytes?: number;
}

export interface OssSecretAllowlistEntry {
  path: string;
  rule_id: string;
  owner: string;
  reason: string;
  expires_at: string;
}

export interface OssSecretAllowlist {
  version: 1;
  entries: OssSecretAllowlistEntry[];
}

export interface OssSecretPolicyRepo {
  name: string;
  package_name: string;
  version: string | null;
  path: string;
  relative_path: string;
  remote: string | null;
  branch: string | null;
  canonical: boolean;
  canonical_reason: string;
  gate: {
    has_check_secrets: boolean;
    check_secrets: string | null;
    check_secrets_runs_scan: boolean;
    prepublish_runs_secrets: boolean;
    release_runs_secrets: boolean;
    ci_runs_secrets: boolean;
    workflow_files: string[];
  };
  allowlist: {
    path: string | null;
    valid_entries: number;
    invalid_entries: string[];
    expired_entries: string[];
  };
  counts: {
    critical_or_high_findings: number;
    unsuppressed_secret_findings: number;
    vendored_or_upstream_findings: number;
    allowed_fixture_findings: number;
    private_path_or_hostname_files: number;
  };
  files: {
    unsuppressed_secret_findings: string[];
    vendored_or_upstream_findings: string[];
    allowed_fixture_findings: string[];
    private_path_or_hostname: string[];
  };
  violations: string[];
}

export interface OssSecretPolicyResult {
  generated_at: string;
  roots: string[];
  summary: {
    publishable_repos: number;
    canonical_repos: number;
    noncanonical_repos: number;
    violations: number;
    missing_check_secrets: number;
    missing_ci_or_release_gate: number;
    unsuppressed_secret_repos: number;
    private_path_or_hostname_repos: number;
  };
  repos: OssSecretPolicyRepo[];
}

interface PackageJson {
  name?: string;
  private?: boolean;
  version?: string;
  scripts?: Record<string, string>;
}

interface CandidateRepo {
  root: string;
  path: string;
  packageJson: PackageJson;
}

interface RedactedFinding {
  file: string;
  rule_id: string;
  severity: Severity;
}

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const PACKAGE_IGNORE_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

const TEXT_SCAN_IGNORE_DIRS = new Set([
  ...PACKAGE_IGNORE_DIRS,
  "__pycache__",
]);

const PUBLIC_SURFACE_DIRS = new Set([
  ".github",
  "docs",
  "doc",
  "examples",
  "example",
  "scripts",
  "script",
  "bin",
  "test",
  "tests",
]);

const PUBLIC_SURFACE_FILES = new Set([
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "package.json",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".conf",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".md",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const DIRECT_SECRET_SCAN_MARKERS = [
  "oss-secrets-policy",
  "shield secrets",
  "security secrets",
  "gitleaks",
  "trufflehog",
];

const NONCANONICAL_PATH_MARKERS = [
  ".redirect-stale",
  "-wt-",
  "-pr",
  "-review",
  "-generated",
  "-release-",
  "-lock-fix",
  "-agent-daemon-",
  "-iproj-",
  "-T",
];

const VENDORED_OR_UPSTREAM_FIXTURE_PATTERNS = [
  "/vendor/",
  "/third_party/",
  "/test/data/",
  "/tests/data/",
  "/test/fixtures/upstream/",
  "/tests/fixtures/upstream/",
  "/fixtures/upstream/",
  "/chromedriver/",
];

const PRIVATE_PATH_OR_HOST_RE = /(?:(?:\/home|\/Users)\/[A-Za-z0-9._-]+(?:\/|\b)|\b(?:spark|apple)\d{2}\b|\bmachine\d{3}\b)/i;
const FIXTURE_ALLOWLIST_PATH_RE = /(?:^|\/)(?:__tests__|tests?|fixtures?|mocks?|samples?|examples?|specs?)(?:\/|$)|(?:^|\/)[^/]+\.(?:test|spec|fixture|mock|sample)\.[^/]+$/i;

function normalizePath(value: string): string {
  return value.split(sep).join("/");
}

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function safeGit(repoPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024,
    }).trim() || null;
  } catch {
    return null;
  }
}

function listPackageCandidates(root: string): CandidateRepo[] {
  const resolvedRoot = resolve(root);
  const candidates: CandidateRepo[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: resolvedRoot, depth: 0 }];
  const maxDepth = 2;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const packagePath = join(current.path, "package.json");
    if (existsSync(packagePath)) {
      const packageJson = readJsonFile<PackageJson>(packagePath);
      if (packageJson?.name && packageJson.private !== true) {
        candidates.push({ root: resolvedRoot, path: current.path, packageJson });
      }
    }

    if (current.depth >= maxDepth) continue;

    let entries;
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (PACKAGE_IGNORE_DIRS.has(entry.name)) continue;
      queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
    }
  }

  return candidates;
}

function getGitRemote(repoPath: string): string | null {
  return safeGit(repoPath, ["config", "--get", "remote.origin.url"]);
}

function getGitBranch(repoPath: string): string | null {
  return safeGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

function normalizeRemoteKey(remote: string | null): string {
  if (!remote) return "";
  const sshMatch = remote.match(/^git@github\.com:([^/]+\/[^.]+)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1].toLowerCase();
  const httpsMatch = remote.match(/^https:\/\/github\.com\/([^/]+\/[^.]+)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1].toLowerCase();
  return remote.replace(/\.git$/i, "").toLowerCase();
}

function expectedRepoDir(packageName: string | undefined): string | null {
  const name = packageName?.split("/").pop();
  return name ? `open-${name}` : null;
}

function getCanonicalReason(candidate: CandidateRepo, duplicateKeyCounts: Map<string, number>): string {
  const normalized = normalizePath(candidate.path);
  const normalizedRoot = normalizePath(candidate.root);
  const base = basename(candidate.path);
  const isExplicitRoot = candidate.path === candidate.root;
  const explicitRootIsTaskWorktree = normalizedRoot.includes("/.hasna/loops/worktrees/") && existsSync(join(candidate.root, "package.json"));
  if (!isExplicitRoot && normalized.includes("/.hasna/loops/worktrees/") && !explicitRootIsTaskWorktree) {
    return "task worktree";
  }
  if (!isExplicitRoot && NONCANONICAL_PATH_MARKERS.some((marker) => base.includes(marker))) {
    return "transient or stale checkout";
  }
  const remote = getGitRemote(candidate.path);
  const key = `${candidate.packageJson.name ?? ""}|${normalizeRemoteKey(remote)}`;
  if (!isExplicitRoot && (duplicateKeyCounts.get(key) ?? 0) > 1 && normalized.includes("/Workspace/")) {
    return "duplicate uppercase Workspace checkout";
  }
  const expectedDir = expectedRepoDir(candidate.packageJson.name);
  if (!isExplicitRoot && (duplicateKeyCounts.get(key) ?? 0) > 1 && expectedDir && base !== expectedDir) {
    return "duplicate package checkout";
  }
  return "canonical checkout";
}

function scriptRunsDirectSecretScan(script: string | undefined): boolean {
  if (!script) return false;
  const normalized = script.toLowerCase();
  return DIRECT_SECRET_SCAN_MARKERS.some((marker) => normalized.includes(marker));
}

function scriptRunsCheckSecrets(script: string | undefined): boolean {
  if (!script) return false;
  return /\bcheck:secrets\b/i.test(script);
}

function scriptRunsSecrets(script: string | undefined, checkSecretsRunsScan: boolean): boolean {
  if (scriptRunsDirectSecretScan(script)) return true;
  return checkSecretsRunsScan && scriptRunsCheckSecrets(script);
}

function workflowRunsSecrets(workflowText: string, checkSecretsRunsScan: boolean): boolean {
  return scriptRunsDirectSecretScan(workflowText) || (checkSecretsRunsScan && scriptRunsCheckSecrets(workflowText));
}

function listWorkflowFiles(repoPath: string): string[] {
  const workflowsDir = join(repoPath, ".github", "workflows");
  if (!existsSync(workflowsDir)) return [];
  try {
    return readdirSync(workflowsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ya?ml)$/i.test(entry.name))
      .map((entry) => `.github/workflows/${entry.name}`)
      .sort();
  } catch {
    return [];
  }
}

function getGate(packageJson: PackageJson, repoPath: string): OssSecretPolicyRepo["gate"] {
  const scripts = packageJson.scripts ?? {};
  const checkSecrets = scripts["check:secrets"];
  const checkSecretsRunsScan = scriptRunsDirectSecretScan(checkSecrets);
  const workflowFiles = listWorkflowFiles(repoPath);
  const workflowText = workflowFiles
    .map((file) => {
      try {
        return readFileSync(join(repoPath, file), "utf-8");
      } catch {
        return "";
      }
    })
    .join("\n")
    .toLowerCase();

  return {
    has_check_secrets: Boolean(checkSecrets),
    check_secrets: checkSecrets ?? null,
    check_secrets_runs_scan: checkSecretsRunsScan,
    prepublish_runs_secrets: scriptRunsSecrets(scripts.prepublishOnly, checkSecretsRunsScan) || scriptRunsSecrets(scripts.prepack, checkSecretsRunsScan),
    release_runs_secrets: Object.entries(scripts).some(
      ([name, script]) => name.toLowerCase().includes("release") && scriptRunsSecrets(script, checkSecretsRunsScan),
    ),
    ci_runs_secrets: workflowRunsSecrets(workflowText, checkSecretsRunsScan),
    workflow_files: workflowFiles,
  };
}

function isFixtureAllowlistPath(pathValue: string): boolean {
  const normalized = normalizePath(pathValue).replace(/^\/+/, "");
  return FIXTURE_ALLOWLIST_PATH_RE.test(normalized);
}

function loadAllowlist(repoPath: string): {
  path: string | null;
  entries: OssSecretAllowlistEntry[];
  invalidEntries: string[];
  expiredEntries: string[];
} {
  const candidates = [
    join(repoPath, "security", "oss-secret-allowlist.json"),
    join(repoPath, ".shield", "oss-secret-allowlist.json"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    return { path: null, entries: [], invalidEntries: [], expiredEntries: [] };
  }

  const parsed = readJsonFile<OssSecretAllowlist>(found);
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    return {
      path: normalizePath(relative(repoPath, found)),
      entries: [],
      invalidEntries: ["allowlist file must be JSON with version=1 and entries[]"],
      expiredEntries: [],
    };
  }

  const now = new Date();
  const entries: OssSecretAllowlistEntry[] = [];
  const invalidEntries: string[] = [];
  const expiredEntries: string[] = [];

  for (const entry of parsed.entries) {
    const label = `${entry.path || "<missing-path>"}:${entry.rule_id ?? "*"}`;
    if (!entry.path || !entry.owner || !entry.reason || !entry.expires_at) {
      invalidEntries.push(`${label} missing owner, reason, or expires_at`);
      continue;
    }
    const normalizedPath = normalizePath(entry.path).replace(/^\/+/, "");
    if (!entry.rule_id) {
      invalidEntries.push(`${label} missing rule_id`);
      continue;
    }
    if (!isFixtureAllowlistPath(normalizedPath)) {
      invalidEntries.push(`${label} path must target a fixture, test, mock, sample, or example`);
      continue;
    }
    const expiry = new Date(entry.expires_at);
    if (Number.isNaN(expiry.getTime())) {
      invalidEntries.push(`${label} has invalid expires_at`);
      continue;
    }
    if (expiry <= now) {
      expiredEntries.push(label);
      continue;
    }
    entries.push({ ...entry, path: normalizedPath });
  }

  return {
    path: normalizePath(relative(repoPath, found)),
    entries,
    invalidEntries,
    expiredEntries,
  };
}

function isAllowlisted(finding: RedactedFinding, entries: OssSecretAllowlistEntry[]): boolean {
  return entries.some((entry) => {
    const ruleMatches = entry.rule_id === finding.rule_id;
    const pathMatches = entry.path.endsWith("/")
      ? finding.file.startsWith(entry.path)
      : finding.file === entry.path;
    return ruleMatches && pathMatches;
  });
}

function isVendoredOrUpstreamFixture(file: string): boolean {
  const normalized = `/${file}`;
  return VENDORED_OR_UPSTREAM_FIXTURE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function isTextFile(filePath: string): boolean {
  const base = basename(filePath);
  if (base.startsWith(".env")) return true;
  const extension = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase() : "";
  return TEXT_EXTENSIONS.has(extension) || !isBinaryFile(filePath);
}

function listTextFiles(repoPath: string, maxFileBytes: number): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (TEXT_SCAN_IGNORE_DIRS.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isTextFile(fullPath)) continue;
      try {
        if (statSync(fullPath).size > maxFileBytes) continue;
      } catch {
        continue;
      }
      files.push(fullPath);
    }
  }

  walk(repoPath);
  return files;
}

function publicSurfaceFile(relPath: string): boolean {
  const parts = relPath.split("/");
  if (PUBLIC_SURFACE_FILES.has(relPath) || PUBLIC_SURFACE_FILES.has(parts[parts.length - 1] ?? "")) {
    return true;
  }
  return parts.some((part) => PUBLIC_SURFACE_DIRS.has(part));
}

function scanRepoFiles(repoPath: string, maxFileBytes: number): {
  redactedFindings: RedactedFinding[];
  privatePathOrHostnameFiles: string[];
} {
  const redactedFindings: RedactedFinding[] = [];
  const privatePathOrHostnameFiles = new Set<string>();

  for (const filePath of listTextFiles(repoPath, maxFileBytes)) {
    const relPath = normalizePath(relative(repoPath, filePath));
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    for (const finding of scanFile(relPath, content)) {
      if (SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[Severity.High]) continue;
      redactedFindings.push({
        file: finding.file,
        rule_id: finding.rule_id,
        severity: finding.severity,
      });
    }

    if (publicSurfaceFile(relPath) && PRIVATE_PATH_OR_HOST_RE.test(content)) {
      privatePathOrHostnameFiles.add(relPath);
    }
  }

  return {
    redactedFindings,
    privatePathOrHostnameFiles: [...privatePathOrHostnameFiles].sort(),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function evaluateRepo(candidate: CandidateRepo, duplicateKeyCounts: Map<string, number>, options: Required<OssSecretPolicyOptions>): OssSecretPolicyRepo {
  const remote = getGitRemote(candidate.path);
  const branch = getGitBranch(candidate.path);
  const canonicalReason = getCanonicalReason(candidate, duplicateKeyCounts);
  const canonical = canonicalReason === "canonical checkout";
  const gate = getGate(candidate.packageJson, candidate.path);
  const allowlist = loadAllowlist(candidate.path);
  const scan = scanRepoFiles(candidate.path, options.maxFileBytes);

  const vendored = scan.redactedFindings.filter((finding) => isVendoredOrUpstreamFixture(finding.file));
  const allowed = scan.redactedFindings.filter((finding) => isAllowlisted(finding, allowlist.entries));
  const unsuppressed = scan.redactedFindings.filter(
    (finding) => !isVendoredOrUpstreamFixture(finding.file) && !isAllowlisted(finding, allowlist.entries),
  );

  const violations: string[] = [];
  if (!gate.has_check_secrets) violations.push("missing package script check:secrets");
  if (gate.has_check_secrets && !gate.check_secrets_runs_scan) {
    violations.push("package script check:secrets does not run secret scan");
  }
  if (!gate.prepublish_runs_secrets) violations.push("prepublish/prepack does not run secret scan");
  if (!gate.release_runs_secrets && !gate.ci_runs_secrets) {
    violations.push("neither release scripts nor CI workflows run secret scan");
  }
  if (allowlist.invalidEntries.length > 0) violations.push("invalid secret fixture allowlist entries");
  if (allowlist.expiredEntries.length > 0) violations.push("expired secret fixture allowlist entries");
  if (unsuppressed.length > 0) violations.push("unsuppressed critical/high secret-shaped fixtures or values");
  if (scan.privatePathOrHostnameFiles.length > 0) violations.push("public docs/scripts/examples contain private path or hostname leakage");

  return {
    name: basename(candidate.path),
    package_name: candidate.packageJson.name!,
    version: candidate.packageJson.version ?? null,
    path: candidate.path,
    relative_path: normalizePath(relative(candidate.root, candidate.path)) || ".",
    remote,
    branch,
    canonical,
    canonical_reason: canonicalReason,
    gate,
    allowlist: {
      path: allowlist.path,
      valid_entries: allowlist.entries.length,
      invalid_entries: allowlist.invalidEntries,
      expired_entries: allowlist.expiredEntries,
    },
    counts: {
      critical_or_high_findings: scan.redactedFindings.length,
      unsuppressed_secret_findings: unsuppressed.length,
      vendored_or_upstream_findings: vendored.length,
      allowed_fixture_findings: allowed.length,
      private_path_or_hostname_files: scan.privatePathOrHostnameFiles.length,
    },
    files: {
      unsuppressed_secret_findings: uniqueSorted(unsuppressed.map((finding) => finding.file)),
      vendored_or_upstream_findings: uniqueSorted(vendored.map((finding) => finding.file)),
      allowed_fixture_findings: uniqueSorted(allowed.map((finding) => finding.file)),
      private_path_or_hostname: scan.privatePathOrHostnameFiles,
    },
    violations,
  };
}

export function evaluateOssSecretPolicy(options: OssSecretPolicyOptions): OssSecretPolicyResult {
  const fullOptions: Required<OssSecretPolicyOptions> = {
    roots: options.roots.length > 0 ? options.roots.map((root) => resolve(root)) : [process.cwd()],
    includeNoncanonical: options.includeNoncanonical ?? false,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  };
  const candidates = fullOptions.roots.flatMap((root) => listPackageCandidates(root));
  const duplicateKeyCounts = new Map<string, number>();

  for (const candidate of candidates) {
    const key = `${candidate.packageJson.name ?? ""}|${normalizeRemoteKey(getGitRemote(candidate.path))}`;
    duplicateKeyCounts.set(key, (duplicateKeyCounts.get(key) ?? 0) + 1);
  }

  const repos = candidates
    .map((candidate) => evaluateRepo(candidate, duplicateKeyCounts, fullOptions))
    .filter((repo) => fullOptions.includeNoncanonical || repo.canonical)
    .sort((a, b) => a.package_name.localeCompare(b.package_name) || a.path.localeCompare(b.path));

  const canonicalRepos = repos.filter((repo) => repo.canonical).length;
  const noncanonicalRepos = repos.length - canonicalRepos;
  const missingCheckSecrets = repos.filter((repo) =>
    repo.violations.includes("missing package script check:secrets") ||
    repo.violations.includes("package script check:secrets does not run secret scan"),
  ).length;
  const missingCiOrReleaseGate = repos.filter((repo) =>
    repo.violations.includes("neither release scripts nor CI workflows run secret scan"),
  ).length;
  const unsuppressedSecretRepos = repos.filter((repo) => repo.counts.unsuppressed_secret_findings > 0).length;
  const privatePathOrHostnameRepos = repos.filter((repo) => repo.counts.private_path_or_hostname_files > 0).length;

  return {
    generated_at: new Date().toISOString(),
    roots: fullOptions.roots,
    summary: {
      publishable_repos: repos.length,
      canonical_repos: canonicalRepos,
      noncanonical_repos: noncanonicalRepos,
      violations: repos.reduce((sum, repo) => sum + repo.violations.length, 0),
      missing_check_secrets: missingCheckSecrets,
      missing_ci_or_release_gate: missingCiOrReleaseGate,
      unsuppressed_secret_repos: unsuppressedSecretRepos,
      private_path_or_hostname_repos: privatePathOrHostnameRepos,
    },
    repos,
  };
}
