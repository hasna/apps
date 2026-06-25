import { type AiProviderId } from './providers';
import { type KnowledgeProvenance } from './provenance';
import type { KnowledgeConfig } from './workspace';
export interface EmbeddingRuntimeOptions {
    config?: KnowledgeConfig;
    env?: Record<string, string | undefined>;
    modelRef?: string;
    dimensions?: number;
    fake?: boolean;
    batchSize?: number;
    maxParallelCalls?: number;
    purpose?: string;
}
export interface EmbeddingIndexOptions extends EmbeddingRuntimeOptions {
    dbPath: string;
    limit?: number;
    sourceRevisionId?: string;
    now?: Date;
}
export interface EmbeddingSearchOptions extends EmbeddingRuntimeOptions {
    dbPath: string;
    query: string;
    limit?: number;
}
export interface EmbeddingUsage {
    input_tokens: number;
}
export interface EmbeddingVectorResult {
    provider: AiProviderId;
    model: string;
    dimensions: number;
    vectors: number[][];
    usage: EmbeddingUsage;
}
export interface EmbeddingIndexResult {
    provider: AiProviderId;
    model: string;
    dimensions: number;
    chunks_seen: number;
    chunks_embedded: number;
    embeddings_upserted: number;
    vector_entries_upserted: number;
    usage: EmbeddingUsage;
}
export interface EmbeddingStatusResult {
    total_embeddings: number;
    total_vector_entries: number;
    indexes: Array<{
        provider: string;
        model: string;
        dimensions: number;
        entries: number;
        updated_at: string | null;
    }>;
}
export interface SemanticSearchResult {
    provider: AiProviderId;
    model: string;
    dimensions: number;
    query: string;
    results: Array<{
        chunk_id: string;
        score: number;
        text: string;
        source_uri: string | null;
        source_ref: string | null;
        revision: string | null;
        hash: string | null;
        provenance: KnowledgeProvenance | null;
    }>;
}
export declare const DEFAULT_EMBEDDING_MODEL_REF = "openai:text-embedding-3-small";
export declare const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export declare function resolveEmbeddingModelRef(modelRef?: string, config?: KnowledgeConfig): string;
export declare function embedTexts(texts: string[], options?: EmbeddingRuntimeOptions): Promise<EmbeddingVectorResult>;
export declare function indexKnowledgeEmbeddings(options: EmbeddingIndexOptions): Promise<EmbeddingIndexResult>;
export declare function embeddingIndexStatus(dbPath: string): EmbeddingStatusResult;
export declare function searchVectorIndex(options: EmbeddingSearchOptions): Promise<SemanticSearchResult>;
