import type { StorageContract } from './storage-contract';
export type KnowledgeProvenanceIssueSeverity = 'warn' | 'error';
export interface KnowledgeProvenanceIssue {
    severity: KnowledgeProvenanceIssueSeverity;
    code: string;
    artifact_uri?: string;
    artifact_key?: string;
    page_id?: string;
    path?: string;
    message: string;
}
export interface KnowledgeProvenanceStatus {
    ok: boolean;
    read_only: true;
    storage_type: StorageContract['storage_type'];
    artifact_root_uri: string;
    counts: {
        storage_objects: number;
        wiki_pages: number;
        wiki_pages_with_artifacts: number;
        storage_objects_with_provenance: number;
        audit_events: number;
        warnings: number;
        errors: number;
    };
    issues: KnowledgeProvenanceIssue[];
    message: string;
}
export declare function provenanceStatusFor(dbPath: string, storage: StorageContract): KnowledgeProvenanceStatus;
