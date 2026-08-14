import { type KnowledgeProvenance } from './provenance';
import { type SafetyPolicy } from './safety';
export interface SourceResolveOptions {
    dbPath: string;
    sourceRef: string;
    purpose?: string;
    limit?: number;
    now?: Date;
    safetyPolicy?: SafetyPolicy;
}
export interface SourceResolverEvidence {
    resolver: 'open-files-read-only';
    mode: 'local_catalog';
    purpose: string;
    read_only: true;
    source_ref: string;
    source_uri: string;
    source_revision_id: string | null;
    revision: string | null;
    hash: string | null;
    chunk_id?: string;
    start_offset?: number | null;
    end_offset?: number | null;
    resolved_at: string;
}
export interface ResolvedSourceChunk {
    id: string;
    kind: string;
    ordinal: number;
    text: string;
    token_count: number | null;
    start_offset: number | null;
    end_offset: number | null;
    metadata: Record<string, unknown>;
    evidence: SourceResolverEvidence;
    provenance: KnowledgeProvenance;
}
export interface ResolvedSourceCitation {
    source_ref: string;
    source_uri: string;
    chunk_id: string;
    quote: string;
    start_offset: number | null;
    end_offset: number | null;
    evidence: SourceResolverEvidence;
    provenance: KnowledgeProvenance;
}
export interface SourceResolveResult {
    source_ref: string;
    source_uri: string;
    purpose: string;
    read_only: true;
    resolved: boolean;
    resolver: {
        name: 'open-files-read-only';
        mode: 'local_catalog';
        contract: 'open-files-knowledge-source-v1';
    };
    source: {
        id: string;
        uri: string;
        kind: string;
        title: string | null;
        metadata: Record<string, unknown>;
        permissions: Record<string, unknown>;
        updated_at: string;
    } | null;
    revision: {
        id: string;
        revision: string;
        hash: string | null;
        extracted_text_uri: string | null;
        metadata: Record<string, unknown>;
        created_at: string;
        reindex_required: boolean;
    } | null;
    content: {
        mime: string | null;
        size: number | null;
        hash: string | null;
        text_available: boolean;
        chunks_total: number;
        chunks_returned: number;
        char_count_returned: number;
        extracted_text_ref: string | null;
        bytes_available: false;
        bytes_exposed: false;
    };
    chunks: ResolvedSourceChunk[];
    citations: ResolvedSourceCitation[];
}
export declare function resolveOpenFilesSource(options: SourceResolveOptions): Promise<SourceResolveResult>;
