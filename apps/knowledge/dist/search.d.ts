import { type EmbeddingRuntimeOptions } from './embeddings';
import { type GeneratedArtifactProvenance, type KnowledgeProvenance } from './provenance';
import type { KnowledgeItem } from './store';
import type { KnowledgeConfig } from './workspace';
export type SearchResultKind = 'source_chunk' | 'wiki_chunk' | 'legacy_item' | 'wiki_page' | 'knowledge_index';
export type SearchProvenance = KnowledgeProvenance | GeneratedArtifactProvenance;
export interface HybridSearchOptions extends EmbeddingRuntimeOptions {
    dbPath: string;
    legacyStorePath?: string;
    query: string;
    limit?: number;
    /** Zero-based result offset for stable pagination over the ranked list. */
    offset?: number;
    semantic?: boolean;
    config?: KnowledgeConfig;
}
export interface HybridSearchResult {
    query: string;
    limit: number;
    offset: number;
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
export interface FtsMatchExpressions {
    /** Precise expression: positive terms AND-joined (unless `OR` is explicit). */
    and: string | null;
    /**
     * Recall expression: positive terms OR-joined. Used as a fallback when the
     * AND expression yields nothing, so natural-language questions (whose terms
     * rarely all co-occur in one chunk) still retrieve. Null when identical to
     * `and` (single positive term or explicit boolean already), letting callers
     * skip a redundant second query.
     */
    or: string | null;
}
export declare function hybridSearch(options: HybridSearchOptions): Promise<HybridSearchResult>;
export declare function hybridSearchLegacyStore(options: Omit<HybridSearchOptions, 'dbPath'>): Promise<HybridSearchResult>;
/**
 * Lexical search over an in-memory knowledge-item corpus. The HTTP client has
 * no on-box sqlite catalog; the shared corpus is fetched through the item Store.
 * Both `search` and `ask`
 * route their retrieval here so the HTTP transport is first-class instead of throwing.
 * Semantic ranking (vector index) lives only in the on-box sqlite catalog, so it
 * is reported as skipped rather than silently ignored.
 */
export declare function hybridSearchItems(items: KnowledgeItem[], options: Omit<HybridSearchOptions, 'dbPath' | 'legacyStorePath'>, baseWarnings?: string[]): Promise<HybridSearchResult>;
/**
 * Adapt an already-ranked, bounded producer page into the public hybrid-search
 * result shape without fetching or re-ranking the collection in the client.
 */
export declare function hybridSearchFromProducerPage(hits: readonly {
    item: KnowledgeItem;
    rank: number;
}[], options: Pick<HybridSearchOptions, 'query' | 'limit' | 'offset' | 'semantic'>, warnings?: string[], producerTotal?: number): HybridSearchResult;
