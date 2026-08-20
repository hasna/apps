import { MACHINES_CONSUMER_CONTRACT_VERSION, MACHINES_PACKAGE_NAME } from "./topology.js";
export type MachineDataSeverity = "critical" | "warning" | "notice";
export type MachineDataTaskPriority = "critical" | "high" | "medium" | "low";
export type MachineDataTaskActionStatus = "created" | "existing" | "failed" | "skipped";
export interface MachineDataTaskSuggestion {
    fingerprint: string;
    dedupe_key: string;
    title: string;
    description: string;
    priority: MachineDataTaskPriority;
    tags: string[];
}
export interface MachineDataTaskAction {
    action: MachineDataTaskActionStatus;
    dedupe_key: string;
    title: string;
    task_id?: string;
    error?: string;
    reason?: string;
}
export interface MachineDataTaskUpsertOptions {
    project?: string;
    taskList?: string;
    todosBin?: string;
    maxActions?: number;
    commandTimeoutMs?: number;
    runner?: MachineDataTodosCommandRunner;
}
export interface MachineDataTodosCommandResult {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: unknown;
}
export type MachineDataTodosCommandRunner = (args: string[]) => MachineDataTodosCommandResult;
export interface CriticalDbIntegrityFinding {
    path: string;
    size_bytes: number;
    status: "ok" | "failed" | "skipped_large" | "skipped_max_dbs" | "skipped_budget";
    check_tool: "sqlite3" | "none";
    message: string | null;
    fingerprint: string;
}
export interface CriticalDbIntegrityReport {
    schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
    package: {
        name: typeof MACHINES_PACKAGE_NAME;
        version: string;
    };
    generated_at: string;
    kind: "machine_data_db_integrity";
    ok: boolean;
    roots: string[];
    summary: {
        discovered: number;
        checked: number;
        failed: number;
        skipped: number;
        skipped_large: number;
        truncated: boolean;
    };
    findings: CriticalDbIntegrityFinding[];
    task_suggestions: MachineDataTaskSuggestion[];
    task_actions?: MachineDataTaskAction[];
    artifacts: Array<{
        kind: string;
        ref: string;
        format: "json";
        private: boolean;
    }>;
    bounds: {
        max_dbs: number;
        max_size_bytes: number;
        max_depth: number;
        quick_check_timeout_ms: number;
        max_total_ms: number;
    };
}
export interface DbIntegrityOptions {
    roots?: string[];
    maxDbs?: number;
    maxSizeBytes?: number;
    maxDepth?: number;
    quickCheckTimeoutMs?: number;
    maxTotalMs?: number;
    reportDir?: string;
    sqliteBin?: string;
}
export interface OpsStateSnapshotItem {
    path: string;
    size_bytes: number;
    status: "planned" | "sqlite_backup" | "copy" | "backup_failed" | "copy_failed" | "skipped_large" | "skipped_max_dbs";
    method: "sqlite_backup" | "copy" | "none";
    snapshot_path: string | null;
    message: string | null;
    fingerprint: string;
}
export interface OpsStateSnapshotReport {
    schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
    package: {
        name: typeof MACHINES_PACKAGE_NAME;
        version: string;
    };
    generated_at: string;
    kind: "machine_data_ops_state_snapshot";
    ok: boolean;
    apply: boolean;
    roots: string[];
    snapshot_root: string;
    snapshot_dir: string | null;
    summary: {
        discovered: number;
        planned: number;
        copied: number;
        failed: number;
        skipped: number;
        removed_old_snapshots: number;
        truncated: boolean;
    };
    items: OpsStateSnapshotItem[];
    task_suggestions: MachineDataTaskSuggestion[];
    task_actions?: MachineDataTaskAction[];
    artifacts: Array<{
        kind: string;
        ref: string;
        format: "json";
        private: boolean;
    }>;
    bounds: {
        max_dbs: number;
        max_size_bytes: number;
        max_depth: number;
        keep_days: number;
    };
}
export interface OpsStateSnapshotOptions {
    roots?: string[];
    snapshotRoot?: string;
    reportDir?: string;
    maxDbs?: number;
    maxSizeBytes?: number;
    maxDepth?: number;
    keepDays?: number;
    apply?: boolean;
    sqliteBin?: string;
}
export declare function getCriticalDbIntegrityReport(options?: DbIntegrityOptions): CriticalDbIntegrityReport;
export declare function getOpsStateSnapshotReport(options?: OpsStateSnapshotOptions): OpsStateSnapshotReport;
export declare function upsertMachineDataTasks(result: {
    generated_at: string;
    kind: string;
    ok: boolean;
    task_suggestions: MachineDataTaskSuggestion[];
    task_actions?: MachineDataTaskAction[];
}, options: MachineDataTaskUpsertOptions): MachineDataTaskAction[];
