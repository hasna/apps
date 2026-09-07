import { Database } from 'bun:sqlite';
/**
 * The single choke point for every client-side sqlite catalog open. The on-box
 * knowledge.db is the derived-catalog store (sources, chunks, wiki pages,
 * indexes, runs, sync ledgers, machine registry) and it exists in BOTH item
 * transports: a credential resolving to the HTTP API routes the shared item
 * corpus through the server, while the machine-local derived catalog stays the
 * machine-local store. There is no storage-mode axis anymore (owner directive
 * 2026-08-15): no command may be blocked because an API credential is
 * configured. The HTTP server (src/serve) never calls this — it reads
 * PostgreSQL directly — so this module is CLI/MCP/SDK client-side only.
 *
 * Superseded decision record: docs/architecture/catalog-transport-boundary.md
 * (the previous local-only-capability review that gated this module behind the
 * HTTP-transport guard was overturned by the owner directive).
 */
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
 * Read-only open of the on-box knowledge.db — the ONLY sanctioned read-only
 * sqlite entry point (used by the workspace-migration integrity/summary
 * tooling) so that every client-side `new Database(...)` lives in this module.
 */
export declare function openKnowledgeDbReadonly(path: string): Database;
export declare function migrateKnowledgeDb(path: string): {
    path: string;
    schema_version: number;
};
export declare function getSchemaVersion(db: Database): number;
export declare function getKnowledgeDbStats(path: string): KnowledgeDbStats;
