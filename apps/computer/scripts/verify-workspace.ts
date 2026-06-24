#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CommandSpec = {
  id: string;
  command: string[];
  required?: boolean;
};

type CommandReport = {
  id: string;
  command: string;
  cwd: string;
  status: "passed" | "failed" | "skipped";
  exit_code: number | null;
  duration_ms: number;
  stdout_tail: string;
  stderr_tail: string;
};

type RepoReport = {
  id: string;
  path: string;
  present: boolean;
  package_name: string | null;
  local_version: string | null;
  published_version?: string | null;
  status: "passed" | "failed" | "skipped";
  git: GitReport;
  release_gate: ReleaseGateReport;
  commands: CommandReport[];
};

type WorkspaceReport = {
  schema_version: "open-computer.workspace-verification.v1";
  generated_at: string;
  workspace_root: string;
  environment: {
    bun: string;
    node: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  repos: RepoReport[];
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    release_ready: number;
    release_blocked: number;
    duration_ms: number;
  };
};

type GitReport = {
  available: boolean;
  branch_line: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  raw: string;
};

type PackageInfo = {
  name: string | null;
  version: string | null;
  scripts: Record<string, string>;
};

type ReleaseGateReport = {
  ready: boolean;
  version_relation: "unknown" | "same_as_published" | "local_ahead_of_published" | "local_behind_published";
  scripts: {
    verify_release: string | null;
    prepublish_only: string | null;
  };
  blockers: string[];
  warnings: string[];
};

type RepoSpec = {
  id: string;
  relativePath: string;
  commands: CommandSpec[];
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const COMPUTER_ROOT = resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = resolve(COMPUTER_ROOT, "..");
const OUTPUT_TAIL_BYTES = 8_000;

const REPOS: RepoSpec[] = [
  {
    id: "open-computer",
    relativePath: "open-computer",
    commands: [
      { id: "typecheck", command: ["bun", "run", "typecheck"] },
      { id: "test", command: ["bun", "run", "test"] },
      { id: "build", command: ["bun", "run", "build"] },
    ],
  },
  {
    id: "open-browser",
    relativePath: "open-browser",
    commands: [
      { id: "typecheck", command: ["bun", "run", "typecheck"] },
      {
        id: "targeted-tests",
        command: [
          "bun",
          "test",
          "src/lib/policy.test.ts",
          "src/lib/session-policy.test.ts",
          "src/lib/extension-bridge.test.ts",
          "src/server/security.test.ts",
          "src/engines/extension.test.ts",
          "src/mcp/http.test.ts",
        ],
      },
    ],
  },
  {
    id: "open-machines",
    relativePath: "open-machines",
    commands: [
      { id: "typecheck", command: ["bun", "run", "typecheck"] },
      {
        id: "targeted-tests",
        command: [
          "bun",
          "test",
          "test/remote.test.ts",
          "test/compatibility.test.ts",
          "test/consumer-boundary.test.ts",
          "test/mutation-approval.test.ts",
          "test/screen.test.ts",
          "test/mcp.test.ts",
        ],
      },
      { id: "consumer-conformance", command: ["bun", "run", "smoke:consumer-conformance"] },
    ],
  },
  {
    id: "open-todos",
    relativePath: "open-todos",
    commands: [
      { id: "typecheck", command: ["bun", "run", "typecheck"] },
      { id: "no-cloud-tests", command: ["bun", "run", "test:no-cloud"] },
      {
        id: "agentic-contract-tests",
        command: [
          "bun",
          "test",
          "src/lib/goal-workflow.test.ts",
          "src/lib/approval-gates.test.ts",
          "src/lib/headless-boundaries.test.ts",
          "src/lib/workspace-trust.test.ts",
          "src/lib/verification-evidence.test.ts",
        ],
      },
    ],
  },
];

async function main(): Promise<void> {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const selectedRepos = options.repos.size > 0 ? REPOS.filter((repo) => options.repos.has(repo.id)) : REPOS;
  const reports: RepoReport[] = [];
  for (const repo of selectedRepos) {
    reports.push(await verifyRepo(repo, options.includeNpm));
  }

  const report: WorkspaceReport = {
    schema_version: "open-computer.workspace-verification.v1",
    generated_at: new Date().toISOString(),
    workspace_root: WORKSPACE_ROOT,
    environment: {
      bun: Bun.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    repos: reports,
    summary: summarize(reports, Date.now() - startedAt),
  };

  const json = JSON.stringify(report, null, 2);
  if (options.writePath) {
    mkdirSync(dirname(options.writePath), { recursive: true });
    writeFileSync(options.writePath, `${json}\n`);
  }
  console.log(json);

  if ((report.summary.failed > 0 || (options.enforceReleaseReady && report.summary.release_blocked > 0)) && !options.allowFailures) {
    process.exit(1);
  }
}

async function verifyRepo(repo: RepoSpec, includeNpm: boolean): Promise<RepoReport> {
  const repoPath = resolve(WORKSPACE_ROOT, repo.relativePath);
  if (!existsSync(repoPath)) {
    return {
      id: repo.id,
      path: repoPath,
      present: false,
      package_name: null,
      local_version: null,
      status: "skipped",
      git: emptyGitReport(),
      release_gate: skippedReleaseGate(),
      commands: [],
    };
  }

  const packageInfo = readPackageInfo(repoPath);
  const publishedVersion = includeNpm && packageInfo.name ? await npmView(packageInfo.name) : undefined;
  const git = await getGitReport(repoPath);
  const commands: CommandReport[] = [];
  for (const spec of repo.commands) {
    commands.push(await runCommand(spec, repoPath));
  }
  const releaseGate = buildReleaseGate(repo.id, packageInfo, publishedVersion, git);

  const failed = commands.some((command) => command.status === "failed" && command.exit_code !== 0);
  return {
    id: repo.id,
    path: repoPath,
    present: true,
    package_name: packageInfo.name,
    local_version: packageInfo.version,
    published_version: publishedVersion,
    status: failed ? "failed" : "passed",
    git,
    release_gate: releaseGate,
    commands,
  };
}

function readPackageInfo(repoPath: string): PackageInfo {
  const packagePath = join(repoPath, "package.json");
  if (!existsSync(packagePath)) return { name: null, version: null, scripts: {} };
  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
    name?: unknown;
    version?: unknown;
    scripts?: unknown;
  };
  return {
    name: typeof parsed.name === "string" ? parsed.name : null,
    version: typeof parsed.version === "string" ? parsed.version : null,
    scripts: isStringRecord(parsed.scripts) ? parsed.scripts : {},
  };
}

async function getGitReport(repoPath: string): Promise<GitReport> {
  const result = await runCommand({ id: "git-status", command: ["git", "status", "--short", "--branch"] }, repoPath);
  if (result.status !== "passed") {
    return {
      available: false,
      branch_line: null,
      dirty: false,
      ahead: 0,
      behind: 0,
      raw: `${result.stdout_tail}${result.stderr_tail}`,
    };
  }
  const raw = result.stdout_tail.trimEnd();
  const lines = raw.split("\n").filter(Boolean);
  const branchLine = lines[0] ?? null;
  return {
    available: true,
    branch_line: branchLine,
    dirty: lines.slice(1).length > 0,
    ahead: Number.parseInt(branchLine?.match(/ahead (\d+)/)?.[1] ?? "0", 10),
    behind: Number.parseInt(branchLine?.match(/behind (\d+)/)?.[1] ?? "0", 10),
    raw,
  };
}

function buildReleaseGate(repoId: string, packageInfo: PackageInfo, publishedVersion: string | null | undefined, git: GitReport): ReleaseGateReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const verifyRelease = packageInfo.scripts["verify:release"] ?? null;
  const prepublishOnly = packageInfo.scripts["prepublishOnly"] ?? null;
  const versionRelation = getVersionRelation(packageInfo.version, publishedVersion);

  if (!git.available) {
    warnings.push("git status was unavailable");
  } else {
    if (git.dirty) blockers.push("git worktree is dirty");
    if (git.behind > 0) blockers.push(`git branch is behind remote by ${git.behind} commit(s)`);
    if (git.ahead > 0) warnings.push(`git branch is ahead of remote by ${git.ahead} commit(s)`);
  }

  if (versionRelation === "local_behind_published") {
    blockers.push(`local version ${packageInfo.version} is behind published ${publishedVersion}`);
  } else if (versionRelation === "local_ahead_of_published") {
    warnings.push(`local version ${packageInfo.version} is ahead of published ${publishedVersion}; publish is required before consumers can install it`);
  }

  if (!verifyRelease) {
    blockers.push("missing verify:release script");
  }
  if (!prepublishOnly) {
    blockers.push("missing prepublishOnly release gate");
  } else if (!prepublishOnly.includes("verify:release")) {
    blockers.push("prepublishOnly does not run verify:release");
  }

  if (verifyRelease) {
    const requiredTokens = releaseRequiredTokens(repoId);
    for (const token of requiredTokens) {
      if (!verifyRelease.includes(token)) {
        blockers.push(`verify:release does not explicitly run ${token}`);
      }
    }
  }

  return {
    ready: blockers.length === 0,
    version_relation: versionRelation,
    scripts: {
      verify_release: verifyRelease,
      prepublish_only: prepublishOnly,
    },
    blockers,
    warnings,
  };
}

async function runCommand(spec: CommandSpec, cwd: string): Promise<CommandReport> {
  const startedAt = Date.now();
  const dataRoot = join(tmpdir(), `open-computer-workspace-${basename(cwd)}-${Date.now()}`);
  const proc = Bun.spawn(spec.command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CI: process.env.CI ?? "1",
      COMPUTER_DATA_DIR: join(dataRoot, "computer"),
      COMPUTER_DB_PATH: join(dataRoot, "computer", "computer.db"),
      BROWSER_DATA_DIR: join(dataRoot, "browser"),
      MACHINES_DATA_DIR: join(dataRoot, "machines"),
      TODOS_DATA_DIR: join(dataRoot, "todos"),
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    id: spec.id,
    command: spec.command.join(" "),
    cwd,
    status: exitCode === 0 ? "passed" : "failed",
    exit_code: exitCode,
    duration_ms: Date.now() - startedAt,
    stdout_tail: tail(stdout),
    stderr_tail: tail(stderr),
  };
}

async function npmView(packageName: string): Promise<string | null> {
  const result = await runCommand({ id: `npm-view-${packageName}`, command: ["npm", "view", packageName, "version"] }, COMPUTER_ROOT);
  if (result.status !== "passed") return null;
  return result.stdout_tail.trim() || null;
}

function summarize(reports: RepoReport[], durationMs: number): WorkspaceReport["summary"] {
  return {
    passed: reports.filter((repo) => repo.status === "passed").length,
    failed: reports.filter((repo) => repo.status === "failed").length,
    skipped: reports.filter((repo) => repo.status === "skipped").length,
    release_ready: reports.filter((repo) => repo.release_gate.ready).length,
    release_blocked: reports.filter((repo) => !repo.release_gate.ready).length,
    duration_ms: durationMs,
  };
}

function tail(value: string): string {
  if (value.length <= OUTPUT_TAIL_BYTES) return value;
  return value.slice(value.length - OUTPUT_TAIL_BYTES);
}

function parseArgs(args: string[]): {
  allowFailures: boolean;
  enforceReleaseReady: boolean;
  help: boolean;
  includeNpm: boolean;
  repos: Set<string>;
  writePath: string | null;
} {
  const repos = new Set<string>();
  let allowFailures = false;
  let enforceReleaseReady = false;
  let help = false;
  let includeNpm = false;
  let writePath: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--allow-failures") {
      allowFailures = true;
    } else if (arg === "--enforce-release-ready") {
      enforceReleaseReady = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--include-npm") {
      includeNpm = true;
    } else if (arg === "--write") {
      const next = args[index + 1];
      if (!next) throw new Error("--write requires a path");
      writePath = resolve(next);
      index += 1;
    } else if (arg === "--repo") {
      const next = args[index + 1];
      if (!next) throw new Error("--repo requires a repo id");
      repos.add(next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { allowFailures, enforceReleaseReady, help, includeNpm, repos, writePath };
}

function printHelp(): void {
  console.log(`Usage: bun run scripts/verify-workspace.ts [options]

Runs the open-computer workspace verification matrix and prints JSON.

Options:
  --repo <id>          Limit verification to a repo id. Repeatable.
  --include-npm        Include npm-published versions in the report.
  --enforce-release-ready
                       Return exit code 1 when release blockers are present.
  --write <path>       Write the JSON report to a file as well as stdout.
  --allow-failures     Return exit code 0 even when a repo check fails.
  -h, --help           Show this help text.
`);
}

function emptyGitReport(): GitReport {
  return {
    available: false,
    branch_line: null,
    dirty: false,
    ahead: 0,
    behind: 0,
    raw: "",
  };
}

function skippedReleaseGate(): ReleaseGateReport {
  return {
    ready: false,
    version_relation: "unknown",
    scripts: {
      verify_release: null,
      prepublish_only: null,
    },
    blockers: ["repository is not present"],
    warnings: [],
  };
}

function releaseRequiredTokens(repoId: string): string[] {
  if (repoId === "open-computer") return ["typecheck", "test", "build", "scripts/verify-release.ts"];
  if (repoId === "open-browser") return ["typecheck", "test", "build", "scripts/verify-release.ts"];
  if (repoId === "open-machines") return ["typecheck", "test", "build", "smoke:consumer-conformance", "scripts/verify-release.ts"];
  if (repoId === "open-todos") return ["typecheck", "bun test", "test:no-cloud", "scripts/verify-public-release.ts"];
  return ["typecheck", "test", "build"];
}

function getVersionRelation(
  localVersion: string | null,
  publishedVersion: string | null | undefined,
): ReleaseGateReport["version_relation"] {
  if (!localVersion || !publishedVersion) return "unknown";
  const comparison = compareSemver(localVersion, publishedVersion);
  if (comparison === 0) return "same_as_published";
  return comparison > 0 ? "local_ahead_of_published" : "local_behind_published";
}

function compareSemver(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
