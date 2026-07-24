import { Database } from 'bun:sqlite';
/**
 * The single choke point for every client-side sqlite catalog open. In
 * self_hosted/cloud mode (HASNA_KNOWLEDGE_API_URL + HASNA_KNOWLEDGE_API_KEY) the
 * on-box knowledge.db is NOT the source of truth — writing to it would be the
 * split-brain the mission forbids. Rather than silently touch local sqlite, we
 * refuse loudly. Knowledge items (notes) still flow to the shared cloud via the
 * ApiStore; the local catalog subsystem is first-class in local mode only.
 * The HTTP server (src/serve) never calls this — it reads the cloud Postgres
 * directly — so this guard applies to CLI/MCP/SDK clients only.
 */
export declare function assertLocalCatalogMode(operation?: string): void;
export declare const CURRENT_SCHEMA_VERSION = 8;
export interface KnowledgeDbStats {
    schema_version: number;
    sources: number;
    source_revisions: number;
    chunks: number;
    wiki_pages: number;
    citations: number;
    indexes: number;
    runs: number;
    run_events: number;
    redaction_findings: number;
    audit_events: number;
    approval_gates: number;
    storage_objects: number;
    embeddings: number;
    vector_entries: number;
    reindex_queue: number;
    knowledge_machines: number;
    sync_snapshots: number;
    sync_changes: number;
    sync_conflicts: number;
    sync_table_clocks: number;
    sync_imports: number;
}
export declare function openKnowledgeDb(path: string): Database;
/**
 * Read-only open of the on-box knowledge.db, gated by the same cloud-mode guard
 * as {@link openKnowledgeDb}. This is the ONLY sanctioned read-only sqlite entry
 * point (used by the workspace-migration integrity/summary tooling) so that every
 * client-side `new Database(...)` lives in this module behind the gate — no path
 * can silently read the local catalog while the cloud API flip is active.
 */
export declare function openKnowledgeDbReadonly(path: string): Database;
export declare function migrateKnowledgeDb(path: string): {
    path: string;
    schema_version: number;
};
export declare function getSchemaVersion(db: Database): number;
export declare function getKnowledgeDbStats(path: string): KnowledgeDbStats;
