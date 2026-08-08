import { getLocalMachineId } from "./db.js";
import { runMachineCommand, type MachineCommandResult } from "./remote.js";
import { MACHINES_CONSUMER_CONTRACT_VERSION, MACHINES_PACKAGE_NAME, getMachinesConsumerCapabilities, type MachinesContractPackage, type MachinesConsumerCapabilities } from "./topology.js";
import { getPackageVersion } from "./version.js";

export type CompatibilityStatus = "ok" | "warn" | "fail";
export type CompatibilitySource = MachineCommandResult["source"];

export interface CompatibilityCommandSpec {
  command: string;
  expectedVersion?: string;
  versionArgs?: string;
  required?: boolean;
}

export interface CompatibilityPackageSpec {
  name: string;
  command?: string;
  expectedVersion?: string;
  required?: boolean;
}

export interface CompatibilityWorkspaceSpec {
  path: string;
  label?: string;
  expectedPackageName?: string;
  expectedVersion?: string;
  required?: boolean;
}

export interface CompatibilityCheck {
  id: string;
  kind: "command" | "package" | "workspace";
  status: CompatibilityStatus;
  target: string;
  expected: string | null;
  actual: string | null;
  detail: string;
  source: CompatibilitySource;
}

export interface MachineCompatibilityReport {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: MachinesConsumerCapabilities;
  ok: boolean;
  machine_id: string;
  source: CompatibilitySource;
  generated_at: string;
  checks: CompatibilityCheck[];
  summary: {
    ok: number;
    warn: number;
    fail: number;
  };
}

export type CompatibilityCommandRunner = (machineId: string, command: string) => MachineCommandResult;

export interface MachineCompatibilityOptions {
  machineId?: string;
  commands?: CompatibilityCommandSpec[];
  packages?: CompatibilityPackageSpec[];
  workspaces?: CompatibilityWorkspaceSpec[];
  runner?: CompatibilityCommandRunner;
  now?: Date;
}

interface CommandInspection {
  path: string | null;
  version: string | null;
  exitCode: number;
  source: CompatibilitySource;
  stderr: string;
}

interface WorkspaceInspection {
  exists: boolean;
  packageJson: boolean;
  packageName: string | null;
  version: string | null;
  exitCode: number;
  source: CompatibilitySource;
  stderr: string;
}

const DEFAULT_COMMANDS: CompatibilityCommandSpec[] = [
  { command: "bun", required: true },
  { command: "machines", required: true },
];

function defaultPackages(): CompatibilityPackageSpec[] {
  return [{ name: "@hasna/machines", command: "machines", expectedVersion: getPackageVersion(), required: true }];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.@/-]+/g, "-").replace(/^-+|-+$/g, "");
}

function packageCommand(name: string): string {
  if (name === "@hasna/knowledge") return "knowledge";
  if (name === "@hasna/machines") return "machines";
  return name.split("/").pop() ?? name;
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/).find(Boolean) ?? "";
}

function extractVersion(value: string): string | null {
  const match = value.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match?.[0] ?? null;
}

function executionUnavailable(inspection: CommandInspection | WorkspaceInspection): boolean {
  return inspection.exitCode !== 0;
}

function executionDetail(inspection: CommandInspection | WorkspaceInspection): string {
  const detail = firstLine(inspection.stderr || "");
  return detail
    ? `execution unavailable (exit ${inspection.exitCode}): ${detail}`
    : `execution unavailable (exit ${inspection.exitCode})`;
}

function statusFor(required: boolean | undefined, ok: boolean): CompatibilityStatus {
  if (ok) return "ok";
  return required === false ? "warn" : "fail";
}

function makeCheck(input: {
  id: string;
  kind: CompatibilityCheck["kind"];
  status: CompatibilityStatus;
  target: string;
  expected?: string | null;
  actual?: string | null;
  detail: string;
  source: CompatibilitySource;
}): CompatibilityCheck {
  return {
    id: input.id,
    kind: input.kind,
    status: input.status,
    target: input.target,
    expected: input.expected ?? null,
    actual: input.actual ?? null,
    detail: input.detail,
    source: input.source,
  };
}

function parseKeyValue(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    result[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return result;
}

function defaultRunner(machineId: string, command: string): MachineCommandResult {
  return runMachineCommand(machineId, command);
}

function inspectCommand(
  machineId: string,
  spec: CompatibilityCommandSpec,
  runner: CompatibilityCommandRunner,
): CommandInspection {
  const command = shellQuote(spec.command);
  const versionArgs = spec.versionArgs ?? "--version";
  const script = [
    `cmd=${command}`,
    'path="$(command -v "$cmd" 2>/dev/null || true)"',
    'printf "path=%s\\n" "$path"',
    'if [ -n "$path" ]; then version="$("$cmd" ' + versionArgs + ' 2>/dev/null || true)"; printf "version=%s\\n" "$version"; fi',
  ].join("; ");
  const result = runner(machineId, script);
  const parsed = parseKeyValue(result.stdout);
  return {
    path: parsed.path || null,
    version: parsed.version ? firstLine(parsed.version) : null,
    exitCode: result.exitCode,
    source: result.source,
    stderr: result.stderr,
  };
}

function fieldCommand(field: "name" | "version"): string {
  const regex = field === "name"
    ? String.raw`s/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p`
    : String.raw`s/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p`;
  return [
    `if command -v bun >/dev/null 2>&1; then bun -e "const p=JSON.parse(await Bun.file(process.argv[1]).text()); console.log(p.${field} ?? '')" "$pkg" 2>/dev/null`,
    `elif command -v node >/dev/null 2>&1; then node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(p.${field} || '')" "$pkg" 2>/dev/null`,
    `else sed -n '${regex}' "$pkg" | head -n 1`,
    "fi",
  ].join("; ");
}

function inspectWorkspace(
  machineId: string,
  spec: CompatibilityWorkspaceSpec,
  runner: CompatibilityCommandRunner,
): WorkspaceInspection {
  const script = [
    `path=${shellQuote(spec.path)}`,
    'printf "exists=%s\\n" "$(test -d "$path" && printf yes || printf no)"',
    'pkg="$path/package.json"',
    'printf "package_json=%s\\n" "$(test -f "$pkg" && printf yes || printf no)"',
    `if [ -f "$pkg" ]; then printf "package_name=%s\\n" "$(${fieldCommand("name")})"; printf "version=%s\\n" "$(${fieldCommand("version")})"; fi`,
  ].join("; ");
  const result = runner(machineId, script);
  const parsed = parseKeyValue(result.stdout);
  return {
    exists: parsed.exists === "yes",
    packageJson: parsed.package_json === "yes",
    packageName: parsed.package_name || null,
    version: parsed.version || null,
    exitCode: result.exitCode,
    source: result.source,
    stderr: result.stderr,
  };
}

function commandCheck(machineId: string, spec: CompatibilityCommandSpec, runner: CompatibilityCommandRunner): CompatibilityCheck[] {
  const inspection = inspectCommand(machineId, spec, runner);
  const unavailable = executionUnavailable(inspection);
  const found = Boolean(inspection.path);
  const checks = [
    makeCheck({
      id: `command:${commandId(spec.command)}:path`,
      kind: "command",
      status: statusFor(spec.required, !unavailable && found),
      target: spec.command,
      expected: "available",
      actual: unavailable ? "unavailable" : inspection.path ?? "missing",
      detail: unavailable ? executionDetail(inspection) : found ? `found at ${inspection.path}` : inspection.stderr || "command missing",
      source: inspection.source,
    }),
  ];
  if (spec.expectedVersion) {
    const actualVersion = extractVersion(inspection.version ?? "");
    checks.push(makeCheck({
      id: `command:${commandId(spec.command)}:version`,
      kind: "command",
      status: unavailable ? statusFor(spec.required, false) : actualVersion === spec.expectedVersion ? "ok" : statusFor(spec.required, false),
      target: spec.command,
      expected: spec.expectedVersion,
      actual: unavailable ? "unavailable" : actualVersion ?? inspection.version ?? "missing",
      detail: unavailable ? executionDetail(inspection) : actualVersion ? `version output: ${inspection.version}` : "version unavailable",
      source: inspection.source,
    }));
  }
  return checks;
}

function packageCheck(machineId: string, spec: CompatibilityPackageSpec, runner: CompatibilityCommandRunner): CompatibilityCheck[] {
  const command = spec.command ?? packageCommand(spec.name);
  const inspection = inspectCommand(machineId, { command, expectedVersion: spec.expectedVersion, required: spec.required }, runner);
  const unavailable = executionUnavailable(inspection);
  const found = Boolean(inspection.path);
  const checks = [
    makeCheck({
      id: `package:${commandId(spec.name)}:command`,
      kind: "package",
      status: statusFor(spec.required, !unavailable && found),
      target: spec.name,
      expected: command,
      actual: unavailable ? "unavailable" : inspection.path ?? "missing",
      detail: unavailable ? executionDetail(inspection) : found ? `${command} found at ${inspection.path}` : `${command} command missing`,
      source: inspection.source,
    }),
  ];
  if (spec.expectedVersion) {
    const actualVersion = extractVersion(inspection.version ?? "");
    checks.push(makeCheck({
      id: `package:${commandId(spec.name)}:version`,
      kind: "package",
      status: unavailable ? statusFor(spec.required, false) : actualVersion === spec.expectedVersion ? "ok" : statusFor(spec.required, false),
      target: spec.name,
      expected: spec.expectedVersion,
      actual: unavailable ? "unavailable" : actualVersion ?? inspection.version ?? "missing",
      detail: unavailable ? executionDetail(inspection) : actualVersion ? `version output: ${inspection.version}` : "version unavailable",
      source: inspection.source,
    }));
  }
  return checks;
}

function workspaceCheck(machineId: string, spec: CompatibilityWorkspaceSpec, runner: CompatibilityCommandRunner): CompatibilityCheck[] {
  const inspection = inspectWorkspace(machineId, spec, runner);
  const unavailable = executionUnavailable(inspection);
  const target = spec.label ?? spec.path;
  const checks = [
    makeCheck({
      id: `workspace:${commandId(target)}:path`,
      kind: "workspace",
      status: statusFor(spec.required, !unavailable && inspection.exists),
      target,
      expected: spec.path,
      actual: unavailable ? "unavailable" : inspection.exists ? "exists" : "missing",
      detail: unavailable ? executionDetail(inspection) : inspection.exists ? `workspace exists at ${spec.path}` : inspection.stderr || `workspace missing at ${spec.path}`,
      source: inspection.source,
    }),
  ];
  if (spec.expectedPackageName) {
    checks.push(makeCheck({
      id: `workspace:${commandId(target)}:package-name`,
      kind: "workspace",
      status: unavailable ? statusFor(spec.required, false) : inspection.packageName === spec.expectedPackageName ? "ok" : statusFor(spec.required, false),
      target,
      expected: spec.expectedPackageName,
      actual: unavailable ? "unavailable" : inspection.packageName ?? (inspection.packageJson ? "missing-name" : "missing-package-json"),
      detail: unavailable ? executionDetail(inspection) : inspection.packageJson ? "package.json inspected" : "package.json missing",
      source: inspection.source,
    }));
  }
  if (spec.expectedVersion) {
    checks.push(makeCheck({
      id: `workspace:${commandId(target)}:version`,
      kind: "workspace",
      status: unavailable ? statusFor(spec.required, false) : inspection.version === spec.expectedVersion ? "ok" : statusFor(spec.required, false),
      target,
      expected: spec.expectedVersion,
      actual: unavailable ? "unavailable" : inspection.version ?? (inspection.packageJson ? "missing-version" : "missing-package-json"),
      detail: unavailable ? executionDetail(inspection) : inspection.packageJson ? "package.json inspected" : "package.json missing",
      source: inspection.source,
    }));
  }
  return checks;
}

export function checkMachineCompatibility(options: MachineCompatibilityOptions = {}): MachineCompatibilityReport {
  const machineId = options.machineId ?? getLocalMachineId();
  const runner = options.runner ?? defaultRunner;
  const commands = options.commands ?? DEFAULT_COMMANDS;
  const packages = options.packages ?? defaultPackages();
  const workspaces = options.workspaces ?? [];
  const checks: CompatibilityCheck[] = [];

  for (const spec of commands) checks.push(...commandCheck(machineId, spec, runner));
  for (const spec of packages) checks.push(...packageCheck(machineId, spec, runner));
  for (const spec of workspaces) checks.push(...workspaceCheck(machineId, spec, runner));

  const summary = {
    ok: checks.filter((check) => check.status === "ok").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
  };

  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: {
      name: MACHINES_PACKAGE_NAME,
      version: getPackageVersion(),
    },
    capabilities: getMachinesConsumerCapabilities(),
    ok: summary.fail === 0,
    machine_id: machineId,
    source: checks[0]?.source ?? "local",
    generated_at: (options.now ?? new Date()).toISOString(),
    checks,
    summary,
  };
}
