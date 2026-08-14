export interface KnowledgeProvenance {
    source_owner: 'open-files';
    source_ref: string | null;
    source_uri: string | null;
    source_kind: string | null;
    source_revision_id: string | null;
    revision: string | null;
    hash: string | null;
    chunk_id: string | null;
    start_offset: number | null;
    end_offset: number | null;
    status: string | null;
    read_only: true;
    citation_required: boolean;
    resolver: string | null;
    stale: boolean;
}
export interface GeneratedArtifactProvenance {
    source_owner: 'open-files';
    generated_from: string;
    artifact_key: string;
    source_refs: string[];
    read_only_sources: true;
    citation_required: boolean;
    raw_source_bytes_stored_in_open_knowledge: false;
}
export interface SourceProvenanceInput {
    source_ref?: string | null;
    source_uri?: string | null;
    source_kind?: string | null;
    source_revision_id?: string | null;
    revision?: string | null;
    hash?: string | null;
    chunk_id?: string | null;
    start_offset?: number | null;
    end_offset?: number | null;
    status?: string | null;
    resolver?: string | null;
}
export declare function isStaleStatus(status: string | null | undefined): boolean;
export declare function sourceProvenance(input: SourceProvenanceInput): KnowledgeProvenance;
export declare function generatedArtifactProvenance(input: {
    generated_from: string;
    artifact_key: string;
    source_refs?: string[];
    citation_required?: boolean;
}): GeneratedArtifactProvenance;
export declare function withProvenance<T extends Record<string, unknown>>(metadata: T, provenance: KnowledgeProvenance | GeneratedArtifactProvenance): T & {
    provenance: KnowledgeProvenance | GeneratedArtifactProvenance;
};
