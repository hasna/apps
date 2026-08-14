import { indexKnowledgeEmbeddings, type EmbeddingRuntimeOptions } from './embeddings';
import type { KnowledgeConfig } from './workspace';
export interface ReindexRuntimeOptions extends EmbeddingRuntimeOptions {
    dbPath: string;
    config?: KnowledgeConfig;
    now?: Date;
}
export interface ReindexHealthResult {
    schema_version: number;
    chunks: number;
    vector_entries: number;
    missing_embeddings: number;
    queued: Record<string, number>;
    stale_revisions: number;
}
export interface ReindexEnqueueResult {
    enqueued: number;
    already_queued: number;
    reason: string;
}
export interface ReindexEmbeddingsResult {
    run_id: string;
    full: boolean;
    deleted_embeddings: number;
    deleted_vector_entries: number;
    queued: ReindexEnqueueResult;
    indexed: Awaited<ReturnType<typeof indexKnowledgeEmbeddings>>;
    completed_queue_items: number;
}
export declare function reindexHealth(options: ReindexRuntimeOptions): ReindexHealthResult;
export declare function enqueueMissingEmbeddings(options: ReindexRuntimeOptions & {
    reason?: string;
}): ReindexEnqueueResult;
export declare function refreshEmbeddingIndex(options: ReindexRuntimeOptions & {
    full?: boolean;
    limit?: number;
}): Promise<ReindexEmbeddingsResult>;
