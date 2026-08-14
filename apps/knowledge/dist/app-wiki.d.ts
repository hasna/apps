import type { ArtifactStore } from './artifact-store';
import { type SourceIngestResult } from './source-ingest';
import { type SafetyPolicy } from './safety';
import type { KnowledgeConfig, KnowledgeWorkspace } from './workspace';
export interface AppWikiWriteGuardOptions {
    scope: string;
    workspace: KnowledgeWorkspace;
    safetyPolicy?: SafetyPolicy;
    allowGlobal?: boolean;
}
export interface AppWikiInitOptions extends AppWikiWriteGuardOptions {
    store: ArtifactStore;
    now?: Date;
}
export interface AppWikiNoteInput extends AppWikiWriteGuardOptions {
    store: ArtifactStore;
    title: string;
    content: string;
    tags?: string[];
    sourceRefs?: string[];
    path?: string;
    metadata?: Record<string, unknown>;
    now?: Date;
}
export interface AppWikiNoteListOptions {
    dbPath: string;
    limit?: number;
}
export interface AppWikiNoteGetOptions {
    dbPath: string;
    store: ArtifactStore;
    id: string;
    includeContent?: boolean;
}
export interface AppWikiSourceRefInput extends AppWikiWriteGuardOptions {
    sourceRef: string;
    purpose?: string;
    config?: KnowledgeConfig;
}
export interface AppWikiNoteRecord {
    id: string;
    path: string;
    title: string;
    artifact_uri: string | null;
    content_hash: string | null;
    tags: string[];
    source_refs: string[];
    created_at: string;
    updated_at: string;
}
export interface AppWikiNoteGetResult {
    ok: true;
    note: AppWikiNoteRecord;
    citations: Array<Record<string, unknown>>;
    content: string | null;
}
export interface AppWikiNoteWriteResult {
    ok: true;
    scope: string;
    workspace_home: string;
    note: AppWikiNoteRecord;
    artifact_uri: string;
    content_hash: string;
    citations_written: number;
    chunks_written: number;
    storage_objects_written: number;
    message: string;
}
export interface AppWikiInitResult {
    ok: true;
    scope: string;
    workspace_home: string;
    knowledge_db_path: string;
    schema_version: number;
    store_type: ArtifactStore['type'];
    global_write_allowed: boolean;
    message: string;
}
export declare function assertAppWikiWriteAllowed(options: AppWikiWriteGuardOptions): void;
export declare function initAppWikiScope(options: AppWikiInitOptions): Promise<AppWikiInitResult>;
export declare function writeAppWikiNote(options: AppWikiNoteInput): Promise<AppWikiNoteWriteResult>;
export declare function listAppWikiNotes(options: AppWikiNoteListOptions): AppWikiNoteRecord[];
export declare function getAppWikiNote(options: AppWikiNoteGetOptions): Promise<AppWikiNoteGetResult | null>;
export declare function ingestAppWikiSourceRef(options: AppWikiSourceRefInput): Promise<SourceIngestResult>;
