import { type EmbeddingRuntimeOptions } from './embeddings';
import { type GeneratedArtifactProvenance, type KnowledgeProvenance } from './provenance';
import type { KnowledgeConfig } from './workspace';
export type SearchResultKind = 'source_chunk' | 'wiki_chunk' | 'wiki_page' | 'knowledge_index';
export type SearchProvenance = KnowledgeProvenance | GeneratedArtifactProvenance;
export interface HybridSearchOptions extends EmbeddingRuntimeOptions {
    dbPath: string;
    query: string;
    limit?: number;
    semantic?: boolean;
    config?: KnowledgeConfig;
}
export interface HybridSearchResult {
    query: string;
    limit: number;
    mode: {
        keyword: true;
        catalog: true;
        semantic: boolean;
    };
    semantic_provider: string | null;
    semantic_model: string | null;
    semantic_dimensions: number | null;
    counts: {
        keyword_results: number;
        catalog_results: number;
        semantic_results: number;
        merged_results: number;
    };
    warnings: string[];
    results: HybridSearchEntry[];
}
export interface HybridSearchEntry {
    kind: SearchResultKind;
    id: string;
    title: string | null;
    text: string | null;
    score: number;
    scores: {
        keyword?: number;
        semantic?: number;
        catalog?: number;
    };
    source: {
        uri: string | null;
        ref: string | null;
        kind: string | null;
        revision: string | null;
        hash: string | null;
    } | null;
    citation: {
        chunk_id: string | null;
        start_offset: number | null;
        end_offset: number | null;
    } | null;
    artifact: {
        uri: string | null;
        path: string | null;
        hash: string | null;
        shard_key: string | null;
    } | null;
    provenance: SearchProvenance | null;
    reasons: string[];
}
export declare function hybridSearch(options: HybridSearchOptions): Promise<HybridSearchResult>;
