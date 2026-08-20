import { type MachineWorkspaceResolution } from "../topology.js";
export interface WorkspaceManifestRepairOptions {
    machineId: string;
    projectId: string;
    repoName?: string;
    openFilesRepoName?: string;
    projectRoot?: string;
    openFilesRoot?: string;
    workspaceRoot?: string;
    includeTailscale?: boolean;
    apply?: boolean;
    allowUntrusted?: boolean;
    now?: Date;
}
export type WorkspaceManifestRepairStatus = "unchanged" | "would_write" | "written" | "unresolved";
export interface WorkspaceManifestRepairPatch {
    field: "workspace_paths" | "open_files_roots";
    key: string;
    path: string | null;
    previous_path: string | null;
    status: WorkspaceManifestRepairStatus;
}
export interface WorkspaceManifestRepairResult {
    ok: boolean;
    applied: boolean;
    manifest_path: string;
    machine_id: string | null;
    project_id: string;
    repo_name: string;
    open_files_repo_name: string;
    trusted: boolean;
    resolution: MachineWorkspaceResolution;
    patches: WorkspaceManifestRepairPatch[];
    warnings: string[];
}
export declare function repairWorkspaceManifestMappings(options: WorkspaceManifestRepairOptions): WorkspaceManifestRepairResult;
