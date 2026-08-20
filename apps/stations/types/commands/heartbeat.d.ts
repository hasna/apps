import { type MachineCommandRunner } from "../remote.js";
import { type SdkMutationApprovalOptions } from "./mutation-approval.js";
export interface HeartbeatCollectOptions extends SdkMutationApprovalOptions {
    machines?: string[];
    timeoutMs?: number;
    doctorSummary?: boolean;
}
export interface HeartbeatCollectResult {
    machineId: string;
    status: "imported" | "failed";
    source: "local" | "lan" | "tailscale" | "ssh" | null;
    updatedAt: string | null;
    daemonVersion: string | null;
    storageSyncStatus: string | null;
    error: string | null;
}
export declare const HEARTBEAT_COLLECT_MUTATION_OPERATION = "machines_heartbeat_collect";
export declare const HEARTBEAT_COLLECTOR_LOOP_NAME = "machine-openmachines-heartbeat-collector";
export declare const DEFAULT_HEARTBEAT_COLLECTOR_TIMEOUT_MS = 90000;
export interface HeartbeatCollectorCommandOptions {
    machines?: string[];
    timeoutMs?: number;
    machinesCommand?: string;
}
export interface HeartbeatCollectorCommandPlan {
    kind: "heartbeat_collector_command";
    loopName: string;
    command: string;
    machines: string[];
    timeoutMs: number;
    trustedLocalMutationEnv: string;
    warnings: string[];
}
export declare function heartbeatCollectMutationArgs(options?: Pick<HeartbeatCollectOptions, "machines" | "timeoutMs" | "doctorSummary">): Record<string, unknown>;
export declare function heartbeatCollectResourceId(options?: Pick<HeartbeatCollectOptions, "machines">): string;
export declare function buildHeartbeatCollectorCommand(options?: HeartbeatCollectorCommandOptions): HeartbeatCollectorCommandPlan;
export declare function collectHeartbeats(options?: HeartbeatCollectOptions, runner?: MachineCommandRunner): HeartbeatCollectResult[];
