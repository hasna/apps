import type { MachineTopologyOptions } from "./topology.js";
import { STATIONS_CONSUMER_CONTRACT_VERSION, type StationsContractPackage } from "./topology.js";
import type { FleetManifest } from "./types.js";
export type MachineProjectAssignmentSource = "project_assignments" | "workspace_paths" | "project_paths" | "repo_paths" | "projects";
export interface MachineProjectAssignment {
    id: string;
    project_type: "projects";
    project_id: string;
    workspace_id: string | null;
    repo_name: string | null;
    project: {
        project_type: "projects";
        project_id: string;
        workspace_id: string | null;
        repo_name: string | null;
    };
    machine_id: string;
    machine: {
        machine_id: string;
        hostname: string | null;
        current: boolean;
        primary: boolean;
        trust_status: "trusted" | "untrusted" | "unknown";
        auth_status: "authenticated" | "unauthenticated" | "unknown";
    };
    path: string | null;
    location: {
        path: string | null;
        label: string;
        kind: string;
        primary: boolean;
        source: "manifest_metadata";
        exists: boolean | null;
    };
    workspace_root: string | null;
    workspace_root_ref: {
        path: string | null;
        source: "manifest" | "manifest_metadata" | "unresolved";
    };
    open_files_root: string | null;
    open_files_root_ref: {
        path: string | null;
        source: "manifest_metadata" | "unresolved";
    };
    label: string;
    kind: string;
    is_primary: boolean;
    manifest_declared: boolean;
    metadata: Record<string, unknown>;
    projects_location_input: {
        project: string;
        machine_id: string;
        path: string | null;
        label: string;
        kind: string;
        primary: boolean;
        metadata: Record<string, unknown>;
    };
    diagnostics: Array<{
        id: string;
        severity: "ok" | "warn" | "fail";
        message: string;
    }>;
    warnings: string[];
    source: MachineProjectAssignmentSource;
    created_at: string | null;
    updated_at: string | null;
}
export interface MachineProjectAssignmentProjectSummary {
    project_type: "projects";
    project_id: string;
    workspace_id: string | null;
    repo_name: string | null;
    machine_ids: string[];
    primary_machine_id: string | null;
    assignment_count: number;
}
export interface MachineProjectAssignmentMachineSummary {
    machine_id: string;
    project_ids: string[];
    primary_project_id: string | null;
    assignment_count: number;
}
export interface MachineProjectAssignments {
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    generated_at: string;
    filters: {
        machine_id: string | null;
        project_id: string | null;
    };
    assignments: MachineProjectAssignment[];
    projects: MachineProjectAssignmentProjectSummary[];
    stations: MachineProjectAssignmentMachineSummary[];
    warnings: string[];
}
export interface MachineProjectAssignmentsOptions extends MachineTopologyOptions {
    machineId?: string;
    projectId?: string;
    now?: Date;
    manifest?: FleetManifest;
}
export interface AssignMachineProjectInput {
    machineId: string;
    projectId: string;
    path: string;
    workspaceId?: string | null;
    repoName?: string | null;
    workspaceRoot?: string | null;
    openFilesRoot?: string | null;
    label?: string;
    kind?: string;
    primary?: boolean;
    metadata?: Record<string, unknown>;
}
export interface RemoveMachineProjectAssignmentInput {
    machineId: string;
    projectId: string;
}
export declare function listMachineProjectAssignments(options?: MachineProjectAssignmentsOptions): MachineProjectAssignments;
export declare function projectAssignmentResourceId(machineId: string, projectId: string): string;
export declare function projectAssignmentMutationArgs(input: AssignMachineProjectInput): Record<string, unknown>;
export declare function removeProjectAssignmentMutationArgs(input: RemoveMachineProjectAssignmentInput): Record<string, unknown>;
export declare function assignMachineProject(input: AssignMachineProjectInput): MachineProjectAssignments;
export declare function removeMachineProjectAssignment(input: RemoveMachineProjectAssignmentInput): MachineProjectAssignments;
