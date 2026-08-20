export interface AgentRuntimeStatus {
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
}
export interface AgentRuntimeOptions {
    mode?: string;
    privateMetadata?: boolean;
    doctorSummary?: boolean;
    storageSyncStatus?: string | null;
    storageSyncLastError?: string | null;
}
export interface AgentTickOptions extends AgentRuntimeOptions {
    storagePush?: boolean;
    storagePushRetries?: number;
    storagePushBackoffMs?: number;
}
export interface AgentStatusOptions {
    privateMetadata?: boolean;
}
export declare function sanitizePublicString(value: string, privateMetadata?: boolean): string;
export declare function writeHeartbeat(status?: "online" | "offline", options?: AgentRuntimeOptions): AgentRuntimeStatus;
export declare function writeHeartbeatTick(status?: "online" | "offline", options?: AgentTickOptions): Promise<AgentRuntimeStatus>;
export declare function markOffline(options?: AgentRuntimeOptions): AgentRuntimeStatus;
export declare function getAgentStatus(machineId?: string, options?: AgentStatusOptions): AgentRuntimeStatus[];
