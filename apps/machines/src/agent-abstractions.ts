import { createHash } from "node:crypto";
import { buildSshCommand } from "./commands/ssh.js";
import {
  checkMachineCompatibility,
  type CompatibilityCommandRunner,
  type CompatibilityCommandSpec,
  type CompatibilityPackageSpec,
  type CompatibilityWorkspaceSpec,
  type MachineCompatibilityReport,
} from "./compatibility.js";
import { REDACTED_VALUE } from "./redaction.js";
import {
  DEFAULT_MACHINE_LIST_LIMIT,
  MACHINE_LIST_ORDER,
  MACHINES_CONSUMER_CONTRACT_VERSION,
  MACHINES_PACKAGE_NAME,
  discoverMachineTopology,
  getMachinesConsumerCapabilities,
  redactRouteForOutput,
  resolveMachineRoute,
  resolveMachineWorkspace,
  type MachineListPagination,
  type MachineRouteConfidence,
  type MachineRouteKind,
  type MachineRouteResolution,
  type MachineTopology,
  type MachineTopologyEntry,
  type MachineTopologyOptions,
  type MachineWorkspaceResolution,
  type MachinesConsumerCapabilities,
  type MachinesContractPackage,
} from "./topology.js";
import { getPackageVersion } from "./version.js";

export const AGENT_ABSTRACTIONS_KIND = {
  machineHealth: "machine_health",
  routing: "routing",
  commandMatrix: "command_matrix",
  loopPreflight: "loop_preflight",
} as const;

export type AgentReadinessStatus = "ready" | "degraded" | "blocked" | "unknown";
export type AgentCheckStatus = "ok" | "warn" | "fail" | "unknown";

export interface AgentApiArtifactRef {
  kind: "topology" | "route" | "workspace" | "compatibility" | "doctor" | "command_matrix" | "machine_health";
  ref: string;
  format: "json" | "text";
  private: boolean;
}

export interface AgentApiDetailRefs {
  cli: string;
  mcp: string;
  sdk: string;
}

export interface AgentMachineSelectorOptions extends MachineTopologyOptions {
  topology?: MachineTopology;
  machineIds?: string[];
  privateMetadata?: boolean;
}

export interface AgentWorkspaceOptions {
  projectId?: string;
  repoName?: string;
  openFilesRepoName?: string;
  primaryMachineId?: string;
}

export interface AgentCompatibilityOptions {
  checkCompatibility?: boolean;
  commands?: CompatibilityCommandSpec[];
  packages?: CompatibilityPackageSpec[];
  workspaces?: CompatibilityWorkspaceSpec[];
  compatibilityRunner?: CompatibilityCommandRunner;
}

export interface MachineHealthOptions extends AgentMachineSelectorOptions, AgentWorkspaceOptions, AgentCompatibilityOptions {}

export interface CommandMatrixOptions extends AgentMachineSelectorOptions {
  command?: string;
  commandLabel?: string;
}

export interface FleetRoutingOptions extends AgentMachineSelectorOptions {}

export interface FleetLoopPreflightOptions extends MachineHealthOptions {
  command?: string;
  commandLabel?: string;
}

export interface MachineHealthCheckSummary {
  manifest: AgentCheckStatus;
  route: AgentCheckStatus;
  heartbeat: AgentCheckStatus;
  workspace?: AgentCheckStatus;
  compatibility?: AgentCheckStatus;
}

export interface MachineHealthRow {
  machine_id: string;
  display_name: string;
  status: AgentReadinessStatus;
  ok: boolean;
  route: MachineRouteKind;
  confidence: MachineRouteConfidence;
  local: boolean;
  heartbeat: MachineTopologyEntry["heartbeat_status"] | "missing";
  checks: MachineHealthCheckSummary;
  issues: string[];
  warnings: string[];
  detail_refs: AgentApiDetailRefs;
}

export interface AgentSummary {
  total: number;
  ready: number;
  degraded: number;
  blocked: number;
  unknown: number;
}

export interface MachineHealthReport {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: MachinesConsumerCapabilities;
  generated_at: string;
  kind: typeof AGENT_ABSTRACTIONS_KIND.machineHealth;
  pagination: MachineListPagination;
  summary: AgentSummary;
  machines: MachineHealthRow[];
  artifacts: AgentApiArtifactRef[];
  warnings: string[];
}

export interface RoutingRow {
  machine_id: string;
  display_name: string;
  ok: boolean;
  route: MachineRouteKind;
  source: MachineRouteKind;
  confidence: MachineRouteConfidence;
  local: boolean;
  heartbeat: MachineTopologyEntry["heartbeat_status"] | "missing";
  cacheable: boolean;
  target: string | null;
  command_target: string | null;
  warnings: string[];
  detail_refs: AgentApiDetailRefs;
}

export interface FleetRoutingReport {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: MachinesConsumerCapabilities;
  generated_at: string;
  kind: typeof AGENT_ABSTRACTIONS_KIND.routing;
  pagination: MachineListPagination;
  summary: {
    total: number;
    routable: number;
    local: number;
    remote: number;
    unroutable: number;
  };
  routes: RoutingRow[];
  artifacts: AgentApiArtifactRef[];
  warnings: string[];
}

export interface CommandMatrixCommandPlan {
  intent: "placeholder" | "provided";
  label: string;
  placeholder: string;
  command_ref: {
    provided: boolean;
    preview: string;
    sha256: string | null;
    length: number;
    redacted: boolean;
  };
  local_shell: string | null;
  cli: string;
  mcp: {
    tool: "machines_ssh_resolve";
    args: {
      machine_id: string;
      remote_command: string;
      private_metadata: false;
    };
  };
  sdk: string;
  private_shell_command: string | null;
}

export interface CommandMatrixRow {
  machine_id: string;
  display_name: string;
  can_run: boolean;
  readiness: AgentReadinessStatus;
  route: MachineRouteKind;
  source: MachineRouteKind;
  confidence: MachineRouteConfidence;
  local: boolean;
  command: CommandMatrixCommandPlan;
  blocked_by: string[];
  warnings: string[];
  detail_refs: AgentApiDetailRefs;
}

export interface CommandMatrixReport {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: MachinesConsumerCapabilities;
  generated_at: string;
  kind: typeof AGENT_ABSTRACTIONS_KIND.commandMatrix;
  mode: "plan";
  pagination: MachineListPagination;
  summary: {
    total: number;
    runnable: number;
    blocked: number;
    local: number;
    remote: number;
  };
  commands: CommandMatrixRow[];
  artifacts: AgentApiArtifactRef[];
  warnings: string[];
}

export interface LoopPreflightMachine {
  machine_id: string;
  display_name: string;
  ready: boolean;
  status: AgentReadinessStatus;
  can_run: boolean;
  route: MachineRouteKind;
  confidence: MachineRouteConfidence;
  local: boolean;
  heartbeat: MachineTopologyEntry["heartbeat_status"] | "missing";
  blocked_by: string[];
  warnings: string[];
  next_steps: string[];
  detail_refs: AgentApiDetailRefs;
}

export interface FleetLoopPreflightReport {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: MachinesConsumerCapabilities;
  generated_at: string;
  kind: typeof AGENT_ABSTRACTIONS_KIND.loopPreflight;
  mode: "plan";
  selection_mode: "explicit" | "discovered";
  ok: boolean;
  pagination: MachineListPagination;
  summary: AgentSummary & {
    runnable: number;
    any_ready: boolean;
    all_ready: boolean;
  };
  machines: LoopPreflightMachine[];
  artifacts: AgentApiArtifactRef[];
  warnings: string[];
}

interface SelectedMachine {
  machineId: string;
  entry: MachineTopologyEntry | null;
}

interface Selection {
  topology: MachineTopology;
  machines: SelectedMachine[];
  pagination: MachineListPagination;
  selectionMode: "explicit" | "discovered";
  warnings: string[];
}

function packageMetadata(): MachinesContractPackage {
  return { name: MACHINES_PACKAGE_NAME, version: getPackageVersion() };
}

function generatedAt(options: { now?: Date }): string {
  return (options.now ?? new Date()).toISOString();
}

function normalizeLimit(limit: number | null | undefined): number | null {
  if (limit === null) return null;
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_MACHINE_LIST_LIMIT;
  return Math.max(1, Math.floor(limit));
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

function normalizeMachineIds(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))];
}

function selectMachines(options: AgentMachineSelectorOptions): Selection {
  const explicitIds = normalizeMachineIds(options.machineIds);
  const hasExplicitIds = explicitIds.length > 0;
  const topology = options.topology ?? discoverMachineTopology({
    ...options,
    limit: hasExplicitIds ? null : options.limit,
    offset: hasExplicitIds ? 0 : options.offset,
  });
  const topologyById = new Map(topology.machines.map((machine) => [machine.machine_id, machine]));
  if (!hasExplicitIds) {
    return {
      topology,
      machines: topology.machines.map((entry) => ({ machineId: entry.machine_id, entry })),
      pagination: topology.pagination,
      selectionMode: "discovered",
      warnings: [...topology.warnings],
    };
  }

  const selected = hasExplicitIds
    ? explicitIds.map((machineId) => ({ machineId, entry: topologyById.get(machineId) ?? null }))
    : topology.machines.map((entry) => ({ machineId: entry.machine_id, entry }));

  const total = selected.length;
  const offset = hasExplicitIds ? normalizeOffset(options.offset) : topology.pagination.offset;
  const limit = hasExplicitIds ? normalizeLimit(options.limit) : topology.pagination.limit;
  const machines = limit === null ? selected.slice(offset) : selected.slice(offset, offset + limit);
  const nextOffset = offset + machines.length < total ? offset + machines.length : null;
  const hasMore = nextOffset !== null;

  return {
    topology,
    machines,
    pagination: {
      limit,
      offset,
      total,
      count: machines.length,
      hasMore,
      nextOffset,
      has_more: hasMore,
      next_offset: nextOffset,
      order: MACHINE_LIST_ORDER,
    },
    selectionMode: hasExplicitIds ? "explicit" : "discovered",
    warnings: [...topology.warnings],
  };
}

function detailRefs(machineId: string): AgentApiDetailRefs {
  return {
    cli: `machines details --machine ${shellQuote(machineId)} --json`,
    mcp: "machines_details",
    sdk: `getMachineDetails(${JSON.stringify(machineId)})`,
  };
}

function routingDetailRefs(machineId: string): AgentApiDetailRefs {
  return {
    cli: `machines route --machine ${shellQuote(machineId)} --json`,
    mcp: "machines_route_resolve",
    sdk: `resolveMachineRoute(${JSON.stringify(machineId)})`,
  };
}

function artifactRefs(limit: number | null, offset: number, privateMetadata = false): AgentApiArtifactRef[] {
  const paginationArgs = limit === null ? "--all" : `--limit ${limit} --offset ${offset}`;
  return [
    { kind: "topology", ref: `machines topology ${paginationArgs} --json`, format: "json", private: false },
    { kind: "doctor", ref: "machines doctor --machine <machine-id> --json", format: "json", private: false },
    { kind: "route", ref: `machines route --machine <machine-id>${privateMetadata ? " --private-metadata" : ""} --json`, format: "json", private: privateMetadata },
  ];
}

function summary(rows: Array<{ status: AgentReadinessStatus }>): AgentSummary {
  return {
    total: rows.length,
    ready: rows.filter((row) => row.status === "ready").length,
    degraded: rows.filter((row) => row.status === "degraded").length,
    blocked: rows.filter((row) => row.status === "blocked").length,
    unknown: rows.filter((row) => row.status === "unknown").length,
  };
}

function statusFromChecks(checks: MachineHealthCheckSummary): AgentReadinessStatus {
  const values = Object.values(checks);
  if (values.includes("fail")) return "blocked";
  if (values.includes("unknown")) return "unknown";
  if (values.includes("warn")) return "degraded";
  return "ready";
}

function checkStatusFromCompatibility(report: MachineCompatibilityReport): AgentCheckStatus {
  if (report.summary.fail > 0) return "fail";
  if (report.summary.warn > 0) return "warn";
  return "ok";
}

function routeCheckStatus(route: MachineRouteResolution): AgentCheckStatus {
  if (!route.ok) return "fail";
  if (route.confidence === "none") return "fail";
  if (route.confidence === "low") return "warn";
  return "ok";
}

function heartbeatCheckStatus(entry: MachineTopologyEntry | null, route: MachineRouteResolution): AgentCheckStatus {
  if (!entry) return "fail";
  if (entry.heartbeat_status === "online") return "ok";
  if (entry.heartbeat_status === "offline") return route.local ? "warn" : "fail";
  return route.local ? "warn" : "warn";
}

function workspaceCheckStatus(workspace: MachineWorkspaceResolution): AgentCheckStatus {
  if (workspace.ok) return "ok";
  return workspace.diagnostics.some((diagnostic) => diagnostic.severity === "fail") ? "fail" : "warn";
}

function bounded(values: string[], limit = 6): string[] {
  return values.slice(0, limit);
}

function issuesFromChecks(checks: MachineHealthCheckSummary): string[] {
  return Object.entries(checks)
    .filter(([, status]) => status === "fail" || status === "warn" || status === "unknown")
    .map(([key, status]) => `${key}:${status}`);
}

function findCompatibilityIssues(report: MachineCompatibilityReport): string[] {
  return report.checks
    .filter((check) => check.status !== "ok")
    .map((check) => `${check.id}:${check.status}`);
}

function buildHealthRow(input: {
  selected: SelectedMachine;
  topology: MachineTopology;
  options: MachineHealthOptions;
}): MachineHealthRow {
  const machineId = input.selected.machineId;
  const route = resolveMachineRoute(machineId, { ...input.options, topology: input.topology });
  const entry = input.selected.entry;
  const checks: MachineHealthCheckSummary = {
    manifest: entry ? entry.manifest_declared ? "ok" : "warn" : "fail",
    route: routeCheckStatus(route),
    heartbeat: heartbeatCheckStatus(entry, route),
  };
  const warnings = [...route.warnings];
  const extraIssues: string[] = [];

  if (input.options.projectId) {
    const workspace = resolveMachineWorkspace({
      ...input.options,
      machineId,
      projectId: input.options.projectId,
      repoName: input.options.repoName,
      openFilesRepoName: input.options.openFilesRepoName,
      primaryMachineId: input.options.primaryMachineId,
      topology: input.topology,
    });
    checks.workspace = workspaceCheckStatus(workspace);
    warnings.push(...workspace.warnings);
    extraIssues.push(...workspace.diagnostics
      .filter((diagnostic) => diagnostic.severity !== "ok")
      .map((diagnostic) => `${diagnostic.id}:${diagnostic.status}`));
  }

  if (input.options.checkCompatibility) {
    const compatibility = checkMachineCompatibility({
      machineId,
      commands: input.options.commands,
      packages: input.options.packages,
      workspaces: input.options.workspaces,
      runner: input.options.compatibilityRunner,
      now: input.options.now,
    });
    checks.compatibility = checkStatusFromCompatibility(compatibility);
    extraIssues.push(...findCompatibilityIssues(compatibility));
  }

  const status = statusFromChecks(checks);
  return {
    machine_id: machineId,
    display_name: entry?.display_name ?? machineId,
    status,
    ok: status === "ready" || status === "degraded",
    route: route.route,
    confidence: route.confidence,
    local: route.local,
    heartbeat: entry?.heartbeat_status ?? "missing",
    checks,
    issues: bounded([...issuesFromChecks(checks), ...extraIssues]),
    warnings: bounded([...new Set(warnings)]),
    detail_refs: detailRefs(machineId),
  };
}

export function getFleetMachineHealth(options: MachineHealthOptions = {}): MachineHealthReport {
  const selection = selectMachines(options);
  const machines = selection.machines.map((selected) => buildHealthRow({ selected, topology: selection.topology, options }));
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageMetadata(),
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: generatedAt(options),
    kind: AGENT_ABSTRACTIONS_KIND.machineHealth,
    pagination: selection.pagination,
    summary: summary(machines),
    machines,
    artifacts: [
      ...artifactRefs(selection.pagination.limit, selection.pagination.offset, options.privateMetadata),
      { kind: "compatibility", ref: "machines compatibility --machine <machine-id> --json", format: "json", private: false },
    ],
    warnings: bounded([...new Set(selection.warnings)]),
  };
}

function buildRoutingRow(input: {
  selected: SelectedMachine;
  topology: MachineTopology;
  options: FleetRoutingOptions;
}): RoutingRow {
  const route = resolveMachineRoute(input.selected.machineId, { ...input.options, topology: input.topology });
  const publicRoute = redactRouteForOutput(route, { privateMetadata: input.options.privateMetadata });
  return {
    machine_id: input.selected.machineId,
    display_name: input.selected.entry?.display_name ?? input.selected.machineId,
    ok: route.ok,
    route: publicRoute.route,
    source: publicRoute.source,
    confidence: publicRoute.confidence,
    local: publicRoute.local,
    heartbeat: input.selected.entry?.heartbeat_status ?? "missing",
    cacheable: publicRoute.cacheability.cacheable,
    target: publicRoute.target,
    command_target: publicRoute.command_target,
    warnings: bounded(publicRoute.warnings),
    detail_refs: routingDetailRefs(input.selected.machineId),
  };
}

export function getFleetRouting(options: FleetRoutingOptions = {}): FleetRoutingReport {
  const selection = selectMachines(options);
  const routes = selection.machines.map((selected) => buildRoutingRow({ selected, topology: selection.topology, options }));
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageMetadata(),
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: generatedAt(options),
    kind: AGENT_ABSTRACTIONS_KIND.routing,
    pagination: selection.pagination,
    summary: {
      total: routes.length,
      routable: routes.filter((route) => route.ok).length,
      local: routes.filter((route) => route.ok && route.local).length,
      remote: routes.filter((route) => route.ok && !route.local).length,
      unroutable: routes.filter((route) => !route.ok).length,
    },
    routes,
    artifacts: artifactRefs(selection.pagination.limit, selection.pagination.offset, options.privateMetadata),
    warnings: bounded([...new Set(selection.warnings)]),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function plannedCommand(command: string | undefined): string {
  return command?.trim() || "<loop-command>";
}

function commandIntent(command: string | undefined): CommandMatrixCommandPlan["intent"] {
  return command?.trim() ? "provided" : "placeholder";
}

function truncateCommand(value: string, limit = 80): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function commandSha256(command: string | undefined): string | null {
  const trimmed = command?.trim();
  return trimmed ? createHash("sha256").update(trimmed).digest("hex") : null;
}

function readinessForCommand(route: MachineRouteResolution): AgentReadinessStatus {
  if (!route.ok) return "blocked";
  if (route.confidence === "low") return "degraded";
  if (route.confidence === "none") return "unknown";
  return "ready";
}

function blockedByForCommand(route: MachineRouteResolution): string[] {
  const blocked: string[] = [];
  if (!route.ok) blocked.push("route_unavailable");
  if (route.confidence === "none") blocked.push("route_confidence_none");
  if (route.confidence === "low") blocked.push("route_confidence_low");
  return blocked;
}

function buildCommandPlan(input: {
  machineId: string;
  route: MachineRouteResolution;
  topology: MachineTopology;
  options: CommandMatrixOptions;
}): CommandMatrixCommandPlan {
  const command = plannedCommand(input.options.command);
  const provided = commandIntent(input.options.command) === "provided";
  const publicCommand = input.options.privateMetadata ? command : "<loop-command>";
  const cliCommand = input.route.local
    ? `bash -lc ${shellQuote(publicCommand)}`
    : `machines ssh --machine ${shellQuote(input.machineId)} --cmd ${shellQuote(publicCommand)}${input.options.privateMetadata ? " --private-metadata" : ""}`;
  let privateShellCommand: string | null = null;
  if (input.options.privateMetadata && input.route.ok) {
    try {
      privateShellCommand = input.route.local ? command : buildSshCommand(input.machineId, command, { topology: input.topology });
    } catch {
      privateShellCommand = null;
    }
  }

  return {
    intent: commandIntent(input.options.command),
    label: input.options.commandLabel?.trim() || "loop-command",
    placeholder: "<loop-command>",
    command_ref: {
      provided,
      preview: provided && input.options.privateMetadata ? truncateCommand(command) : provided ? REDACTED_VALUE : "<loop-command>",
      sha256: commandSha256(input.options.command),
      length: input.options.command?.trim().length ?? 0,
      redacted: provided && !input.options.privateMetadata,
    },
    local_shell: input.route.local && input.options.privateMetadata ? command : null,
    cli: cliCommand,
    mcp: {
      tool: "machines_ssh_resolve",
      args: {
        machine_id: input.machineId,
        remote_command: publicCommand,
        private_metadata: false,
      },
    },
    sdk: `resolveMachineCommand(${JSON.stringify(input.machineId)}, command)`,
    private_shell_command: privateShellCommand ?? (input.options.privateMetadata ? null : REDACTED_VALUE),
  };
}

function buildCommandMatrixRow(input: {
  selected: SelectedMachine;
  topology: MachineTopology;
  options: CommandMatrixOptions;
}): CommandMatrixRow {
  const route = resolveMachineRoute(input.selected.machineId, { ...input.options, topology: input.topology });
  const readiness = readinessForCommand(route);
  return {
    machine_id: input.selected.machineId,
    display_name: input.selected.entry?.display_name ?? input.selected.machineId,
    can_run: route.ok,
    readiness,
    route: route.route,
    source: route.source,
    confidence: route.confidence,
    local: route.local,
    command: buildCommandPlan({
      machineId: input.selected.machineId,
      route,
      topology: input.topology,
      options: input.options,
    }),
    blocked_by: blockedByForCommand(route),
    warnings: bounded(route.warnings),
    detail_refs: routingDetailRefs(input.selected.machineId),
  };
}

export function getCommandMatrix(options: CommandMatrixOptions = {}): CommandMatrixReport {
  const selection = selectMachines(options);
  const commands = selection.machines.map((selected) => buildCommandMatrixRow({ selected, topology: selection.topology, options }));
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageMetadata(),
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: generatedAt(options),
    kind: AGENT_ABSTRACTIONS_KIND.commandMatrix,
    mode: "plan",
    pagination: selection.pagination,
    summary: {
      total: commands.length,
      runnable: commands.filter((command) => command.can_run).length,
      blocked: commands.filter((command) => !command.can_run).length,
      local: commands.filter((command) => command.can_run && command.local).length,
      remote: commands.filter((command) => command.can_run && !command.local).length,
    },
    commands,
    artifacts: [
      ...artifactRefs(selection.pagination.limit, selection.pagination.offset, options.privateMetadata),
      { kind: "command_matrix", ref: "machines command-matrix --machine <machine-id> --cmd '<command>'", format: "json", private: false },
    ],
    warnings: bounded([...new Set(selection.warnings)]),
  };
}

function nextStepsFor(machine: MachineHealthRow, command: CommandMatrixRow): string[] {
  const steps: string[] = [];
  if (machine.status === "ready" && command.can_run) return ["run_loop"];
  if (machine.checks.route === "fail") steps.push(`inspect_route:${machine.machine_id}`);
  if (machine.checks.workspace === "fail" || machine.checks.workspace === "warn") steps.push(`inspect_workspace:${machine.machine_id}`);
  if (machine.checks.compatibility === "fail" || machine.checks.compatibility === "warn") steps.push(`inspect_compatibility:${machine.machine_id}`);
  if (machine.checks.heartbeat === "fail" || machine.checks.heartbeat === "warn") steps.push(`inspect_daemon:${machine.machine_id}`);
  if (steps.length === 0 && !command.can_run) steps.push(`inspect_command_matrix:${machine.machine_id}`);
  return bounded(steps, 4);
}

export function getFleetLoopPreflight(options: FleetLoopPreflightOptions = {}): FleetLoopPreflightReport {
  const selection = selectMachines(options);
  const healthRows = selection.machines.map((selected) => buildHealthRow({ selected, topology: selection.topology, options }));
  const commandRows = selection.machines.map((selected) => buildCommandMatrixRow({ selected, topology: selection.topology, options }));
  const commandByMachine = new Map(commandRows.map((row) => [row.machine_id, row]));
  const machines = healthRows.map((health) => {
    const command = commandByMachine.get(health.machine_id);
    const canRun = command?.can_run === true;
    const ready = (health.status === "ready" || health.status === "degraded") && canRun;
    const blockedBy = bounded([...health.issues, ...(command?.blocked_by ?? [])]);
    return {
      machine_id: health.machine_id,
      display_name: health.display_name,
      ready,
      status: ready ? health.status : health.status === "ready" ? "blocked" : health.status,
      can_run: canRun,
      route: command?.route ?? health.route,
      confidence: command?.confidence ?? health.confidence,
      local: command?.local ?? health.local,
      heartbeat: health.heartbeat,
      blocked_by: blockedBy,
      warnings: bounded([...new Set([...health.warnings, ...(command?.warnings ?? [])])]),
      next_steps: nextStepsFor(health, command ?? {
        machine_id: health.machine_id,
        display_name: health.display_name,
        can_run: false,
        readiness: "blocked",
        route: health.route,
        source: health.route,
        confidence: health.confidence,
        local: health.local,
        command: buildCommandPlan({
          machineId: health.machine_id,
          route: resolveMachineRoute(health.machine_id, { ...options, topology: selection.topology }),
          topology: selection.topology,
          options,
        }),
        blocked_by: ["command_matrix_unavailable"],
        warnings: [],
        detail_refs: routingDetailRefs(health.machine_id),
      }),
      detail_refs: health.detail_refs,
    } satisfies LoopPreflightMachine;
  });
  const baseSummary = summary(machines);
  const anyReady = machines.some((machine) => machine.ready);
  const allReady = machines.length > 0 && machines.every((machine) => machine.ready);
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageMetadata(),
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: generatedAt(options),
    kind: AGENT_ABSTRACTIONS_KIND.loopPreflight,
    mode: "plan",
    selection_mode: selection.selectionMode,
    ok: allReady,
    pagination: selection.pagination,
    summary: {
      ...baseSummary,
      runnable: machines.filter((machine) => machine.can_run).length,
      any_ready: anyReady,
      all_ready: allReady,
    },
    machines,
    artifacts: [
      ...artifactRefs(selection.pagination.limit, selection.pagination.offset, options.privateMetadata),
      { kind: "machine_health", ref: "machines machine-health --json", format: "json", private: false },
      { kind: "command_matrix", ref: "machines command-matrix --json", format: "json", private: false },
    ],
    warnings: bounded([...new Set(selection.warnings)]),
  };
}
