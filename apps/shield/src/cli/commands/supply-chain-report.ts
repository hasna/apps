import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Command } from "commander";
import { SEED_ADVISORIES } from "../../data/advisories.js";
import { sanitizeTextForBoundary, sanitizeValueForBoundary } from "../../lib/finding-safety.js";
import type { ReportWriters } from "./exposure-report.js";

export interface SupplyChainDependency {
  ecosystem: "npm";
  name: string;
  version: string;
  lockfile: string;
}

export interface SupplyChainFinding {
  kind: string;
  location: {
    source: "lockfile";
    path: string;
    line: number;
  };
  maskedExcerpt: string;
}

export interface SupplyChainChange {
  commit: string;
  lockfile: string;
}

export interface SupplyChainReport {
  schemaVersion: 1;
  report: "shield-supply-chain-report";
  since: string;
  summary: {
    lockfiles: number;
    dependencies: number;
    changes: number;
    findings: number;
  };
  lockfiles: string[];
  changes: SupplyChainChange[];
  dependencies: SupplyChainDependency[];
  findings: SupplyChainFinding[];
}

export interface SupplyChainReportOptions {
  workspace?: string;
  since: string;
}

const LOCKFILE_NAMES = new Set(["package-lock.json", "npm-shrinkwrap.json", "bun.lock", "yarn.lock", "pnpm-lock.yaml"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "vendor"]);

function validateSince(value: string): string {
  if (!/^[1-9]\d*(?:m|h|d|w)$/.test(value)) {
    throw new Error(`Invalid --since value '${sanitizeTextForBoundary(value)}'. Expected values such as 30m, 24h, or 7d.`);
  }
  return value;
}

function findLockfiles(workspace: string): string[] {
  const lockfiles: string[] = [];

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(path);
      } else if (entry.isFile() && LOCKFILE_NAMES.has(entry.name)) {
        lockfiles.push(path);
      }
    }
  }

  walk(workspace);
  return lockfiles;
}

function packageNameFromPath(path: string): string | null {
  const segments = path.replaceAll("\\", "/").split("/");
  for (let index = segments.length - 1; index >= 0; index--) {
    if (segments[index] !== "node_modules") continue;
    const name = segments[index + 1];
    if (!name) return null;
    return name.startsWith("@") && segments[index + 2] ? `${name}/${segments[index + 2]}` : name;
  }
  return null;
}

function parseJsonLockfile(content: string): Array<{ name: string; version: string }> {
  const normalized = content
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1");
  const parsed = JSON.parse(normalized) as {
    packages?: Record<string, { name?: string; version?: string } | unknown[]>;
    dependencies?: Record<string, { version?: string }>;
  };
  const dependencies: Array<{ name: string; version: string }> = [];

  for (const [path, value] of Object.entries(parsed.packages ?? {})) {
    if (!path) continue;
    if (Array.isArray(value) && typeof value[0] === "string") {
      const separator = value[0].lastIndexOf("@");
      if (separator > 0) dependencies.push({
        name: value[0].slice(0, separator),
        version: value[0].slice(separator + 1),
      });
      continue;
    }
    if (Array.isArray(value) || !value.version) continue;
    const name = value.name ?? packageNameFromPath(path);
    if (name) dependencies.push({ name, version: value.version });
  }
  if (dependencies.length === 0) {
    for (const [name, value] of Object.entries(parsed.dependencies ?? {})) {
      if (value.version) dependencies.push({ name, version: value.version });
    }
  }
  return dependencies;
}

function parseYarnLock(content: string): Array<{ name: string; version: string }> {
  const dependencies: Array<{ name: string; version: string }> = [];
  for (const block of content.split(/\n(?=\S)/)) {
    const descriptor = block.split("\n", 1)[0]?.replace(/:\s*$/, "").replace(/^"|"$/g, "").split(",", 1)[0];
    const version = block.match(/\n\s+version\s+"([^"]+)"/)?.[1];
    if (!descriptor || !version) continue;
    const separator = descriptor.startsWith("@") ? descriptor.indexOf("@", descriptor.indexOf("/") + 1) : descriptor.indexOf("@");
    if (separator > 0) dependencies.push({ name: descriptor.slice(0, separator), version });
  }
  return dependencies;
}

function parsePnpmLock(content: string): Array<{ name: string; version: string }> {
  const dependencies: Array<{ name: string; version: string }> = [];
  const pattern = /(?:^|\n)\s*(?:["'])?\/?((?:@[^/\s'":]+\/)?[^@\s'":]+)@([^:\s'"]+)(?:["'])?:/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    dependencies.push({ name: match[1], version: match[2].split("(", 1)[0] });
  }
  return dependencies;
}

function parseLockfile(path: string): Array<{ name: string; version: string }> {
  const content = readFileSync(path, "utf-8");
  if (path.endsWith("yarn.lock")) return parseYarnLock(content);
  if (path.endsWith("pnpm-lock.yaml")) return parsePnpmLock(content);
  try {
    return parseJsonLockfile(content);
  } catch {
    return [];
  }
}

function findRecentChanges(workspace: string, lockfiles: string[], since: string): SupplyChainChange[] {
  if (lockfiles.length === 0) return [];
  try {
    const output = execFileSync(
      "git",
      ["log", `--since=${since}`, "--format=COMMIT:%H", "--name-only", "--", ...lockfiles],
      {
        cwd: workspace,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const changes: SupplyChainChange[] = [];
    let commit = "";
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith("COMMIT:")) {
        commit = line.slice(7, 19);
      } else if (commit && line.trim()) {
        changes.push(sanitizeValueForBoundary({
          commit,
          lockfile: line.trim().replaceAll("\\", "/"),
        }));
      }
    }
    return changes.sort((left, right) => left.lockfile.localeCompare(right.lockfile)
      || left.commit.localeCompare(right.commit));
  } catch {
    return [];
  }
}

function compareDependencies(left: SupplyChainDependency, right: SupplyChainDependency): number {
  return left.name.localeCompare(right.name)
    || left.version.localeCompare(right.version)
    || left.lockfile.localeCompare(right.lockfile);
}

export async function buildSupplyChainReport(options: SupplyChainReportOptions): Promise<SupplyChainReport> {
  const workspace = resolve(options.workspace ?? ".");
  if (!existsSync(workspace)) throw new Error("Workspace does not exist");
  const since = validateSince(options.since);
  const absoluteLockfiles = findLockfiles(workspace);
  const lockfiles = absoluteLockfiles.map((path) => relative(workspace, path).replaceAll("\\", "/")).sort();
  const changes = findRecentChanges(workspace, lockfiles, since);
  const seen = new Set<string>();
  const dependencies: SupplyChainDependency[] = [];

  for (let index = 0; index < absoluteLockfiles.length; index++) {
    for (const dependency of parseLockfile(absoluteLockfiles[index])) {
      const safeDependency = sanitizeValueForBoundary({
        ecosystem: "npm" as const,
        name: dependency.name,
        version: dependency.version,
        lockfile: lockfiles[index],
      });
      const key = `${safeDependency.name}\0${safeDependency.version}\0${safeDependency.lockfile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dependencies.push(safeDependency);
    }
  }
  dependencies.sort(compareDependencies);

  const findings: SupplyChainFinding[] = [];
  for (const dependency of dependencies) {
    for (const advisory of SEED_ADVISORIES) {
      if (advisory.ecosystem !== "npm" || advisory.package_name !== dependency.name) continue;
      if (!advisory.affected_versions.includes("*") && !advisory.affected_versions.includes(dependency.version)) continue;
      findings.push({
        kind: advisory.attack_type,
        location: { source: "lockfile", path: dependency.lockfile, line: 1 },
        maskedExcerpt: `[MASKED ${dependency.name}@${dependency.version} ${advisory.severity}]`,
      });
    }
  }
  findings.sort((left, right) => left.location.path.localeCompare(right.location.path)
    || left.kind.localeCompare(right.kind)
    || left.maskedExcerpt.localeCompare(right.maskedExcerpt));

  return sanitizeValueForBoundary({
    schemaVersion: 1,
    report: "shield-supply-chain-report",
    since,
    summary: {
      lockfiles: lockfiles.length,
      dependencies: dependencies.length,
      changes: changes.length,
      findings: findings.length,
    },
    lockfiles,
    changes,
    dependencies,
    findings,
  } satisfies SupplyChainReport);
}

export function formatSupplyChainReportJson(report: SupplyChainReport): string {
  return `${JSON.stringify(sanitizeValueForBoundary(report), null, 2)}\n`;
}

const defaultWriters: ReportWriters = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export function registerSupplyChainReportCommand(
  program: Command,
  writers: ReportWriters = defaultWriters,
): void {
  const supplyChain = program.commands.find((command) => command.name() === "supply-chain")
    ?? program.command("supply-chain").description("Produce offline supply-chain triage reports");

  supplyChain
    .command("report")
    .description("Summarize lockfile dependencies and bundled security advisories")
    .option("--workspace <path>", "Workspace to inspect", ".")
    .option("--since <duration>", "Triage lookback label (for example 24h)", "24h")
    .option("--json", "Output JSON", false)
    .action(async (options: { workspace: string; since: string; json: boolean }) => {
      try {
        writers.stdout(formatSupplyChainReportJson(await buildSupplyChainReport(options)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writers.stderr(`${sanitizeTextForBoundary(message)}\n`);
        process.exitCode = 1;
      }
    });
}
