import type { KnowledgeConfig } from './workspace';
import { type SafetyPolicy } from './safety';
export interface ManifestIngestOptions {
    dbPath: string;
    input: string;
    config?: KnowledgeConfig;
    safetyPolicy?: SafetyPolicy;
    now?: Date;
    maxChunkChars?: number;
    chunkOverlapChars?: number;
    maxInputBytes?: number;
    maxItems?: number;
}
export interface ManifestItemsIngestOptions {
    dbPath: string;
    items: ManifestObject[];
    sourceLabel: string;
    readAction?: string;
    safetyPolicy?: SafetyPolicy;
    now?: Date;
    maxChunkChars?: number;
    chunkOverlapChars?: number;
    maxItems?: number;
}
export interface ManifestIngestResult {
    path: string;
    db_path: string;
    items_seen: number;
    sources_upserted: number;
    revisions_upserted: number;
    chunks_inserted: number;
    chunks_deleted: number;
    redactions: number;
    skipped: number;
    items_preview: Array<{
        source_ref: string;
        title: string | null;
        status: string;
        has_text: boolean;
    }>;
}
export type ManifestObject = Record<string, unknown>;
export declare function ingestOpenFilesManifest(options: ManifestIngestOptions): Promise<ManifestIngestResult>;
export declare function ingestOpenFilesManifestItems(options: ManifestItemsIngestOptions): Promise<ManifestIngestResult>;
