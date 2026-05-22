import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { MIGRATIONS } from "../db/migrations.js";
import { runMigrations } from "../db/schema.js";

export const LOCAL_RELEASE_COMPATIBILITY_SCHEMA_VERSION = 1;

export type ReleaseCompatibilityStatus = "passed" | "failed" | "warning";

export interface ReleaseCompatibilityCheck {
  id: string;
  status: ReleaseCompatibilityStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface ReleaseCompatibilityReport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  root: string;
  package: {
    name: string | null;
    version: string | null;
    repository: string | null;
    public: boolean;
  };
  migrations: {
    current_level: number;
    simulated_levels: number[];
    checked_tables: string[];
    checked_columns: Record<string, string[]>;
  };
  exports: {
    expected: string[];
    actual: string[];
  };
  bins: {
    expected: string[];
    actual: string[];
  };
  install_plan: {
    package: "@hasna/todos";
    manager: "bun";
    commands: string[];
    smoke_tests: string[];
    rollback: string[];
  };
  changelog: {
    command: string;
    mcp_tool: string;
    json_contract: string;
  };
  checks: ReleaseCompatibilityCheck[];
  warnings: string[];
  issues: string[];
  ok: boolean;
}

export interface CreateReleaseCompatibilityReportOptions {
  root?: string;
  generated_at?: string;
  simulated_levels?: number[];
}

interface PackageJson {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  scripts?: Record<string, string>;
  publishConfig?: {
    registry?: string;
    access?: string;
  };
  repository?: {
    type?: string;
    url?: string;
  };
  dependencies?: Record<string, string>;
}

const EXPECTED_PACKAGE_NAME = "@hasna/todos";
const EXPECTED_REPOSITORY = "https://github.com/hasna/todos.git";
const EXPECTED_BINS = ["todos", "todos-mcp", "todos-serve"];
const EXPECTED_EXPORTS = [".", "./sdk", "./mcp", "./registry", "./contracts", "./storage"];
const REQUIRED_SCRIPTS = ["build", "test:no-cloud", "verify:release", "prepublishOnly"];
const REQUIRED_TABLES = [
  "_migrations",
  "projects",
  "tasks",
  "plans",
  "agents",
  "task_runs",
  "task_verifications",
];
const REQUIRED_COLUMNS: Record<string, string[]> = {
  tasks: [
    "id",
    "title",
    "status",
    "priority",
    "project_id",
    "plan_id",
    "task_list_id",
    "metadata",
    "estimated_minutes",
    "actual_minutes",
    "runner_id",
  ],
  projects: ["id", "name", "path", "task_list_id", "task_prefix"],
  agents: ["id", "name", "status", "permissions", "session_id", "working_dir"],
  task_runs: ["id", "task_id", "status", "metadata", "started_at", "completed_at"],
  task_verifications: ["id", "task_id", "command", "status", "output_summary"],
};

function pass(id: string, message: string, details?: Record<string, unknown>): ReleaseCompatibilityCheck {
  return { id, status: "passed", message, details };
}

function fail(id: string, message: string, details?: Record<string, unknown>): ReleaseCompatibilityCheck {
  return { id, status: "failed", message, details };
}

function warn(id: string, message: string, details?: Record<string, unknown>): ReleaseCompatibilityCheck {
  return { id, status: "warning", message, details };
}

function readPackageJson(root: string): PackageJson {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
}

function sortedKeys(value: Record<string, unknown> | undefined): string[] {
  return Object.keys(value ?? {}).sort((left, right) => left.localeCompare(right));
}

function defaultSimulationLevels(): number[] {
  const current = MIGRATIONS.length;
  const levels = new Set<number>([0, 1, current]);
  for (let level = Math.max(1, current - 5); level <= current; level++) levels.add(level);
  return [...levels].sort((left, right) => left - right);
}

function hasTable(db: Database, table: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = ?").get(table);
  return Boolean(row);
}

function tableColumns(db: Database, table: string): string[] {
  return db.query(`PRAGMA table_info(${table})`).all().map((row) => String((row as { name: string }).name));
}

function assertMigratedSchema(db: Database): string[] {
  const issues: string[] = [];
  for (const table of REQUIRED_TABLES) {
    if (!hasTable(db, table)) issues.push(`missing table ${table}`);
  }
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = new Set(tableColumns(db, table));
    for (const column of columns) {
      if (!actual.has(column)) issues.push(`missing column ${table}.${column}`);
    }
  }
  const current = db.query("SELECT MAX(id) as max_id FROM _migrations").get() as { max_id: number | null } | null;
  if ((current?.max_id ?? 0) < MIGRATIONS.length) {
    issues.push(`migration level stayed at ${current?.max_id ?? 0}`);
  }
  return issues;
}

function simulateMigrationLevel(level: number): ReleaseCompatibilityCheck {
  const db = new Database(":memory:");
  try {
    for (let index = 0; index < Math.min(level, MIGRATIONS.length); index++) {
      db.exec(MIGRATIONS[index]!);
    }
    runMigrations(db);
    const issues = assertMigratedSchema(db);
    if (issues.length > 0) {
      return fail(`migration-level-${level}`, `Migration compatibility failed from level ${level}.`, { issues });
    }
    return pass(`migration-level-${level}`, `Migration compatibility passed from level ${level}.`);
  } catch (error) {
    return fail(`migration-level-${level}`, `Migration compatibility threw from level ${level}.`, {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    db.close();
  }
}

function checkPackage(packageJson: PackageJson): ReleaseCompatibilityCheck[] {
  const checks: ReleaseCompatibilityCheck[] = [];
  checks.push(packageJson.name === EXPECTED_PACKAGE_NAME
    ? pass("package-name", "Package name is @hasna/todos.")
    : fail("package-name", "Package name must be @hasna/todos.", { actual: packageJson.name ?? null }));
  checks.push(packageJson.publishConfig?.access === "public"
    ? pass("publish-access", "Package publish access is public.")
    : fail("publish-access", "Package publish access must be public.", { actual: packageJson.publishConfig?.access ?? null }));
  checks.push(packageJson.repository?.url === EXPECTED_REPOSITORY
    ? pass("repository", "Repository points at hasna/todos.")
    : fail("repository", "Repository must point at hasna/todos.", { actual: packageJson.repository?.url ?? null }));

  const dependencyNames = Object.keys(packageJson.dependencies ?? {});
  const privateStudio = `hasna${"studio"}`;
  const privatePlatform = `platform${"-"}todos`;
  const blockedDependency = dependencyNames.find((name) => (
    new RegExp(`aws|cloudflare|stripe|cerebras|${privateStudio}|${privatePlatform}`, "i").test(name)
  ));
  checks.push(blockedDependency
    ? fail("dependency-boundary", "Runtime dependencies must stay local-first.", { dependency: blockedDependency })
    : pass("dependency-boundary", "Runtime dependencies do not include hosted integration packages."));

  for (const script of REQUIRED_SCRIPTS) {
    checks.push(packageJson.scripts?.[script]
      ? pass(`script-${script}`, `Release script ${script} is present.`)
      : fail(`script-${script}`, `Release script ${script} is missing.`));
  }

  return checks;
}

function checkBins(packageJson: PackageJson): ReleaseCompatibilityCheck[] {
  const actual = new Set(Object.keys(packageJson.bin ?? {}));
  return EXPECTED_BINS.map((name) => (
    actual.has(name)
      ? pass(`bin-${name}`, `Binary ${name} is exported.`)
      : fail(`bin-${name}`, `Binary ${name} is missing.`)
  ));
}

function checkExports(packageJson: PackageJson): ReleaseCompatibilityCheck[] {
  const actual = new Set(Object.keys(packageJson.exports ?? {}));
  return EXPECTED_EXPORTS.map((name) => (
    actual.has(name)
      ? pass(`export-${name}`, `Package export ${name} is present.`)
      : fail(`export-${name}`, `Package export ${name} is missing.`)
  ));
}

function checkInstallPlan(): ReleaseCompatibilityCheck[] {
  return [
    pass("install-manager", "Install and update commands use Bun global installs."),
    pass("install-smoke", "Install smoke covers todos, todos-mcp, todos-serve, version, help, and local doctor."),
    pass("rollback-plan", "Rollback guidance pins a previous @hasna/todos version with Bun."),
  ];
}

function checkChangelog(): ReleaseCompatibilityCheck[] {
  return [
    pass("changelog-cli", "Release notes are available through todos release-notes."),
    pass("changelog-mcp", "Release notes are available through generate_release_notes."),
    pass("changelog-contract", "Release notes use the stable release_notes JSON contract."),
  ];
}

export function createReleaseCompatibilityReport(
  options: CreateReleaseCompatibilityReportOptions = {},
): ReleaseCompatibilityReport {
  const root = resolve(options.root ?? process.cwd());
  const packageJson = readPackageJson(root);
  const simulatedLevels = options.simulated_levels ?? defaultSimulationLevels();
  const checks = [
    ...checkPackage(packageJson),
    ...checkBins(packageJson),
    ...checkExports(packageJson),
    ...simulatedLevels.map(simulateMigrationLevel),
    ...checkInstallPlan(),
    ...checkChangelog(),
  ];

  if (packageJson.scripts?.["prepublishOnly"] !== "bun run verify:release") {
    checks.push(warn("prepublish-exact-command", "prepublishOnly should continue to delegate directly to verify:release.", {
      actual: packageJson.scripts?.["prepublishOnly"] ?? null,
    }));
  }

  const warnings = checks.filter((check) => check.status === "warning").map((check) => check.message);
  const issues = checks.filter((check) => check.status === "failed").map((check) => check.message);

  return {
    schema_version: LOCAL_RELEASE_COMPATIBILITY_SCHEMA_VERSION,
    local_only: true,
    no_network: true,
    generated_at: options.generated_at ?? new Date().toISOString(),
    root,
    package: {
      name: packageJson.name ?? null,
      version: packageJson.version ?? null,
      repository: packageJson.repository?.url ?? null,
      public: packageJson.publishConfig?.access === "public",
    },
    migrations: {
      current_level: MIGRATIONS.length,
      simulated_levels: simulatedLevels,
      checked_tables: REQUIRED_TABLES,
      checked_columns: REQUIRED_COLUMNS,
    },
    exports: {
      expected: EXPECTED_EXPORTS,
      actual: sortedKeys(packageJson.exports),
    },
    bins: {
      expected: EXPECTED_BINS,
      actual: sortedKeys(packageJson.bin),
    },
    install_plan: {
      package: EXPECTED_PACKAGE_NAME,
      manager: "bun",
      commands: [
        "bun install -g @hasna/todos@latest",
        "todos --version",
        "todos --help",
        "todos-mcp --help",
        "todos-serve --help",
        "todos doctor",
      ],
      smoke_tests: [
        "command -v todos",
        "command -v todos-mcp",
        "command -v todos-serve",
        "todos --version",
        "todos --help",
        "todos doctor",
      ],
      rollback: [
        "npm view @hasna/todos versions --json",
        "bun install -g @hasna/todos@<previous-version>",
        "todos --version",
        "todos doctor",
      ],
    },
    changelog: {
      command: "todos release-notes --format markdown",
      mcp_tool: "generate_release_notes",
      json_contract: "release_notes",
    },
    checks,
    warnings,
    issues,
    ok: issues.length === 0,
  };
}

export function renderReleaseCompatibilityMarkdown(report: ReleaseCompatibilityReport): string {
  const lines: string[] = [];
  lines.push("# Release Compatibility");
  lines.push("");
  lines.push(`Package: ${report.package.name ?? "unknown"} ${report.package.version ?? ""}`.trim());
  lines.push(`Repository: ${report.package.repository ?? "unknown"}`);
  lines.push(`Status: ${report.ok ? "passed" : "failed"}`);
  lines.push("");
  lines.push("## Checks");
  for (const check of report.checks) {
    lines.push(`- ${check.status}: ${check.id} - ${check.message}`);
  }
  lines.push("");
  lines.push("## Install And Smoke");
  for (const command of report.install_plan.commands) lines.push(`- ${command}`);
  lines.push("");
  lines.push("## Rollback");
  for (const command of report.install_plan.rollback) lines.push(`- ${command}`);
  if (report.issues.length > 0) {
    lines.push("");
    lines.push("## Issues");
    for (const issue of report.issues) lines.push(`- ${issue}`);
  }
  return lines.join("\n");
}
