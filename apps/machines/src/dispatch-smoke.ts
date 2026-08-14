import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { getLocalMachineId } from "./db.js";
import { runMachineCommand, type MachineCommandOptions, type MachineCommandResult } from "./remote.js";
import { REDACTED_VALUE, redactErrorMessage, redactPath } from "./redaction.js";
import {
  MACHINES_CONSUMER_CONTRACT_VERSION,
  MACHINES_PACKAGE_NAME,
  discoverMachineTopology,
  findMachineTopologyEntry,
  getMachinesConsumerCapabilities,
  redactRouteForOutput,
  resolveMachineRoute,
  type MachineRouteConfidence,
  type MachineRouteKind,
  type MachineTopology,
  type MachineTopologyEntry,
  type MachineTopologyOptions,
  type MachinesConsumerCapabilities,
  type MachinesContractPackage,
} from "./topology.js";
import { validateSshTarget } from "./commands/ssh.js";
import { getPackageVersion } from "./version.js";

export const DISPATCH_FLEET_SMOKE_KIND = "dispatch_fleet_smoke" as const;
export const DEFAULT_DISPATCH_PACKAGE_NAME = "@hasna/dispatch";
export const DEFAULT_DISPATCH_COMMAND = "dispatch";
export const DEFAULT_DISPATCH_SMOKE_TIMEOUT_MS = 12_000;
export const DEFAULT_DISPATCH_SMOKE_MAX_OUTPUT_CHARS = 1_200;

export type DispatchFleetSmokeStatus = "ok" | "warn" | "fail" | "skipped";
export type DispatchFleetSmokeRouteMode = "auto" | "local" | "ssh";

export interface DispatchFleetSmokeTargetInput {
  machineId: string;
  label?: string;
  routeMode?: DispatchFleetSmokeRouteMode;
  required?: boolean;
}

export interface DispatchFleetSmokeResolvedTarget {
  target_id: string;
  machine_id: string;
  display_name: string;
  label: string;
  route_mode: DispatchFleetSmokeRouteMode;
  required: boolean;
}

export interface DispatchFleetSmokeCommandEvidence {
  command_ref: string;
  command_sha256: string;
  executed: boolean;
  mutates: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  redacted: boolean;
}

export interface DispatchFleetSmokePackageStatus {
  status: DispatchFleetSmokeStatus;
  name: string;
  command: string;
  command_found: boolean;
  path: string | null;
  version: string | null;
  expected_version: string | null;
  version_ok: boolean | null;
  evidence: DispatchFleetSmokeCommandEvidence;
}

export interface DispatchFleetSmokeRouteHealth {
  status: DispatchFleetSmokeStatus;
  ok: boolean;
  route: MachineRouteKind;
  source: MachineRouteKind;
  confidence: MachineRouteConfidence;
  local: boolean;
  forced_ssh: boolean;
  target: string | null;
  command_target: string | null;
  warnings: string[];
}

export interface DispatchFleetSmokeDaemonStatus {
  status: DispatchFleetSmokeStatus;
  status_command: DispatchFleetSmokeCommandEvidence;
  parsed: Record<string, unknown> | null;
  running: boolean | null;
  health: string | null;
  restart_readiness: {
    ready: boolean;
    status: DispatchFleetSmokeStatus;
    planned_command_ref: string;
    planned_mutates: true;
    executed: false;
    reasons: string[];
  };
}

export interface DispatchFleetSmokeMachineRow {
  target: DispatchFleetSmokeResolvedTarget;
  ok: boolean;
  status: DispatchFleetSmokeStatus;
  route_health: DispatchFleetSmokeRouteHealth;
  package_status: DispatchFleetSmokePackageStatus;
  daemon: DispatchFleetSmokeDaemonStatus;
  warnings: string[];
  errors: string[];
}

export interface DispatchFleetSmokeReport {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: MachinesConsumerCapabilities;
  generated_at: string;
  kind: typeof DISPATCH_FLEET_SMOKE_KIND;
  dryRun: true;
  dry_run: true;
  mutates: false;
  redaction: {
    enabled: true;
    marker: typeof REDACTED_VALUE;
    private_metadata: boolean;
  };
  selection: {
    default_fleet: boolean;
    package_name: string;
    command: string;
    expected_version: string | null;
    ignored: Array<{ machine_id: string; reason: string }>;
  };
  bounds: {
    timeout_ms: number;
    max_output_chars: number;
    machines: number;
  };
  summary: {
    total: number;
    ok: number;
    warn: number;
    fail: number;
    skipped: number;
    route_ok: number;
    package_ok: number;
    daemon_restart_ready: number;
  };
  machines: DispatchFleetSmokeMachineRow[];
  warnings: string[];
  errors: string[];
}

export type DispatchFleetSmokeRunner = (
  target: DispatchFleetSmokeResolvedTarget,
  command: string,
  options: MachineCommandOptions,
) => MachineCommandResult;

export interface DispatchFleetSmokeOptions extends Omit<MachineTopologyOptions, "runner"> {
  topology?: MachineTopology;
  machineIds?: string[];
  targets?: DispatchFleetSmokeTargetInput[];
  sshMachineIds?: string[];
  includeApple01?: boolean;
  packageName?: string;
  command?: string;
  expectedVersion?: string;
  runner?: DispatchFleetSmokeRunner;
  topologyRunner?: MachineTopologyOptions["runner"];
  timeoutMs?: number;
  maxOutputChars?: number;
  privateMetadata?: boolean;
}

interface BoundedText {
  text: string;
  truncated: boolean;
}

function packageMetadata(): MachinesContractPackage {
  return { name: MACHINES_PACKAGE_NAME, version: getPackageVersion() };
}

function generatedAt(options: { now?: Date }): string {
  return (options.now ?? new Date()).toISOString();
}

function normalizeCommandName(value: string | undefined, fallback: string): string {
  const command = (value ?? fallback).trim();
  if (!command || command.startsWith("-") || /[^A-Za-z0-9_@./-]/.test(command)) {
    throw new Error(`Unsafe command name: ${value ?? ""}`);
  }
  return command;
}

function normalizePackageName(value: string | undefined): string {
  const name = (value ?? DEFAULT_DISPATCH_PACKAGE_NAME).trim();
  if (!name || /[\s"'`$\\;&|<>()[\]{}]/.test(name)) {
    throw new Error(`Unsafe package name: ${value ?? ""}`);
  }
  return name;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandRef(command: string): string {
  return command;
}

function commandSha256(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

function boundAndRedact(value: string, maxChars: number): BoundedText {
  const redacted = redactErrorMessage(redactPath(value));
  if (redacted.length <= maxChars) return { text: redacted, truncated: false };
  return {
    text: `${redacted.slice(0, maxChars)}...[truncated ${redacted.length - maxChars} chars]`,
    truncated: true,
  };
}

function evidence(command: string, result: MachineCommandResult | null, maxOutputChars: number, mutates = false): DispatchFleetSmokeCommandEvidence {
  const stdout = boundAndRedact(result?.stdout ?? "", maxOutputChars);
  const stderr = boundAndRedact(result?.stderr ?? "", maxOutputChars);
  return {
    command_ref: commandRef(command),
    command_sha256: commandSha256(command),
    executed: Boolean(result),
    mutates,
    exit_code: result?.exitCode ?? null,
    timed_out: result?.timedOut === true,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    redacted: true,
  };
}

function parseKeyValue(stdout: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    parsed[line.slice(0, index)] = line.slice(index + 1);
  }
  return parsed;
}

function extractVersion(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match?.[0] ?? null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function booleanField(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function statusFromPackage(input: {
  found: boolean;
  version: string | null;
  expectedVersion: string | null;
  exitCode: number;
}): DispatchFleetSmokeStatus {
  if (!input.found || input.exitCode !== 0) return "fail";
  if (input.expectedVersion && input.version !== input.expectedVersion) return "fail";
  if (!input.version) return "warn";
  return "ok";
}

function routeStatus(route: DispatchFleetSmokeRouteHealth): DispatchFleetSmokeStatus {
  if (!route.ok || route.confidence === "none") return "fail";
  if (route.confidence === "low") return "warn";
  return "ok";
}

function daemonStatus(input: {
  packageFound: boolean;
  result: MachineCommandResult;
  parsed: Record<string, unknown> | null;
}): DispatchFleetSmokeStatus {
  if (!input.packageFound) return "skipped";
  if (input.result.exitCode !== 0) return "warn";
  if (!input.parsed) return "warn";
  return "ok";
}

function rowStatus(row: Omit<DispatchFleetSmokeMachineRow, "ok" | "status" | "warnings" | "errors">): DispatchFleetSmokeStatus {
  const statuses = [row.route_health.status, row.package_status.status, row.daemon.status];
  if (statuses.includes("fail")) return row.target.required ? "fail" : "warn";
  if (statuses.includes("warn")) return "warn";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  return "ok";
}

function topologyEntry(topology: MachineTopology, machineId: string): MachineTopologyEntry | null {
  if (machineId === "local" || machineId === "localhost") {
    return topology.machines.find((entry) => entry.machine_id === topology.local_machine_id) ?? null;
  }
  return findMachineTopologyEntry(topology, machineId);
}

function defaultTargets(localMachineId: string, includeApple01: boolean): DispatchFleetSmokeTargetInput[] {
  const targets: DispatchFleetSmokeTargetInput[] = [
    { machineId: "local", label: `local/${localMachineId}`, routeMode: "local", required: true },
    { machineId: "spark01", routeMode: "auto", required: true },
    { machineId: "spark02", label: "spark02 via ssh", routeMode: "ssh", required: false },
    { machineId: "apple03", routeMode: "auto", required: true },
  ];
  if (includeApple01) targets.push({ machineId: "apple01", routeMode: "auto", required: false });
  return targets;
}

function customTargets(machineIds: string[], sshMachineIds: string[]): DispatchFleetSmokeTargetInput[] {
  const sshSet = new Set(sshMachineIds);
  return machineIds.map((machineId) => ({
    machineId,
    routeMode: machineId === "local" || machineId === "localhost" ? "local" : sshSet.has(machineId) ? "ssh" : "auto",
    required: true,
  }));
}

function resolveTargets(options: DispatchFleetSmokeOptions, topology: MachineTopology): {
  targets: DispatchFleetSmokeResolvedTarget[];
  defaultFleet: boolean;
  ignored: Array<{ machine_id: string; reason: string }>;
} {
  const localMachineId = topology.local_machine_id || getLocalMachineId();
  const defaultFleet = !options.targets?.length && !options.machineIds?.length;
  const inputs = options.targets?.length
    ? options.targets
    : options.machineIds?.length
      ? customTargets(options.machineIds, options.sshMachineIds ?? [])
      : defaultTargets(localMachineId, options.includeApple01 === true);
  const ignored = options.includeApple01 === true
    ? []
    : [{ machine_id: "apple01", reason: "ignored by default for dispatch self-healing smoke; nonresponsive apple01 is not a blocker" }];

  const targets = inputs.map((input) => {
    const routeMode = input.routeMode ?? "auto";
    const entry = topologyEntry(topology, input.machineId);
    const machineId = input.machineId === "local" || input.machineId === "localhost"
      ? localMachineId
      : input.machineId;
    return {
      target_id: routeMode === "ssh" ? `${input.machineId}:ssh` : input.machineId,
      machine_id: machineId,
      display_name: input.label ?? entry?.display_name ?? machineId,
      label: input.label ?? input.machineId,
      route_mode: routeMode,
      required: input.required !== false,
    } satisfies DispatchFleetSmokeResolvedTarget;
  });

  return { targets, defaultFleet, ignored };
}

function defaultRunner(target: DispatchFleetSmokeResolvedTarget, command: string, options: MachineCommandOptions): MachineCommandResult {
  if (target.route_mode === "ssh") return runSshAliasCommand(target.machine_id, command, options);
  const machineId = target.route_mode === "local" ? "local" : target.machine_id;
  return runMachineCommand(machineId, command, options);
}

function runSshAliasCommand(machineId: string, command: string, options: MachineCommandOptions): MachineCommandResult {
  const target = validateSshTarget(machineId);
  const connectTimeoutSeconds = Math.max(1, Math.ceil((options.timeoutMs ?? DEFAULT_DISPATCH_SMOKE_TIMEOUT_MS) / 1000));
  const result = spawnSync("ssh", [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${connectTimeoutSeconds}`,
    target,
    command,
  ], {
    encoding: "utf8",
    env: process.env,
    timeout: options.timeoutMs,
    killSignal: "SIGTERM",
  });
  const timedOut = Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT");
  const timeoutMessage = timedOut ? `Command timed out after ${options.timeoutMs}ms.` : "";
  return {
    machineId,
    source: "ssh",
    stdout: result.stdout ?? "",
    stderr: [result.stderr ?? "", timeoutMessage].filter(Boolean).join(result.stderr ? "\n" : ""),
    exitCode: timedOut ? 124 : result.status ?? 1,
    timedOut,
    signal: result.signal,
  };
}

function packageProbeCommand(command: string): string {
  const quoted = shellQuote(command);
  return [
    'PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
    "export PATH",
    `cmd=${quoted}`,
    'cmd_path="$(command -v "$cmd" 2>/dev/null || true)"',
    'printf "path=%s\\n" "$cmd_path"',
    'if [ -n "$cmd_path" ]; then version="$("$cmd_path" --version 2>&1 || true)"; printf "version=%s\\n" "$version"; fi',
  ].join("; ");
}

function daemonStatusCommand(command: string): string {
  return `PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; export PATH; ${shellQuote(command)} daemon status --json`;
}

function daemonRestartCommand(command: string): string {
  return `PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; export PATH; ${shellQuote(command)} daemon restart --json`;
}

function buildRouteHealth(target: DispatchFleetSmokeResolvedTarget, topology: MachineTopology, privateMetadata: boolean): DispatchFleetSmokeRouteHealth {
  if (target.route_mode === "ssh") {
    const health: DispatchFleetSmokeRouteHealth = {
      status: "ok",
      ok: true,
      route: "ssh",
      source: "ssh",
      confidence: "medium",
      local: false,
      forced_ssh: true,
      target: privateMetadata ? target.machine_id : REDACTED_VALUE,
      command_target: privateMetadata ? target.machine_id : REDACTED_VALUE,
      warnings: ["forced_ssh_route_probe:uses ssh alias when normal resolver may treat the machine as local"],
    };
    health.status = routeStatus(health);
    return health;
  }

  const requested = target.route_mode === "local" ? "local" : target.machine_id;
  const route = redactRouteForOutput(resolveMachineRoute(requested, { topology }), { privateMetadata });
  const health: DispatchFleetSmokeRouteHealth = {
    status: "ok",
    ok: route.ok,
    route: route.route,
    source: route.source,
    confidence: route.confidence,
    local: route.local,
    forced_ssh: false,
    target: route.target,
    command_target: route.command_target,
    warnings: route.warnings,
  };
  health.status = routeStatus(health);
  return health;
}

function buildPackageStatus(input: {
  packageName: string;
  command: string;
  expectedVersion: string | null;
  result: MachineCommandResult;
  maxOutputChars: number;
}): DispatchFleetSmokePackageStatus {
  const parsed = parseKeyValue(input.result.stdout);
  const version = extractVersion(parsed.version);
  const found = Boolean(parsed.path);
  return {
    status: statusFromPackage({ found, version, expectedVersion: input.expectedVersion, exitCode: input.result.exitCode }),
    name: input.packageName,
    command: input.command,
    command_found: found,
    path: parsed.path ? redactPath(parsed.path) : null,
    version,
    expected_version: input.expectedVersion,
    version_ok: input.expectedVersion ? version === input.expectedVersion : version ? true : null,
    evidence: evidence(packageProbeCommand(input.command), input.result, input.maxOutputChars, false),
  };
}

function buildDaemonStatus(input: {
  command: string;
  packageFound: boolean;
  result: MachineCommandResult;
  maxOutputChars: number;
}): DispatchFleetSmokeDaemonStatus {
  const parsed = parseJsonObject(input.result.stdout);
  const status = daemonStatus({ packageFound: input.packageFound, result: input.result, parsed });
  const readyReasons: string[] = [];
  if (!input.packageFound) readyReasons.push("package_command_missing");
  if (input.result.exitCode !== 0) readyReasons.push("daemon_status_unavailable");
  if (input.result.timedOut) readyReasons.push("daemon_status_timed_out");
  if (parsed === null && input.result.exitCode === 0) readyReasons.push("daemon_status_json_unparseable");
  const ready = input.packageFound && input.result.exitCode === 0 && !input.result.timedOut;
  return {
    status,
    status_command: evidence(daemonStatusCommand(input.command), input.result, input.maxOutputChars, false),
    parsed: parsed ? redactParsedJson(parsed) : null,
    running: parsed ? booleanField(parsed.running) : null,
    health: parsed ? stringField(parsed.health) ?? stringField(parsed.status) : null,
    restart_readiness: {
      ready,
      status: ready ? "ok" : status === "skipped" ? "skipped" : "warn",
      planned_command_ref: daemonRestartCommand(input.command),
      planned_mutates: true,
      executed: false,
      reasons: ready ? [] : readyReasons,
    },
  };
}

function redactParsedJson(value: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      redacted[key] = redactErrorMessage(redactPath(entry));
    } else if (Array.isArray(entry)) {
      redacted[key] = entry.map((item) => typeof item === "string" ? redactErrorMessage(redactPath(item)) : item);
    } else if (entry && typeof entry === "object") {
      redacted[key] = redactParsedJson(entry as Record<string, unknown>);
    } else {
      redacted[key] = entry;
    }
  }
  return redacted;
}

function rowWarnings(row: Omit<DispatchFleetSmokeMachineRow, "ok" | "status" | "warnings" | "errors">): string[] {
  const warnings = [...row.route_health.warnings];
  if (row.package_status.status === "warn") warnings.push("package_version_unavailable");
  if (row.daemon.status === "warn") warnings.push("daemon_restart_readiness_not_confirmed");
  if (!row.target.required && (row.route_health.status === "fail" || row.package_status.status === "fail")) warnings.push("optional_target_failure_downgraded");
  return [...new Set(warnings)];
}

function rowErrors(row: Omit<DispatchFleetSmokeMachineRow, "ok" | "status" | "warnings" | "errors">): string[] {
  const errors: string[] = [];
  if (row.target.required && row.route_health.status === "fail") errors.push("route_unavailable");
  if (row.target.required && row.package_status.status === "fail") errors.push("package_check_failed");
  return errors;
}

function buildSummary(rows: DispatchFleetSmokeMachineRow[]): DispatchFleetSmokeReport["summary"] {
  return {
    total: rows.length,
    ok: rows.filter((row) => row.status === "ok").length,
    warn: rows.filter((row) => row.status === "warn").length,
    fail: rows.filter((row) => row.status === "fail").length,
    skipped: rows.filter((row) => row.status === "skipped").length,
    route_ok: rows.filter((row) => row.route_health.ok).length,
    package_ok: rows.filter((row) => row.package_status.status === "ok").length,
    daemon_restart_ready: rows.filter((row) => row.daemon.restart_readiness.ready).length,
  };
}

export function getDispatchFleetSmoke(options: DispatchFleetSmokeOptions = {}): DispatchFleetSmokeReport {
  const now = options.now ?? new Date();
  const packageName = normalizePackageName(options.packageName);
  const command = normalizeCommandName(options.command, DEFAULT_DISPATCH_COMMAND);
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISPATCH_SMOKE_TIMEOUT_MS;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_DISPATCH_SMOKE_MAX_OUTPUT_CHARS;
  const topology = options.topology ?? discoverMachineTopology({
    ...options,
    runner: options.topologyRunner,
    includeTailscale: options.includeTailscale !== false,
    limit: null,
    offset: 0,
    now,
  });
  const selection = resolveTargets(options, topology);
  const runner = options.runner ?? defaultRunner;
  const commandOptions = { timeoutMs, killGraceMs: 1_000 };

  const rows = selection.targets.map((target) => {
    const routeHealth = buildRouteHealth(target, topology, options.privateMetadata === true);
    const packageResult = runner(target, packageProbeCommand(command), commandOptions);
    const packageStatus = buildPackageStatus({
      packageName,
      command,
      expectedVersion: options.expectedVersion ?? null,
      result: packageResult,
      maxOutputChars,
    });
    const daemonResult = packageStatus.command_found
      ? runner(target, daemonStatusCommand(command), commandOptions)
      : {
          machineId: target.machine_id,
          source: packageResult.source,
          stdout: "",
          stderr: "dispatch command missing; daemon status skipped",
          exitCode: 127,
        } satisfies MachineCommandResult;
    const daemon = buildDaemonStatus({
      command,
      packageFound: packageStatus.command_found,
      result: daemonResult,
      maxOutputChars,
    });
    const base = {
      target,
      route_health: routeHealth,
      package_status: packageStatus,
      daemon,
    };
    const status = rowStatus(base);
    const warnings = rowWarnings(base);
    const errors = rowErrors(base);
    return {
      ...base,
      ok: status === "ok" || status === "warn",
      status,
      warnings,
      errors,
    } satisfies DispatchFleetSmokeMachineRow;
  });

  const summary = buildSummary(rows);
  const errors = rows.flatMap((row) => row.errors.map((error) => `${row.target.target_id}:${error}`));
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageMetadata(),
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: generatedAt({ now }),
    kind: DISPATCH_FLEET_SMOKE_KIND,
    dryRun: true,
    dry_run: true,
    mutates: false,
    redaction: {
      enabled: true,
      marker: REDACTED_VALUE,
      private_metadata: options.privateMetadata === true,
    },
    selection: {
      default_fleet: selection.defaultFleet,
      package_name: packageName,
      command,
      expected_version: options.expectedVersion ?? null,
      ignored: selection.ignored,
    },
    bounds: {
      timeout_ms: timeoutMs,
      max_output_chars: maxOutputChars,
      machines: rows.length,
    },
    summary,
    machines: rows,
    warnings: [...new Set(rows.flatMap((row) => row.warnings))],
    errors,
  };
}
