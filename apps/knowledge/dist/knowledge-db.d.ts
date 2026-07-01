import { Database } from 'bun:sqlite';
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
export declare function emptyKnowledgeDbStats(): KnowledgeDbStats;
export declare function openKnowledgeDb(path: string): Database;
export declare function migrateKnowledgeDb(path: string): {
    path: string;
    schema_version: number;
};
export declare function getSchemaVersion(db: Database): number;
export declare function getKnowledgeDbStats(path: string): KnowledgeDbStats;
