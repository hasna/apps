import type { StorageContract } from './storage-contract';
import type { KnowledgeWorkspace } from './workspace';
export interface KnowledgeWriteBoundaryViolation {
    code: 'write_boundary_not_enabled' | 'untracked_artifact_file' | 'artifact_hash_mismatch' | 'missing_artifact_file' | 'invalid_artifact_manifest_key' | 'symlink_workspace_path' | 'hardlinked_workspace_file' | 'workspace_path_escape' | 'unexpected_workspace_root_entry' | 'direct_workspace_artifact_file';
    severity: 'warn' | 'error';
    path: string | null;
    key: string | null;
    artifact_uri: string | null;
    message: string;
}
export interface KnowledgeWriteBoundaryStatus {
    ok: boolean;
    strict: boolean;
    protected: boolean;
    read_only: true;
    workspace_home: string;
    policy_path: string;
    instructions_path: string;
    artifact_root: string;
    storage_type: StorageContract['storage_type'];
    counts: {
        manifest_artifacts: number;
        local_artifact_files: number;
        checked_workspace_dirs: number;
        violations: number;
    };
    violations: KnowledgeWriteBoundaryViolation[];
    warnings: string[];
    message: string;
}
export interface KnowledgeStorageProtectionResult extends KnowledgeWriteBoundaryStatus {
    rules: string[];
    files_written: string[];
}
export declare const WRITE_BOUNDARY_RULES: string[];
export declare function writeBoundaryStatusFor(dbPath: string, workspace: KnowledgeWorkspace, storage: StorageContract, options?: {
    strict?: boolean;
}): KnowledgeWriteBoundaryStatus;
export declare function protectKnowledgeStorageBoundary(input: {
    dbPath: string;
    workspace: KnowledgeWorkspace;
    storage: StorageContract;
    scope: string;
}): KnowledgeStorageProtectionResult;
