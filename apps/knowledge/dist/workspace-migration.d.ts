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
export interface KnowledgeLegacyWorkspaceMergeStats {
    current_items: number;
    legacy_items: number;
    duplicate_ids_identical: number;
    duplicate_ids_conflicting: number;
    short_id_conflicts: number;
    stranded_items: number;
    merged_items: number;
    expected_total_items: number;
    final_items: number | null;
}
export interface KnowledgeLegacyWorkspaceMergeConflict {
    type: 'id_conflict' | 'short_id_conflict';
    id: string;
    legacy_id?: string;
    current_id?: string;
    legacy_title?: string;
    current_title?: string;
}
export interface KnowledgeLegacyWorkspaceMergeResult {
    ok: boolean;
    dry_run: boolean;
    approval_required: boolean;
    scope: string;
    current_home: string;
    legacy_home: string;
    backup_home: string | null;
    legacy_before: WorkspaceTreeSummary;
    current_before: WorkspaceTreeSummary;
    backup_after: WorkspaceTreeSummary | null;
    current_after: WorkspaceTreeSummary | null;
    merge: KnowledgeLegacyWorkspaceMergeStats;
    conflicts: KnowledgeLegacyWorkspaceMergeConflict[];
    checks: Record<string, boolean>;
    warnings: string[];
    message: string;
}
export interface KnowledgeLegacyWorkspaceMergeOptions {
    scope: string;
    current: KnowledgeWorkspace;
    legacy: KnowledgeWorkspace;
    approveWrite?: boolean;
    approvedBy?: string;
    now?: Date;
}
export interface KnowledgeLegacyWorkspaceMigrationOptions {
    scope: string;
    current: KnowledgeWorkspace;
    legacy: KnowledgeWorkspace;
    approveWrite?: boolean;
    approvedBy?: string;
    now?: Date;
}
export declare function summarizeWorkspaceTree(workspace: KnowledgeWorkspace, options?: {
    includeSqlite?: boolean;
}): WorkspaceTreeSummary;
export declare function mergeLegacyKnowledgeWorkspace(options: KnowledgeLegacyWorkspaceMergeOptions): KnowledgeLegacyWorkspaceMergeResult;
export declare function migrateLegacyKnowledgeWorkspace(options: KnowledgeLegacyWorkspaceMigrationOptions): KnowledgeLegacyWorkspaceMigrationResult;
