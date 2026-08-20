import { type FleetLoopPreflightReport, type FleetRoutingReport, type MachineHealthReport } from "./agent-abstractions.js";
import { type TmuxPaneProbeResult } from "./commands/runtime.js";
import { getMachinesConsumerCapabilities, MACHINES_CONSUMER_CONTRACT_VERSION, MACHINES_PACKAGE_NAME, type MachineTopology, type MachineTopologyOptions } from "./topology.js";
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
    type: "machines.ops.issue";
    source: "machines";
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
    expectedMachines?: string[];
    expectedTmux?: FleetOpsTmuxExpectation[];
    command?: string;
    commandLabel?: string;
    maxEvidenceItems?: number;
    maxTaskSuggestions?: number;
    tmuxCommand?: string;
    tmuxProbe?: (target: string) => TmuxPaneProbeResult;
    tmuxList?: (tmuxCommand?: string) => {
        panes: FleetOpsTmuxPane[];
        error: string | null;
    };
}
export interface FleetOpsCheck {
    schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
    package: {
        name: typeof MACHINES_PACKAGE_NAME;
        version: string;
    };
    capabilities: ReturnType<typeof getMachinesConsumerCapabilities>;
    generated_at: string;
    kind: "fleet_ops_check";
    ok: boolean;
    status: FleetOpsStatus;
    summary: {
        machines: number;
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
    machines: FleetOpsMachineRow[];
    tmux: FleetOpsTmuxSummary;
    issues: FleetOpsIssue[];
    task_suggestions: FleetOpsTaskSuggestion[];
    task_actions?: FleetOpsTaskAction[];
    event_suggestions: FleetOpsEventSuggestion[];
    artifacts: Array<{
        kind: string;
        ref: string;
        format: "json" | "text";
        private: boolean;
    }>;
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
export declare function upsertFleetOpsCheckTasks(result: FleetOpsCheck, options: FleetOpsTaskUpsertOptions): FleetOpsTaskAction[];
export declare function listLocalTmuxPanes(tmuxCommand?: string): {
    panes: FleetOpsTmuxPane[];
    error: string | null;
};
export declare function getFleetOpsCheck(options?: FleetOpsCheckOptions): FleetOpsCheck;
export declare function parseFleetOpsTmuxExpectation(value: string): FleetOpsTmuxExpectation;
