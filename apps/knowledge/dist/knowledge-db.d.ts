import { Database } from 'bun:sqlite';
/**
 * The single choke point for every client-side sqlite catalog open. With the
 * HTTP transport selected, the on-box knowledge.db is NOT
 * the source of truth, and writing to it would be the split-brain the mission
 * forbids. Rather than silently touch local sqlite, we refuse loudly. Knowledge
 * items (notes) still flow through the server API; the local catalog subsystem
 * belongs to the on-box transport.
 * The HTTP server (src/serve) never calls this — it reads PostgreSQL
 * directly — so this guard applies to CLI/MCP/SDK clients only.
 * Recorded boundary decision (local-only-capability review, 2026-08-18):
 * docs/architecture/catalog-transport-boundary.md — the hosted half of the
 * catalog is a wrapper build with no server-side implementation at ea43dd336;
 * do not remove this guard without that build landing.
 */
export declare function assertSqliteClientTransport(operation?: string): void;
export declare const CURRENT_SCHEMA_VERSION = 10;
/**
 * FTS5 tokenizer for the chunk index. `porter` keeps English stemming; the
 * wrapped `unicode61 remove_diacritics 2` folds accents/diacritics fully
 * (level 2 also folds diacritics that level 1 leaves in place), so `cafe`
 * matches `café`. Kept in one constant so the create + rebuild paths never drift.
 */
export declare const CHUNKS_FTS_TOKENIZE = "porter unicode61 remove_diacritics 2";
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
    promotion_candidates: number;
    durable_records: number;
}
export declare function openKnowledgeDb(path: string): Database;
/**
 * Read-only open of the on-box knowledge.db, gated by the same HTTP-transport guard
 * as {@link openKnowledgeDb}. This is the ONLY sanctioned read-only sqlite entry
 * point (used by the workspace-migration integrity/summary tooling) so that every
 * client-side `new Database(...)` lives in this module behind the gate — no path
 * can silently read the local catalog while HTTP transport is active.
 */
export declare function openKnowledgeDbReadonly(path: string): Database;
export declare function migrateKnowledgeDb(path: string): {
    path: string;
    schema_version: number;
};
export declare function getSchemaVersion(db: Database): number;
export declare function getKnowledgeDbStats(path: string): KnowledgeDbStats;
