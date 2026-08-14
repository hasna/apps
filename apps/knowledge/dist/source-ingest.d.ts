import { type ManifestIngestResult } from './manifest-ingest';
import type { KnowledgeConfig } from './workspace';
import { type SafetyPolicy } from './safety';
export interface SourceIngestOptions {
    dbPath: string;
    sourceRef: string;
    purpose?: string;
    config?: KnowledgeConfig;
    safetyPolicy?: SafetyPolicy;
    now?: Date;
}
export interface SourceIngestResult extends ManifestIngestResult {
    source_ref: string;
    content_source: 'catalog_chunks' | 'extracted_text_ref' | 'file' | 's3' | 'web';
    read_only: true;
    hash: string;
}
export declare function ingestSourceRef(options: SourceIngestOptions): Promise<SourceIngestResult>;
