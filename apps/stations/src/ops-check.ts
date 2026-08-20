import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  getFleetLoopPreflight,
  getFleetMachineHealth,
  getFleetRouting,
  type FleetLoopPreflightReport,
  type FleetRoutingReport,
  type MachineHealthReport,
} from "./agent-abstractions.js";
import { probeTmuxPane, type TmuxPaneProbeResult } from "./commands/runtime.js";
import { redactErrorMessage } from "./redaction.js";
import {
  discoverMachineTopology,
  getStationsConsumerCapabilities,
  STATIONS_CONSUMER_CONTRACT_VERSION,
  STATIONS_PACKAGE_NAME,
  type MachineTopology,
  type MachineTopologyOptions,
} from "./topology.js";
import { getPackageVersion } from "./version.js";

export type FleetOpsSeverity = "critical" | "warning" | "notice";
export type FleetOpsStatus = "ok" | "attention" | "critical";

export interface FleetOpsTaskSuggestion {
  fingerprint: string;
  dedupe_key: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  tags: string[];
}

export interface FleetOpsEventSuggestion {
  type: "stations.ops.issue";
  source: "stations";
  subject: string;
  severity: FleetOpsSeverity;
  message: string;
  dedupe_key: string;
  data: Record<string, unknown>;
}

export interface FleetOpsTaskAction {
  action: "created" | "existing" | "failed";
  dedupe_key: string;
  title: string;
  task_id?: string;
  error?: string;
}

export interface TodosCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: unknown;
}

export type TodosCommandRunner = (args: string[]) => TodosCommandResult;

export interface FleetOpsTaskUpsertOptions {
  project?: string;
  taskList?: string;
  todosBin?: string;
  maxActions?: number;
  commandTimeoutMs?: number;
  runner?: TodosCommandRunner;
}

export interface FleetOpsIssue {
  fingerprint: string;
  machine_id: string | null;
  severity: FleetOpsSeverity;
  classification: string;
  summary: string;
  evidence: Record<string, unknown>[];
  recommendation: string;
}

interface FleetOpsIssueWithSuggestions extends FleetOpsIssue {
  task_suggestion: FleetOpsTaskSuggestion;
  event_suggestion: FleetOpsEventSuggestion;
}

export interface FleetOpsMachineRow {
  machine_id: string;
  display_name: string;
  status: "ready" | "degraded" | "blocked" | "unknown";
  ok: boolean;
  route_ok: boolean;
  route: string;
  route_confidence: string;
  heartbeat: string;
  storage_sync_status: string | null;
  doctor_status: string | null;
  issues: string[];
  warnings: string[];
}

export interface FleetOpsTmuxExpectation {
  machineId?: string;
  target: string;
  label?: string;
}

export interface FleetOpsTmuxPane {
  ref: string;
  session: string;
  window: string;
  pane: string;
  pane_dead: boolean;
  current_command: string;
  dead_status: number | null;
  start_command: string;
}

export interface FleetOpsTmuxSummary {
  checked: boolean;
  local_machine_id: string;
  total_panes: number;
  dead_panes: FleetOpsTmuxPane[];
  expected: Array<{
    machine_id: string;
    target: string;
    label: string | null;
    checked: boolean;
    exists: boolean | null;
    pane_id: string | null;
    error: string | null;
  }>;
  errors: string[];
}

export interface FleetOpsCheckOptions extends MachineTopologyOptions {
  topology?: MachineTopology;
  machineIds?: string[];
  expectedStations?: string[];
  expectedTmux?: FleetOpsTmuxExpectation[];
  command?: string;
  commandLabel?: string;
  maxEvidenceItems?: number;
  maxTaskSuggestions?: number;
  tmuxCommand?: string;
  tmuxProbe?: (target: string) => TmuxPaneProbeResult;
  tmuxList?: (tmuxCommand?: string) => { panes: FleetOpsTmuxPane[]; error: string | null };
}

export interface FleetOpsCheck {
  schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
  package: {
    name: typeof STATIONS_PACKAGE_NAME;
    version: string;
  };
  capabilities: ReturnType<typeof getStationsConsumerCapabilities>;
  generated_at: string;
  kind: "fleet_ops_check";
  ok: boolean;
  status: FleetOpsStatus;
  summary: {
    stations: number;
    ready: number;
    degraded: number;
    blocked: number;
    unknown: number;
    route_blocked: number;
    heartbeat_attention: number;
    storage_attention: number;
    tmux_dead_panes: number;
    tmux_missing_expected: number;
    issues: number;
    task_suggestions: number;
  };
  stations: FleetOpsMachineRow[];
  tmux: FleetOpsTmuxSummary;
  issues: FleetOpsIssue[];
  task_suggestions: FleetOpsTaskSuggestion[];
  task_actions?: FleetOpsTaskAction[];
  event_suggestions: FleetOpsEventSuggestion[];
  artifacts: Array<{ kind: string; ref: string; format: "json" | "text"; private: boolean }>;
  warnings: string[];
  bounds: {
    max_evidence_items: number;
    max_task_suggestions: number;
    truncated_task_suggestions: number;
  };
  composed: {
    machine_health: MachineHealthReport["kind"];
    routing: FleetRoutingReport["kind"];
    loop_preflight: FleetLoopPreflightReport["kind"];
    tmux_diagnostics: "read_only";
    todo_dependency: "none";
  };
}

const DEFAULT_MAX_EVIDENCE_ITEMS = 12;
const DEFAULT_MAX_TASK_SUGGESTIONS = 20;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function boundedText(value: string, maxLength = 1_000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]` : value;
}

function safeTag(value: string): string {
  const tag = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return tag || "unknown";
}

function dedupeTag(suggestion: FleetOpsTaskSuggestion): string {
  return `dedupe-${fingerprint(suggestion.dedupe_key)}`;
}

function severityRank(severity: FleetOpsSeverity): number {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function priorityFor(severity: FleetOpsSeverity): FleetOpsTaskSuggestion["priority"] {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "high";
  return "medium";
}

function boundedEvidence(evidence: Record<string, unknown>[], limit: number): Record<string, unknown>[] {
  return evidence.slice(0, limit).map((entry) => {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value === "string") {
        redacted[key] = redactErrorMessage(value.length > 500 ? `${value.slice(0, 500)}...[truncated]` : value);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  });
}

function taskDescription(issue: FleetOpsIssue): string {
  return [
    `classification: ${issue.classification}`,
    `severity: ${issue.severity}`,
    `fingerprint: ${issue.fingerprint}`,
    `machine: ${issue.machine_id ?? "fleet"}`,
    `summary: ${issue.summary}`,
    `recommendation: ${issue.recommendation}`,
    "evidence:",
    JSON.stringify(issue.evidence, null, 2),
    "",
    "This is a task suggestion emitted by @hasna/stations. It does not route work through tmux, change panes, or mutate todos directly.",
  ].join("\n");
}

function taskUpsertDescription(result: FleetOpsCheck, suggestion: FleetOpsTaskSuggestion): string {
  return [
    `dedupe_key: ${suggestion.dedupe_key}`,
    "source: @hasna/stations ops check",
    `checked_at: ${result.generated_at}`,
    `status: ${result.status}`,
    "",
    suggestion.description,
  ].join("\n");
}

function defaultTodosRunner(todosBin: string, timeoutMs = 30_000): TodosCommandRunner {
  return (args) => {
    const child = spawnSync(todosBin, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
    });
    return {
      status: child.status,
      stdout: child.stdout ?? "",
      stderr: child.stderr ?? "",
      error: child.error,
    };
  };
}

function parseTaskList(stdout: string): Array<{ id?: string; status?: string }> {
  const raw = stdout.trim();
  if (!raw) return [];
  const value = JSON.parse(raw) as unknown;
  if (Array.isArray(value)) return value as Array<{ id?: string; status?: string }>;
  if (value && typeof value === "object" && "tasks" in value && Array.isArray((value as { tasks?: unknown }).tasks)) {
    return (value as { tasks: Array<{ id?: string; status?: string }> }).tasks;
  }
  return [];
}

function parseTask(stdout: string): { id?: string; status?: string } | null {
  const raw = stdout.trim();
  if (!raw) return null;
  const value = JSON.parse(raw) as unknown;
  return value && typeof value === "object" ? value as { id?: string; status?: string } : null;
}

function todosBaseArgs(project: string): string[] {
  return ["--project", project, "-j"];
}

export function upsertFleetOpsCheckTasks(
  result: FleetOpsCheck,
  options: FleetOpsTaskUpsertOptions,
): FleetOpsTaskAction[] {
  const maxActions = options.maxActions ?? result.task_suggestions.length;
  const suggestions = result.task_suggestions.slice(0, Math.max(0, maxActions));
  if (suggestions.length === 0) {
    result.task_actions = [];
    return [];
  }

  if (!options.project) {
    const actions = suggestions.map((suggestion) => ({
      action: "failed" as const,
      dedupe_key: suggestion.dedupe_key,
      title: suggestion.title,
      error: "--todos-project is required when --upsert-tasks is used",
    }));
    result.task_actions = actions;
    return actions;
  }

  const run = options.runner ?? defaultTodosRunner(options.todosBin ?? "todos", options.commandTimeoutMs);
  const actions: FleetOpsTaskAction[] = [];
  for (const suggestion of suggestions) {
    const tag = dedupeTag(suggestion);
    const tags = [...new Set([...suggestion.tags.map(safeTag), tag])];
    const search = run([...todosBaseArgs(options.project), "search", tag, "--tag", tag, "--limit", "10"]);
    if (search.error || search.status !== 0) {
      actions.push({
        action: "failed",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        error: boundedText(String(search.error ?? (search.stderr.trim() || `todos search exited ${search.status}`))),
      });
      continue;
    }

    let existing: { id?: string; status?: string } | undefined;
    try {
      existing = parseTaskList(search.stdout).find((task) => task.id && !["done", "completed", "cancelled", "deleted"].includes(task.status ?? ""));
    } catch (error) {
      actions.push({
        action: "failed",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        error: `unable to parse todos search JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (existing?.id) {
      actions.push({
        action: "existing",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        task_id: existing.id,
      });
      continue;
    }

    const addArgs = [
      ...todosBaseArgs(options.project),
      "add",
      suggestion.title,
      "-d",
      taskUpsertDescription(result, suggestion),
      "-p",
      suggestion.priority,
      "--tags",
      tags.join(","),
    ];
    if (options.taskList) addArgs.push("--task-list", options.taskList);

    const created = run(addArgs);
    if (created.error || created.status !== 0) {
      actions.push({
        action: "failed",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        error: boundedText(String(created.error ?? (created.stderr.trim() || `todos add exited ${created.status}`))),
      });
      continue;
    }

    try {
      const task = parseTask(created.stdout);
      actions.push({
        action: "created",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        task_id: task?.id,
      });
    } catch (error) {
      actions.push({
        action: "failed",
        dedupe_key: suggestion.dedupe_key,
        title: suggestion.title,
        error: `unable to parse todos add JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  result.task_actions = actions;
  return actions;
}

function buildIssue(input: {
  machineId: string | null;
  severity: FleetOpsSeverity;
  classification: string;
  summary: string;
  evidence: Record<string, unknown>[];
  recommendation: string;
  tags?: string[];
  maxEvidenceItems: number;
}): FleetOpsIssueWithSuggestions {
  const fp = fingerprint({
    classification: input.classification,
    machineId: input.machineId,
    summary: input.summary,
    evidence: input.evidence,
  });
  const issueBase = {
    fingerprint: fp,
    machine_id: input.machineId,
    severity: input.severity,
    classification: input.classification,
    summary: input.summary,
    evidence: boundedEvidence(input.evidence, input.maxEvidenceItems),
    recommendation: input.recommendation,
  };
  const taskSuggestion: FleetOpsTaskSuggestion = {
    fingerprint: fp,
    dedupe_key: `stations:ops:${fp}`,
    title: `[stations:ops:${fp}] ${input.severity} ${input.classification}`,
    description: taskDescription(issueBase),
    priority: priorityFor(input.severity),
    tags: ["stations", "ops-check", input.classification, ...(input.tags ?? [])],
  };
  const eventSuggestion: FleetOpsEventSuggestion = {
    type: "stations.ops.issue",
    source: "stations",
    subject: input.machineId ? `machine:${input.machineId}` : "fleet",
    severity: input.severity,
    message: input.summary,
    dedupe_key: `stations:ops:${fp}`,
    data: {
      classification: input.classification,
      machine_id: input.machineId,
      fingerprint: fp,
    },
  };
  return {
    ...issueBase,
    task_suggestion: taskSuggestion,
    event_suggestion: eventSuggestion,
  };
}

function statusFromIssues(issues: FleetOpsIssue[]): FleetOpsStatus {
  if (issues.some((issue) => issue.severity === "critical")) return "critical";
  if (issues.some((issue) => issue.severity === "warning")) return "attention";
  return issues.length > 0 ? "attention" : "ok";
}

function doctorStatus(summary: Record<string, unknown> | null): string | null {
  const status = summary?.["overall"] ?? summary?.["overallStatus"] ?? summary?.["status"];
  return typeof status === "string" ? status : null;
}

function normalizeExpectedStations(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
}

function tmuxLineToPane(line: string): FleetOpsTmuxPane | null {
  const [session, window, pane, paneDead, currentCommand, deadStatus, startCommand] = line.split("\t");
  if (!session || !window || !pane) return null;
  return {
    ref: `${session}:${window}.${pane}`,
    session,
    window,
    pane,
    pane_dead: paneDead === "1",
    current_command: redactErrorMessage(currentCommand ?? ""),
    dead_status: deadStatus ? Number.parseInt(deadStatus, 10) : null,
    start_command: redactErrorMessage(startCommand ?? ""),
  };
}

export function listLocalTmuxPanes(tmuxCommand = process.env["HASNA_STATIONS_TMUX_BIN"] || "tmux"): { panes: FleetOpsTmuxPane[]; error: string | null } {
  const result = spawnSync(tmuxCommand, [
    "list-panes",
    "-a",
    "-F",
    "#S\t#I\t#P\t#{pane_dead}\t#{pane_current_command}\t#{pane_dead_status}\t#{pane_start_command}",
  ], {
    encoding: "utf8",
    timeout: 5000,
  });
  const stderr = result.stderr?.trim() ?? "";
  const noServer = /no server running|failed to connect|no sessions/i.test(stderr);
  if (noServer) return { panes: [], error: null };
  if (result.status !== 0) {
    return { panes: [], error: redactErrorMessage(result.error?.message ?? (stderr || `tmux exited ${result.status}`)) };
  }
  return {
    panes: result.stdout.split(/\r?\n/).flatMap((line) => {
      const pane = tmuxLineToPane(line);
      return pane ? [pane] : [];
    }),
    error: null,
  };
}

function inspectTmuxExpectations(options: {
  topology: MachineTopology;
  expectedTmux: FleetOpsTmuxExpectation[];
  tmuxCommand?: string;
  tmuxProbe?: (target: string) => TmuxPaneProbeResult;
  tmuxList?: (tmuxCommand?: string) => { panes: FleetOpsTmuxPane[]; error: string | null };
}): FleetOpsTmuxSummary {
  const tmuxList = options.tmuxList ?? listLocalTmuxPanes;
  const tmuxProbe = options.tmuxProbe ?? ((target: string) => probeTmuxPane(target, options.tmuxCommand));
  const listed = tmuxList(options.tmuxCommand);
  const localMachineId = options.topology.local_machine_id;
  const expected = options.expectedTmux.map((entry) => {
    const machineId = entry.machineId ?? localMachineId;
    if (machineId !== localMachineId && machineId !== "local") {
      return {
        machine_id: machineId,
        target: entry.target,
        label: entry.label ?? null,
        checked: false,
        exists: null,
        pane_id: null,
        error: "remote tmux expectation not probed by this read-only local check",
      };
    }
    try {
      const probe = tmuxProbe(entry.target);
      return {
        machine_id: localMachineId,
        target: entry.target,
        label: entry.label ?? null,
        checked: true,
        exists: probe.exists,
        pane_id: probe.paneId ?? null,
        error: probe.error ?? probe.stderr ?? null,
      };
    } catch (error) {
      return {
        machine_id: localMachineId,
        target: entry.target,
        label: entry.label ?? null,
        checked: true,
        exists: false,
        pane_id: null,
        error: error instanceof Error ? redactErrorMessage(error.message) : redactErrorMessage(String(error)),
      };
    }
  });
  return {
    checked: true,
    local_machine_id: localMachineId,
    total_panes: listed.panes.length,
    dead_panes: listed.panes.filter((pane) => pane.pane_dead),
    expected,
    errors: listed.error ? [listed.error] : [],
  };
}

function buildMachineRows(input: {
  topology: MachineTopology;
  health: MachineHealthReport;
  routing: FleetRoutingReport;
}): FleetOpsMachineRow[] {
  const topologyById = new Map(input.topology.stations.map((machine) => [machine.machine_id, machine]));
  const routeById = new Map(input.routing.routes.map((route) => [route.machine_id, route]));
  return input.health.stations.map((machine) => {
    const topologyEntry = topologyById.get(machine.machine_id);
    const route = routeById.get(machine.machine_id);
    const storageSyncStatus = topologyEntry?.agent.storage_sync_status ?? null;
    const currentDoctorStatus = doctorStatus(topologyEntry?.agent.doctor_summary ?? null);
    return {
      machine_id: machine.machine_id,
      display_name: machine.display_name,
      status: machine.status,
      ok: machine.ok,
      route_ok: route?.ok ?? machine.checks.route !== "fail",
      route: route?.route ?? machine.route,
      route_confidence: route?.confidence ?? machine.confidence,
      heartbeat: machine.heartbeat,
      storage_sync_status: storageSyncStatus,
      doctor_status: currentDoctorStatus,
      issues: machine.issues,
      warnings: machine.warnings,
    };
  });
}

function buildIssues(input: {
  stations: FleetOpsMachineRow[];
  expectedStations: string[];
  topology: MachineTopology;
  tmux: FleetOpsTmuxSummary;
  maxEvidenceItems: number;
}): FleetOpsIssueWithSuggestions[] {
  const issues: FleetOpsIssueWithSuggestions[] = [];
  const machineIds = new Set(input.topology.stations.map((machine) => machine.machine_id));
  for (const expected of input.expectedStations) {
    if (!machineIds.has(expected)) {
      issues.push(buildIssue({
        machineId: expected,
        severity: "critical",
        classification: "expected-machine-missing",
        summary: `Expected machine ${expected} is missing from topology`,
        evidence: [{ expected_machine: expected, known_machines: [...machineIds].sort() }],
        recommendation: "Verify the fleet manifest and heartbeat sync before routing work to this machine.",
        tags: [expected],
        maxEvidenceItems: input.maxEvidenceItems,
      }));
    }
  }

  for (const machine of input.stations) {
    if (!machine.route_ok || machine.status === "blocked") {
      issues.push(buildIssue({
        machineId: machine.machine_id,
        severity: "critical",
        classification: "machine-route-blocked",
        summary: `${machine.machine_id} is not safely routable`,
        evidence: [{ route: machine.route, confidence: machine.route_confidence, issues: machine.issues }],
        recommendation: "Inspect route diagnostics and machine manifest data; do not fall back to tmux panes for work routing.",
        tags: [machine.machine_id],
        maxEvidenceItems: input.maxEvidenceItems,
      }));
    }
    if (machine.heartbeat !== "online") {
      issues.push(buildIssue({
        machineId: machine.machine_id,
        severity: machine.heartbeat === "offline" ? "critical" : "warning",
        classification: "machine-heartbeat-attention",
        summary: `${machine.machine_id} heartbeat is ${machine.heartbeat}`,
        evidence: [{ heartbeat: machine.heartbeat, warnings: machine.warnings }],
        recommendation: "Collect a fresh stations-daemon heartbeat or inspect the daemon; remediation should be routed through task-triggered workflows.",
        tags: [machine.machine_id],
        maxEvidenceItems: input.maxEvidenceItems,
      }));
    }
    if (machine.storage_sync_status && !["ok", "synced", "idle"].includes(machine.storage_sync_status.toLowerCase())) {
      issues.push(buildIssue({
        machineId: machine.machine_id,
        severity: "warning",
        classification: "machine-storage-sync-attention",
        summary: `${machine.machine_id} storage sync status is ${machine.storage_sync_status}`,
        evidence: [{ storage_sync_status: machine.storage_sync_status }],
        recommendation: "Inspect storage sync logs and run a bounded sync check; do not mutate remote state from this diagnostic.",
        tags: [machine.machine_id],
        maxEvidenceItems: input.maxEvidenceItems,
      }));
    }
    if (machine.doctor_status && !["ok", "healthy", "pass"].includes(machine.doctor_status.toLowerCase())) {
      issues.push(buildIssue({
        machineId: machine.machine_id,
        severity: "warning",
        classification: "machine-doctor-attention",
        summary: `${machine.machine_id} doctor status is ${machine.doctor_status}`,
        evidence: [{ doctor_status: machine.doctor_status }],
        recommendation: "Inspect `stations doctor --machine <id> --json` and route remediation through a task.",
        tags: [machine.machine_id],
        maxEvidenceItems: input.maxEvidenceItems,
      }));
    }
  }

  for (const pane of input.tmux.dead_panes) {
    issues.push(buildIssue({
      machineId: input.tmux.local_machine_id,
      severity: "warning",
      classification: "tmux-dead-pane-detected",
      summary: `Dead tmux pane detected at ${pane.ref}`,
      evidence: [{ ...pane }],
      recommendation: "Capture diagnostics if needed, then create a task for the owner. This check does not change pane state.",
      tags: [input.tmux.local_machine_id, "tmux"],
      maxEvidenceItems: input.maxEvidenceItems,
    }));
  }
  for (const expected of input.tmux.expected) {
    if (expected.checked && expected.exists === false) {
      issues.push(buildIssue({
        machineId: expected.machine_id,
        severity: "warning",
        classification: "tmux-expected-pane-missing",
        summary: `Expected tmux pane ${expected.target} is missing on ${expected.machine_id}`,
        evidence: [{ ...expected }],
        recommendation: "Create or update an owner task for the missing session expectation. This check only reports.",
        tags: [expected.machine_id, "tmux"],
        maxEvidenceItems: input.maxEvidenceItems,
      }));
    }
  }

  const deduped = new Map<string, FleetOpsIssueWithSuggestions>();
  for (const issue of issues) deduped.set(issue.fingerprint, issue);
  return [...deduped.values()].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
}

export function getFleetOpsCheck(options: FleetOpsCheckOptions = {}): FleetOpsCheck {
  const now = options.now ?? new Date();
  const maxEvidenceItems = options.maxEvidenceItems ?? DEFAULT_MAX_EVIDENCE_ITEMS;
  const maxTaskSuggestions = options.maxTaskSuggestions ?? DEFAULT_MAX_TASK_SUGGESTIONS;
  const topology = options.topology ?? discoverMachineTopology({
    includeTailscale: options.includeTailscale,
    runner: options.runner,
    now,
    resolverTtlMs: options.resolverTtlMs,
    heartbeatTtlMs: options.heartbeatTtlMs,
    limit: null,
    offset: 0,
  });
  const sharedOptions = {
    topology,
    machineIds: options.machineIds,
    includeTailscale: options.includeTailscale,
    now,
    limit: options.limit,
    offset: options.offset,
  };
  const health = getFleetMachineHealth(sharedOptions);
  const routing = getFleetRouting(sharedOptions);
  const preflight = getFleetLoopPreflight({
    ...sharedOptions,
    command: options.command,
    commandLabel: options.commandLabel,
  });
  const stations = buildMachineRows({ topology, health, routing });
  const tmux = inspectTmuxExpectations({
    topology,
    expectedTmux: options.expectedTmux ?? [],
    tmuxCommand: options.tmuxCommand,
    tmuxProbe: options.tmuxProbe,
    tmuxList: options.tmuxList,
  });
  const issues = buildIssues({
    stations,
    expectedStations: normalizeExpectedStations(options.expectedStations),
    topology,
    tmux,
    maxEvidenceItems,
  });
  const taskSuggestions = issues.map((issue) => issue.task_suggestion).slice(0, maxTaskSuggestions);
  const publicIssues: FleetOpsIssue[] = issues.map((issue) => ({
    fingerprint: issue.fingerprint,
    machine_id: issue.machine_id,
    severity: issue.severity,
    classification: issue.classification,
    summary: issue.summary,
    evidence: issue.evidence,
    recommendation: issue.recommendation,
  }));
  const status = statusFromIssues(issues);
  const routeBlocked = stations.filter((machine) => !machine.route_ok || machine.status === "blocked").length;
  const heartbeatAttention = stations.filter((machine) => machine.heartbeat !== "online").length;
  const storageAttention = stations.filter((machine) => machine.storage_sync_status && !["ok", "synced", "idle"].includes(machine.storage_sync_status.toLowerCase())).length;

  return {
    schema_version: STATIONS_CONSUMER_CONTRACT_VERSION,
    package: {
      name: STATIONS_PACKAGE_NAME,
      version: getPackageVersion(),
    },
    capabilities: getStationsConsumerCapabilities(),
    generated_at: now.toISOString(),
    kind: "fleet_ops_check",
    ok: status === "ok",
    status,
    summary: {
      stations: stations.length,
      ready: stations.filter((machine) => machine.status === "ready").length,
      degraded: stations.filter((machine) => machine.status === "degraded").length,
      blocked: stations.filter((machine) => machine.status === "blocked").length,
      unknown: stations.filter((machine) => machine.status === "unknown").length,
      route_blocked: routeBlocked,
      heartbeat_attention: heartbeatAttention,
      storage_attention: storageAttention,
      tmux_dead_panes: tmux.dead_panes.length,
      tmux_missing_expected: tmux.expected.filter((entry) => entry.checked && entry.exists === false).length,
      issues: publicIssues.length,
      task_suggestions: taskSuggestions.length,
    },
    stations,
    tmux,
    issues: publicIssues,
    task_suggestions: taskSuggestions,
    event_suggestions: issues.map((issue) => issue.event_suggestion),
    artifacts: [
      { kind: "machine_health", ref: "stations machine-health --json", format: "json", private: false },
      { kind: "routing", ref: "stations routing --json", format: "json", private: false },
      { kind: "loop_preflight", ref: "stations loop-preflight --json", format: "json", private: false },
      { kind: "tmux", ref: "tmux list-panes -a -F '<format>'", format: "text", private: true },
    ],
    warnings: [
      ...new Set([
        ...topology.warnings,
        ...health.warnings,
        ...routing.warnings,
        ...preflight.warnings,
        ...tmux.errors.map((error) => `tmux:${error}`),
        ...(taskSuggestions.length < issues.length ? [`task_suggestions_truncated:${issues.length - taskSuggestions.length}`] : []),
      ]),
    ],
    bounds: {
      max_evidence_items: maxEvidenceItems,
      max_task_suggestions: maxTaskSuggestions,
      truncated_task_suggestions: Math.max(0, issues.length - taskSuggestions.length),
    },
    composed: {
      machine_health: health.kind,
      routing: routing.kind,
      loop_preflight: preflight.kind,
      tmux_diagnostics: "read_only",
      todo_dependency: "none",
    },
  };
}

export function parseFleetOpsTmuxExpectation(value: string): FleetOpsTmuxExpectation {
  const trimmed = value.trim();
  const split = trimmed.match(/^([^=]+)=(.+)$/);
  if (!split) return { target: trimmed };
  return { machineId: split[1]?.trim(), target: split[2]?.trim() ?? "" };
}
