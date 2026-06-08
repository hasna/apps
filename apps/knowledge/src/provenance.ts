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

export function isStaleStatus(status: string | null | undefined): boolean {
  return ['deleted', 'stale', 'invalidated', 'reindex_required'].includes((status ?? '').toLowerCase());
}

export function sourceProvenance(input: SourceProvenanceInput): KnowledgeProvenance {
  const status = input.status ?? null;
  return {
    source_owner: 'open-files',
    source_ref: input.source_ref ?? null,
    source_uri: input.source_uri ?? null,
    source_kind: input.source_kind ?? null,
    source_revision_id: input.source_revision_id ?? null,
    revision: input.revision ?? null,
    hash: input.hash ?? null,
    chunk_id: input.chunk_id ?? null,
    start_offset: input.start_offset ?? null,
    end_offset: input.end_offset ?? null,
    status,
    read_only: true,
    citation_required: true,
    resolver: input.resolver ?? null,
    stale: isStaleStatus(status),
  };
}

export function generatedArtifactProvenance(input: {
  generated_from: string;
  artifact_key: string;
  source_refs?: string[];
  citation_required?: boolean;
}): GeneratedArtifactProvenance {
  return {
    source_owner: 'open-files',
    generated_from: input.generated_from,
    artifact_key: input.artifact_key,
    source_refs: input.source_refs ?? [],
    read_only_sources: true,
    citation_required: input.citation_required ?? true,
    raw_source_bytes_stored_in_open_knowledge: false,
  };
}

export function withProvenance<T extends Record<string, unknown>>(
  metadata: T,
  provenance: KnowledgeProvenance | GeneratedArtifactProvenance,
): T & { provenance: KnowledgeProvenance | GeneratedArtifactProvenance } {
  return {
    ...metadata,
    provenance,
  };
}
