import type { KnowledgeWorkspace } from './workspace';
export interface WorkspaceTreeSummary {
    path: string;
    exists: boolean;
    file_count: number;
    total_bytes: number;
    tree_sha256: string | null;
    json_items: number | null;
    sqlite: {
        exists: boolean;
        integrity_check: string | null;
        table_counts: Record<string, number>;
    };
    artifacts: {
        exists: boolean;
        file_count: number;
        total_bytes: number;
        tree_sha256: string | null;
    };
    files: string[];
}
export interface KnowledgeLegacyWorkspaceMigrationResult {
    ok: boolean;
    dry_run: boolean;
    approval_required: boolean;
    scope: string;
    current_home: string;
    legacy_home: string;
    backup_home: string | null;
    tombstone_path: string | null;
    legacy_before: WorkspaceTreeSummary;
    current_before: WorkspaceTreeSummary;
    backup_after: WorkspaceTreeSummary | null;
    current_after: WorkspaceTreeSummary | null;
    checks: Record<string, boolean>;
    warnings: string[];
    message: string;
}
export interface KnowledgeLegacyWorkspaceMigrationOptions {
    scope: string;
    current: KnowledgeWorkspace;
    legacy: KnowledgeWorkspace;
    approveWrite?: boolean;
    approvedBy?: string;
    now?: Date;
}
export declare function summarizeWorkspaceTree(workspace: KnowledgeWorkspace): WorkspaceTreeSummary;
export declare function migrateLegacyKnowledgeWorkspace(options: KnowledgeLegacyWorkspaceMigrationOptions): KnowledgeLegacyWorkspaceMigrationResult;
