import type { ArtifactStore } from './artifact-store';
import type { KnowledgeContextPack } from './retrieval';
export interface WikiCompileOptions {
    dbPath: string;
    store: ArtifactStore;
    title?: string;
    query?: string;
    sourceRefs?: string[];
    limit?: number;
    approveWrite?: boolean;
    approvedBy?: string;
    now?: Date;
}
export interface WikiCompileResult {
    page_id: string;
    path: string;
    artifact_uri: string;
    content_hash: string;
    chunks_seen: number;
    citations_written: number;
    concept_page_id: string | null;
    indexes_updated: number;
    log_key: string;
    warnings: string[];
}
export interface WikiAnswerFileOptions {
    dbPath: string;
    store: ArtifactStore;
    prompt: string;
    answer: string;
    context: KnowledgeContextPack;
    approveWrite?: boolean;
    approvedBy?: string;
    now?: Date;
}
export interface WikiAnswerFileResult {
    approved: boolean;
    durable_writes_performed: boolean;
    page_id: string | null;
    path: string | null;
    artifact_uri: string | null;
    citations_written: number;
    log_key: string | null;
    message: string;
}
export interface WikiLintIssue {
    type: 'missing_citation' | 'stale_citation' | 'duplicate_page' | 'orphan_page' | 'unresolved_source_ref' | 'contradiction_marker' | 'new_article_candidate' | 'expired_page';
    severity: 'info' | 'warn' | 'error';
    page_id?: string;
    path?: string;
    source_uri?: string;
    chunk_id?: string;
    message: string;
}
export interface WikiLintResult {
    ok: boolean;
    issue_count: number;
    issues: WikiLintIssue[];
    counts: {
        active_pages: number;
        citations: number;
        backlinks: number;
        new_article_candidates: number;
    };
}
export declare function compileWikiPage(options: WikiCompileOptions): Promise<WikiCompileResult>;
export declare function fileAnswerToWiki(options: WikiAnswerFileOptions): Promise<WikiAnswerFileResult>;
export declare function lintWiki(options: {
    dbPath: string;
}): WikiLintResult;
