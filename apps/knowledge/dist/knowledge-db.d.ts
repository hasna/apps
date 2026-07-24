import { type AnchoredMutableFileSnapshot } from './anchored-fs';
export declare const CURRENT_SCHEMA_VERSION = 8;
export type KnowledgeDbTestEvent = 'database-before-constructor' | 'database-before-migration';
/** Deterministic race injection for repository tests; never exported by the package root. */
export declare function setKnowledgeDbTestHook(hook: ((event: KnowledgeDbTestEvent, path: string) => void) | undefined): void;
export interface KnowledgeDatabaseChanges {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
}
export interface KnowledgeDatabaseStatement<Row = unknown, Params extends unknown[] = unknown[]> {
    all(...params: Params): Row[];
    get(...params: Params): Row | null;
    run(...params: Params): KnowledgeDatabaseChanges;
    values(...params: Params): unknown[][];
}
/**
 * Package-owned structural database contract. Bun remains the private runtime
 * implementation, but consumers do not need Bun ambient declarations merely
 * to typecheck the published package.
 */
export interface KnowledgeDatabase {
    readonly inTransaction: boolean;
    run(sql: string, ...bindings: unknown[]): KnowledgeDatabaseChanges;
    exec(sql: string, ...bindings: unknown[]): KnowledgeDatabaseChanges;
    query<Row = unknown, Params extends unknown | unknown[] = unknown[]>(sql: string): KnowledgeDatabaseStatement<Row, Params extends unknown[] ? Params : [Params]>;
    prepare<Row = unknown, Params extends unknown | unknown[] = unknown[]>(sql: string, params?: Params): KnowledgeDatabaseStatement<Row, Params extends unknown[] ? Params : [Params]>;
    transaction<Args extends unknown[], Result>(callback: (...args: Args) => Result): (...args: Args) => Result;
    close(throwOnError?: boolean): void;
}
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
export declare function verifyKnowledgeDbIdentity(db: KnowledgeDatabase, expected?: AnchoredMutableFileSnapshot): AnchoredMutableFileSnapshot;
/** Base-compatible public database opener; internal callers use the anchored options helper. */
export declare function openKnowledgeDb(path: string): KnowledgeDatabase;
export declare function openMigratedKnowledgeDb(path: string, options?: {
    ensureParent?: boolean;
}): KnowledgeDatabase;
export declare function migrateKnowledgeDb(path: string): {
    path: string;
    schema_version: number;
};
export declare function getSchemaVersion(db: KnowledgeDatabase): number;
export declare function getKnowledgeDbStats(path: string): KnowledgeDbStats;
