import type { HasnaStorageClient } from "./storage.js";
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
export interface UpsertMachineInput {
    id: string;
    friendlyName?: string | null;
    platform?: string | null;
    arch?: string | null;
    status?: string;
    labels?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
export interface ListStationsOptions {
    status?: string;
    limit?: number;
    offset?: number;
}
export interface MachineRegistryStore {
    readonly backend: "cloud-http" | "local";
    readonly baseUrl: string | null;
    list(options?: ListStationsOptions): Promise<MachineRecord[]>;
    get(id: string): Promise<MachineRecord | null>;
    upsert(input: UpsertMachineInput): Promise<MachineRecord>;
    remove(id: string): Promise<boolean>;
}
/** Registry CRUD backed by the hosted `/v1/stations` API. */
declare class CloudMachineRegistryStore implements MachineRegistryStore {
    private readonly client;
    readonly baseUrl: string;
    readonly backend: "cloud-http";
    constructor(client: HasnaStorageClient, baseUrl: string);
    list(options?: ListStationsOptions): Promise<MachineRecord[]>;
    get(id: string): Promise<MachineRecord | null>;
    upsert(input: UpsertMachineInput): Promise<MachineRecord>;
    remove(id: string): Promise<boolean>;
}
/** Registry CRUD backed by the local SQLite `machine_registry` table. */
declare class LocalMachineRegistryStore implements MachineRegistryStore {
    readonly backend: "local";
    readonly baseUrl: null;
    list(options?: ListStationsOptions): Promise<MachineRecord[]>;
    get(id: string): Promise<MachineRecord | null>;
    upsert(input: UpsertMachineInput): Promise<MachineRecord>;
    remove(id: string): Promise<boolean>;
}
/**
 * Resolve the machine registry store for the current environment: the hosted
 * `/v1/stations` API when flipped to the hosted API (HASNA_STATIONS_API_URL +
 * HASNA_STATIONS_API_KEY set), else the local SQLite table.
 */
export declare function resolveMachineRegistryStore(env?: NodeJS.ProcessEnv): MachineRegistryStore;
export { CloudMachineRegistryStore, LocalMachineRegistryStore };
