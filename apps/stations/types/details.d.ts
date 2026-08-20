import { type MachineRegistryStore } from "./cloud/registry.js";
import { STATIONS_CONSUMER_CONTRACT_VERSION, getStationsConsumerCapabilities, type MachineTopology, type StationsContractPackage } from "./topology.js";
export declare const MACHINE_DETAILS_KIND = "machine_details";
export type MachineDetailsStatusState = "online" | "offline" | "unknown";
export type MachineDetailsMetadataValue = string | number | boolean | string[];
export interface MachineDetailsStatus {
    state: MachineDetailsStatusState;
    label: "Online" | "Offline" | "Unknown";
    online: boolean | null;
    last_seen_at?: string;
    last_heartbeat_at?: string;
}
export interface MachineDetailsTimestamps {
    updated_at?: string;
    last_seen_at?: string;
    last_heartbeat_at?: string;
    last_tailscale_seen_at?: string;
    recent_sync_at?: string;
    recent_sync_status?: string;
    storage_sync_status?: string;
}
export interface MachineDetailsSource {
    authority: "stations";
    metadata_source: "manifest_metadata" | "heartbeat" | "topology" | "registry" | "fallback";
    manifest_declared: boolean;
    heartbeat_present: boolean;
    topology_entry: boolean;
    local: boolean;
}
export interface MachineDetails {
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    capabilities: ReturnType<typeof getStationsConsumerCapabilities>;
    generated_at: string;
    machine_id: string;
    slug: string;
    friendly_name?: string;
    friendlyName?: string;
    display_name: string;
    displayName: string;
    known: boolean;
    status: MachineDetailsStatus;
    platform?: string;
    machine_type?: string;
    role?: string;
    roles?: string[];
    machine_capabilities?: string[];
    tags?: string[];
    updated_at?: string;
    last_seen_at?: string;
    timestamps: MachineDetailsTimestamps;
    source: MachineDetailsSource;
    display_metadata?: Record<string, MachineDetailsMetadataValue>;
    warnings: string[];
}
export interface MachineDetailsOptions {
    topology?: MachineTopology;
    now?: Date;
    includeTailscale?: boolean;
}
export interface ResolveMachineDetailsOptions extends MachineDetailsOptions {
    registryStore?: Pick<MachineRegistryStore, "get">;
}
export declare function getMachineDetails(machineId: string, options?: MachineDetailsOptions): MachineDetails;
export declare function resolveMachineDetails(machineId: string, options?: ResolveMachineDetailsOptions): Promise<MachineDetails>;
