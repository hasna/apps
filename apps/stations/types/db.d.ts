import { Database } from "bun:sqlite";
export declare class SqliteAdapter {
    readonly raw: Database;
    constructor(path: string);
    close(): void;
}
export declare function getAdapter(path?: string): SqliteAdapter;
export declare function getDb(path?: string): Database;
export declare function closeDb(): void;
export interface HeartbeatUpsertMetadata {
    daemonVersion?: string | null;
    agentMode?: string | null;
    platform?: string | null;
    osVersion?: string | null;
    osBuild?: string | null;
    arch?: string | null;
    uptimeSeconds?: number | null;
    toolVersions?: Record<string, unknown> | null;
    tailscale?: Record<string, unknown> | null;
    storageSyncStatus?: string | null;
    storageSyncLastError?: string | null;
    doctorSummary?: Record<string, unknown> | null;
    privateMetadata?: boolean;
}
export declare function upsertHeartbeat(machineId: string, pid?: number, status?: "online" | "offline", metadata?: HeartbeatUpsertMetadata): void;
export declare function getLocalMachineId(): string;
export interface StoredHeartbeat {
    machine_id: string;
    pid: number;
    status: string;
    updated_at: string;
    daemon_version: string | null;
    agent_mode: string | null;
    platform: string | null;
    os_version: string | null;
    os_build: string | null;
    arch: string | null;
    uptime_seconds: number | null;
    tool_versions_json: string | null;
    tailscale_json: string | null;
    storage_sync_status: string | null;
    storage_sync_last_error: string | null;
    doctor_summary_json: string | null;
    private_metadata: number;
    observed_at: string | null;
}
export interface HeartbeatSnapshot {
    machineId: string;
    pid: number;
    status: "online" | "offline";
    updatedAt: string;
    daemonVersion?: string | null;
    agentMode?: string | null;
    platform?: string | null;
    osVersion?: string | null;
    osBuild?: string | null;
    arch?: string | null;
    uptimeSeconds?: number | null;
    toolVersions?: Record<string, unknown> | null;
    tailscale?: Record<string, unknown> | null;
    storageSyncStatus?: string | null;
    storageSyncLastError?: string | null;
    doctorSummary?: Record<string, unknown> | null;
    privateMetadata?: boolean;
    observedAt?: string | null;
}
export declare function upsertHeartbeatSnapshot(snapshot: HeartbeatSnapshot): void;
export declare function listHeartbeats(machineId?: string): StoredHeartbeat[];
export declare function latestHeartbeatByMachine(heartbeats: readonly StoredHeartbeat[]): Map<string, StoredHeartbeat>;
export declare function countRuns(table: "setup_runs" | "sync_runs"): number;
export declare function setHeartbeatStatus(machineId: string, pid: number, status: "online" | "offline"): void;
export declare function recordSetupRun(machineId: string, status: string, details: unknown): void;
export declare function recordSyncRun(machineId: string, status: string, actions: unknown): void;
