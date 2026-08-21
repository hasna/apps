import { type MachineCommandRunner } from "./remote.js";
import { type CompatibilityCommandRunner, type CompatibilityCommandSpec, type CompatibilityPackageSpec, type CompatibilityWorkspaceSpec } from "./compatibility.js";
import { STATIONS_CONSUMER_CONTRACT_VERSION, type MachineListPagination, type MachineRouteConfidence, type MachineRouteKind, type MachineTopology, type MachineTopologyEntry, type MachineTopologyOptions, type StationsConsumerCapabilities, type StationsContractPackage } from "./topology.js";
export declare const AGENT_ABSTRACTIONS_KIND: {
    readonly machineHealth: "machine_health";
    readonly routing: "routing";
    readonly commandMatrix: "command_matrix";
    readonly loopPreflight: "loop_preflight";
};
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
export interface MachineHealthOptions extends AgentMachineSelectorOptions, AgentWorkspaceOptions, AgentCompatibilityOptions {
}
export interface CommandMatrixOptions extends AgentMachineSelectorOptions {
    command?: string;
    commandLabel?: string;
    executionRunner?: MachineCommandRunner;
    executionProbeTimeoutMs?: number;
}
export interface FleetRoutingOptions extends AgentMachineSelectorOptions {
}
export interface FleetLoopPreflightOptions extends MachineHealthOptions {
    command?: string;
    commandLabel?: string;
    executionRunner?: MachineCommandRunner;
    executionProbeTimeoutMs?: number;
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
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    capabilities: StationsConsumerCapabilities;
    generated_at: string;
    kind: typeof AGENT_ABSTRACTIONS_KIND.machineHealth;
    pagination: MachineListPagination;
    summary: AgentSummary;
    stations: MachineHealthRow[];
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
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    capabilities: StationsConsumerCapabilities;
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
        tool: "stations_ssh_resolve";
        args: {
            machine_id: string;
            remote_command: string;
            private_metadata: false;
        };
    };
    sdk: string;
    private_shell_command: string | null;
}
export type CommandExecutionProbeStatus = "ready" | "route_unavailable" | "authentication_denied" | "timed_out" | "failed";
export interface CommandExecutionProbe {
    checked: boolean;
    ready: boolean;
    status: CommandExecutionProbeStatus;
    source: MachineRouteKind;
    exit_code: number | null;
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
    execution: CommandExecutionProbe;
    command: CommandMatrixCommandPlan;
    blocked_by: string[];
    warnings: string[];
    detail_refs: AgentApiDetailRefs;
}
export interface CommandMatrixReport {
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    capabilities: StationsConsumerCapabilities;
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
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    capabilities: StationsConsumerCapabilities;
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
    stations: LoopPreflightMachine[];
    artifacts: AgentApiArtifactRef[];
    warnings: string[];
}
export declare function getFleetMachineHealth(options?: MachineHealthOptions): MachineHealthReport;
export declare function getFleetRouting(options?: FleetRoutingOptions): FleetRoutingReport;
export declare function getCommandMatrix(options?: CommandMatrixOptions): CommandMatrixReport;
export declare function getFleetLoopPreflight(options?: FleetLoopPreflightOptions): FleetLoopPreflightReport;
