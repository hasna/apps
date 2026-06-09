import type { Database } from 'bun:sqlite';
import { CURRENT_SCHEMA_VERSION } from './knowledge-db';
import { type StorageContract } from './storage-contract';
import { type ArtifactStore } from './artifact-store';
import type { KnowledgeMachineTopology } from './machines';
export interface KnowledgeSyncMachineRow {
    machine_id: string;
    hostname: string | null;
    platform: string | null;
    user_label: string | null;
    workspace_home: string | null;
    tailscale_dns: string | null;
    tailscale_ips_json: string;
    ssh_target: string | null;
    last_seen_at: string | null;
    capabilities_json: string;
    metadata_json: string;
    created_at: string;
    updated_at: string;
}
export interface KnowledgeSyncSnapshotRow {
    id: string;
    machine_id: string;
    scope: string;
    workspace_home: string;
    sqlite_schema_version: number;
    artifact_root_uri: string;
    content_hash: string;
    tables_json: string;
    artifact_hashes_json: string;
    created_at: string;
}
export interface KnowledgeSyncConflictRow {
    id: string;
    entity_kind: string;
    entity_id: string;
    local_machine_id: string;
    remote_machine_id: string;
    local_hash: string | null;
    remote_hash: string | null;
    base_hash: string | null;
    status: string;
    resolution_strategy: string | null;
    proposed_patch_uri: string | null;
    approved_by: string | null;
    resolved_at: string | null;
    metadata_json: string;
    created_at: string;
}
export interface KnowledgeSyncStatus {
    ok: true;
    scope: string;
    workspace_home: string;
    sqlite_schema_version: number;
    local_machine_id: string | null;
    machines: {
        total: number;
        rows: KnowledgeSyncMachineRow[];
    };
    snapshots: {
        total: number;
        latest: KnowledgeSyncSnapshotRow | null;
    };
    changes: {
        total: number;
        by_operation: Array<{
            operation: string;
            count: number;
        }>;
    };
    conflicts: {
        total: number;
        by_status: Array<{
            status: string;
            count: number;
        }>;
        open: number;
    };
    table_counts: Record<string, number>;
    message: string;
}
export interface KnowledgeSyncSnapshotResult {
    ok: true;
    snapshot: KnowledgeSyncSnapshotRow & {
        tables: Record<string, number>;
        artifact_hashes: Array<{
            artifact_uri: string;
            kind: string;
            hash: string | null;
            size_bytes: number | null;
        }>;
    };
    machines_upserted: number;
    message: string;
}
export interface KnowledgeSyncConflictInput {
    entityKind: string;
    entityId: string;
    localMachineId: string;
    remoteMachineId: string;
    localHash?: string | null;
    remoteHash?: string | null;
    baseHash?: string | null;
    status?: string;
    resolutionStrategy?: string | null;
    proposedPatchUri?: string | null;
    approvedBy?: string | null;
    resolvedAt?: string | null;
    metadata?: Record<string, unknown>;
}
export declare const KNOWLEDGE_SYNC_TABLES: readonly ["sources", "wiki_pages", "source_revisions", "chunks", "chunk_embeddings", "wiki_backlinks", "citations", "knowledge_indexes", "runs", "run_events", "provider_usage", "redaction_findings", "storage_objects", "audit_events", "approval_gates", "vector_index_entries", "reindex_queue", "knowledge_machines", "knowledge_sync_snapshots", "knowledge_sync_changes", "knowledge_sync_conflicts"];
export declare const KNOWLEDGE_SYNC_PROTOCOL_VERSION = 1;
export declare const KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION = 1;
export type KnowledgeSyncTable = (typeof KNOWLEDGE_SYNC_TABLES)[number];
type Row = Record<string, unknown>;
export interface KnowledgeSyncBundleTable {
    table: KnowledgeSyncTable;
    primary_keys: string[];
    rows: Row[];
}
export interface KnowledgeSyncBundleArtifact {
    id: string;
    artifact_uri: string;
    key: string | null;
    kind: string;
    content_type: string | null;
    hash: string | null;
    size_bytes: number | null;
    metadata_json: string;
    content_base64?: string;
}
export interface KnowledgeSyncBundle {
    ok: true;
    format: 'knowledge-sync-bundle';
    version: 1;
    protocol_version: typeof KNOWLEDGE_SYNC_PROTOCOL_VERSION;
    min_protocol_version: typeof KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION;
    generated_at: string;
    source: {
        scope: string;
        workspace_home: string;
        sqlite_schema_version: number;
        machine_id: string | null;
        artifact_root_uri: string;
    };
    tables: KnowledgeSyncBundleTable[];
    artifacts: KnowledgeSyncBundleArtifact[];
    warnings: string[];
    message: string;
}
export interface KnowledgeSyncTableApplyResult {
    table: KnowledgeSyncTable;
    source_rows: number;
    target_rows: number;
    inserted: number;
    skipped: number;
    conflicts: number;
}
export interface KnowledgeSyncArtifactApplyResult {
    source_artifacts: number;
    target_artifacts: number;
    copied: number;
    skipped: number;
    conflicts: number;
    missing_content: number;
}
export interface KnowledgeSyncApplyResult {
    ok: boolean;
    protocol_version: typeof KNOWLEDGE_SYNC_PROTOCOL_VERSION;
    min_protocol_version: typeof KNOWLEDGE_SYNC_MIN_PROTOCOL_VERSION;
    dry_run: boolean;
    direction: 'pull' | 'push' | 'import';
    source: KnowledgeSyncBundle['source'];
    target: {
        scope: string;
        workspace_home: string;
        sqlite_schema_version: number;
        artifact_root_uri: string;
    };
    tables: KnowledgeSyncTableApplyResult[];
    artifacts: KnowledgeSyncArtifactApplyResult;
    conflicts_created: number;
    warnings: string[];
    message: string;
}
export interface KnowledgePeerSyncResult {
    ok: boolean;
    dry_run: boolean;
    direction: 'pull' | 'push' | 'both';
    pull?: KnowledgeSyncApplyResult;
    push?: KnowledgeSyncApplyResult;
    message: string;
}
export declare function upsertKnowledgeMachine(db: Database, input: KnowledgeSyncMachineRow): void;
export declare function refreshMachineRegistryFromTopology(db: Database, topology: KnowledgeMachineTopology, now?: string): number;
export declare function listKnowledgeMachines(dbPath: string): KnowledgeSyncMachineRow[];
export declare function createKnowledgeSyncBundle(options: {
    dbPath: string;
    scope: string;
    workspaceHome: string;
    storage: StorageContract;
    machineId?: string | null;
    tables?: string[];
    includeArtifactContent?: boolean;
    now?: Date;
}): KnowledgeSyncBundle;
export declare function applyKnowledgeSyncBundle(options: {
    targetDbPath: string;
    targetScope: string;
    targetWorkspaceHome: string;
    targetStorage: StorageContract;
    targetStore: ArtifactStore;
    bundle: KnowledgeSyncBundle;
    targetBundle?: KnowledgeSyncBundle;
    direction: 'pull' | 'push' | 'import';
    dryRun?: boolean;
    localMachineId?: string | null;
}): Promise<KnowledgeSyncApplyResult>;
export declare function createKnowledgeSyncSnapshot(options: {
    dbPath: string;
    scope: string;
    workspaceHome: string;
    storage: StorageContract;
    topology?: KnowledgeMachineTopology;
    machineId?: string;
    now?: Date;
}): KnowledgeSyncSnapshotResult;
export declare function getKnowledgeSyncStatus(options: {
    dbPath: string;
    scope: string;
    workspaceHome: string;
    localMachineId?: string | null;
}): KnowledgeSyncStatus;
export declare function recordKnowledgeSyncConflict(dbPath: string, input: KnowledgeSyncConflictInput): KnowledgeSyncConflictRow;
export declare function listKnowledgeSyncConflicts(dbPath: string, options?: {
    status?: string;
    limit?: number;
}): {
    metadata: {};
    id: string;
    entity_kind: string;
    entity_id: string;
    local_machine_id: string;
    remote_machine_id: string;
    local_hash: string | null;
    remote_hash: string | null;
    base_hash: string | null;
    status: string;
    resolution_strategy: string | null;
    proposed_patch_uri: string | null;
    approved_by: string | null;
    resolved_at: string | null;
    metadata_json: string;
    created_at: string;
}[];
export declare function syncTablesFromSnapshot(snapshot: KnowledgeSyncSnapshotRow): Record<string, number>;
export declare function syncArtifactsFromSnapshot(snapshot: KnowledgeSyncSnapshotRow): Array<{
    artifact_uri: string;
    kind: string;
    hash: string | null;
    size_bytes: number | null;
}>;
export { CURRENT_SCHEMA_VERSION as KNOWLEDGE_SYNC_SCHEMA_VERSION };
