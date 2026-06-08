import type { Database } from 'bun:sqlite';
import type { ArtifactStore } from './artifact-store';
import { type GeneratedStorageObject } from './storage-contract';
export interface WikiLayoutInitResult {
    schema_key: string;
    root_index_key: string;
    wiki_readme_key: string;
    log_key: string;
    artifacts: GeneratedStorageObject[];
    written: string[];
}
interface CatalogArtifact {
    key: string;
    uri: string;
    hash?: string;
    metadata?: Record<string, unknown>;
}
export declare function agentSchemaTemplate(): string;
export declare function rootIndexTemplate(): string;
export declare function wikiReadmeTemplate(): string;
export declare function initializeWikiLayout(store: ArtifactStore, now?: Date): Promise<WikiLayoutInitResult>;
export declare function recordWikiLayoutCatalog(db: Database, artifacts: CatalogArtifact[], now?: Date): void;
export {};
