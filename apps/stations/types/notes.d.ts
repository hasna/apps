import { STATIONS_CONSUMER_CONTRACT_VERSION, getStationsConsumerCapabilities, type MachineTopology, type MachineListPagination, type StationsContractPackage } from "./topology.js";
export declare const NOTE_MACHINE_CONTEXT_KIND = "note_machine_context";
export declare const MACHINE_TRASH_POLICIES_KIND = "machine_trash_policies";
export type NoteMachineRole = "origin" | "source" | "target" | "sync_target" | "trash_owner";
export type NoteActorType = "human" | "agent" | "system" | "unknown";
export type NoteMachineContextSource = "notes" | "agent" | "sync" | "import" | "stations" | "unknown";
/** Legacy stored values accepted on read until records are migrated. */
export declare const LEGACY_NOTE_CONTEXT_SOURCES: readonly ["notes", "stations"];
export type LegacyNoteContextSource = (typeof LEGACY_NOTE_CONTEXT_SOURCES)[number];
/** Retired open-* alias values accepted on read until records are migrated (open- prefix retired, PR #320). */
export type LegacyNoteMachineContextSourceAlias = "open-notes" | "open-stations";
/** Actor source accepted at read boundaries: canonical values plus retired open-* aliases. */
export type NoteMachineContextSourceInput = NoteMachineContextSource | LegacyNoteMachineContextSourceAlias;
export type MachineTrashPolicySource = "manifest_metadata" | "default";
export interface NoteMachineReference {
    machine_id: string;
    friendly_name: string | null;
    display_name: string;
    updated_at: string | null;
    role: NoteMachineRole;
    known: boolean;
    manifest_declared: boolean;
}
export interface NoteSyncTarget {
    machine_id: string;
    machine: NoteMachineReference;
}
export interface NoteActorContext {
    actor_type: NoteActorType;
    actor_id: string | null;
    actor_name: string | null;
    agent_id: string | null;
    agent_name: string | null;
    source: NoteMachineContextSource;
    display_name: string;
}
/** Actor input at a read boundary; source accepts retired open-* aliases, normalized to canonical on read. */
export type NoteActorContextInput = Partial<Omit<NoteActorContext, "source">> & {
    source?: NoteMachineContextSourceInput;
};
export interface NoteMachineContextOptions {
    originMachineId?: string | null;
    sourceMachineId?: string | null;
    targetMachineId?: string | null;
    syncTargetMachineIds?: string[];
    actor?: NoteActorContextInput;
    topology?: MachineTopology;
    now?: Date;
    includeTailscale?: boolean;
}
export interface NoteMachineContext {
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    capabilities: ReturnType<typeof getStationsConsumerCapabilities>;
    generated_at: string;
    origin_machine_id: string | null;
    source_machine_id: string | null;
    target_machine_id: string | null;
    origin_machine: NoteMachineReference | null;
    source_machine: NoteMachineReference | null;
    target_machine: NoteMachineReference | null;
    sync_target_machine_ids: string[];
    sync_targets: NoteSyncTarget[];
    actor: NoteActorContext;
    warnings: string[];
}
export interface MachineTrashPolicy {
    machine_id: string;
    friendly_name: string | null;
    display_name: string;
    updated_at: string | null;
    enabled: boolean | null;
    retention_days: number | null;
    delete_after_days: number | null;
    trash_path: string | null;
    source: MachineTrashPolicySource;
    metadata_keys: string[];
}
export interface MachineTrashPoliciesOptions {
    machineId?: string | null;
    topology?: MachineTopology;
    now?: Date;
    includeTailscale?: boolean;
    limit?: number | null;
    offset?: number;
}
export interface MachineTrashPolicies {
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    capabilities: ReturnType<typeof getStationsConsumerCapabilities>;
    generated_at: string;
    pagination: MachineListPagination;
    policies: MachineTrashPolicy[];
    warnings: string[];
}
export declare function machineReferenceForNote(machineId: string | null | undefined, role: NoteMachineRole, topology: MachineTopology): NoteMachineReference | null;
export declare function resolveNoteMachineContext(options?: NoteMachineContextOptions): NoteMachineContext;
export declare function listMachineTrashPolicies(options?: MachineTrashPoliciesOptions): MachineTrashPolicies;
