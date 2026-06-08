import { type HybridSearchEntry, type HybridSearchOptions, type HybridSearchResult, type SearchProvenance } from './search';
export interface RetrievalOptions extends HybridSearchOptions {
    contextChars?: number;
}
export interface RerankedSearchEntry extends HybridSearchEntry {
    rerank: {
        base_score: number;
        final_score: number;
        exact_score: number;
        citation_score: number;
        freshness_score: number;
        authority_score: number;
    };
}
export interface RetrievalCitation {
    id: string;
    result_id: string;
    kind: HybridSearchEntry['kind'];
    source_uri: string | null;
    source_ref: string | null;
    artifact_uri: string | null;
    artifact_path: string | null;
    revision: string | null;
    hash: string | null;
    chunk_id: string | null;
    start_offset: number | null;
    end_offset: number | null;
    quote: string | null;
    provenance: SearchProvenance | null;
}
export interface RetrievalExcerpt {
    id: string;
    result_id: string;
    citation_id: string | null;
    kind: HybridSearchEntry['kind'];
    text: string;
    score: number;
}
export interface RetrievalGraphEvidence {
    citations: Array<{
        id: string;
        chunk_id: string | null;
        wiki_page_id: string | null;
        source_uri: string;
        quote: string | null;
        start_offset: number | null;
        end_offset: number | null;
    }>;
    backlinks: Array<{
        from_page_id: string;
        to_page_id: string;
        label: string | null;
    }>;
}
export interface KnowledgeContextPack {
    query: string;
    normalized_query: string;
    created_at: string;
    mode: HybridSearchResult['mode'];
    warnings: string[];
    search_counts: HybridSearchResult['counts'];
    results: RerankedSearchEntry[];
    citations: RetrievalCitation[];
    excerpts: RetrievalExcerpt[];
    graph: RetrievalGraphEvidence;
    notes: {
        permissions: string[];
        freshness: string[];
    };
}
export declare function retrieveKnowledgeContext(options: RetrievalOptions): Promise<KnowledgeContextPack>;
