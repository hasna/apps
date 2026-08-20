import type { TypedQueryClient } from "../generated/storage-kit/query.js";
export interface MachineRecord {
    id: string;
    friendlyName: string | null;
    platform: string | null;
    arch: string | null;
    status: string;
    labels: Record<string, unknown>;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
export interface HeartbeatRecord {
    machineId: string;
    pid: number;
    status: string;
    updatedAt: string;
    daemonVersion: string | null;
    agentMode: string | null;
    platform: string | null;
    arch: string | null;
    uptimeSeconds: number | null;
    observedAt: string | null;
}
export interface UpsertMachineInput {
    id: string;
    friendlyName?: string | null;
    platform?: string | null;
    arch?: string | null;
    status?: string;
    labels?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
export interface UpdateMachineInput {
    friendlyName?: string | null;
    platform?: string | null;
    arch?: string | null;
    status?: string;
    labels?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
export interface ListMachinesOptions {
    status?: string;
    limit?: number;
    offset?: number;
}
/** Thrown for caller-facing validation errors (mapped to HTTP 400). */
export declare class RegistryValidationError extends Error {
    constructor(message: string);
}
export declare class MachineRegistry {
    private readonly client;
    constructor(client: TypedQueryClient);
    list(options?: ListMachinesOptions): Promise<MachineRecord[]>;
    get(id: string): Promise<MachineRecord | null>;
    /** Register (insert-or-update) a machine. Returns the persisted record. */
    upsert(input: UpsertMachineInput): Promise<MachineRecord>;
    /** Partial update. Returns null when the machine does not exist. */
    update(id: string, patch: UpdateMachineInput): Promise<MachineRecord | null>;
    /** Deregister a machine. Returns true when a row was removed. */
    remove(id: string): Promise<boolean>;
    count(status?: string): Promise<number>;
    listHeartbeats(machineId?: string, limit?: number): Promise<HeartbeatRecord[]>;
}
