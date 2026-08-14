import type { KnowledgeConfig } from './workspace';
import { type SafetyPolicy } from './safety';
export interface OutboxConsumeOptions {
    dbPath: string;
    input: string;
    config?: KnowledgeConfig;
    safetyPolicy?: SafetyPolicy;
    now?: Date;
}
export interface OutboxConsumeResult {
    path: string;
    db_path: string;
    run_id: string;
    events_seen: number;
    sources_touched: number;
    revisions_touched: number;
    chunks_deleted: number;
    embeddings_deleted: number;
    stale_revisions: number;
    deleted_sources: number;
    moved_sources: number;
    permission_updates: number;
    vector_entries_deleted: number;
}
export declare function consumeOpenFilesOutbox(options: OutboxConsumeOptions): Promise<OutboxConsumeResult>;
