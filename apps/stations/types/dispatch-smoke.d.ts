import { type MachineCommandOptions, type MachineCommandResult } from "./remote.js";
import { REDACTED_VALUE } from "./redaction.js";
import { STATIONS_CONSUMER_CONTRACT_VERSION, type MachineRouteConfidence, type MachineRouteKind, type MachineTopology, type MachineTopologyOptions, type StationsConsumerCapabilities, type StationsContractPackage } from "./topology.js";
export declare const DISPATCH_FLEET_SMOKE_KIND: "dispatch_fleet_smoke";
export declare const DEFAULT_DISPATCH_PACKAGE_NAME = "@hasna/dispatch";
export declare const DEFAULT_DISPATCH_COMMAND = "dispatch";
export declare const DEFAULT_DISPATCH_SMOKE_TIMEOUT_MS = 12000;
export declare const DEFAULT_DISPATCH_SMOKE_MAX_OUTPUT_CHARS = 1200;
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
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    capabilities: StationsConsumerCapabilities;
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
        ignored: Array<{
            machine_id: string;
            reason: string;
        }>;
    };
    bounds: {
        timeout_ms: number;
        max_output_chars: number;
        stations: number;
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
    stations: DispatchFleetSmokeMachineRow[];
    warnings: string[];
    errors: string[];
}
export type DispatchFleetSmokeRunner = (target: DispatchFleetSmokeResolvedTarget, command: string, options: MachineCommandOptions) => MachineCommandResult;
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
export declare function getDispatchFleetSmoke(options?: DispatchFleetSmokeOptions): DispatchFleetSmokeReport;
