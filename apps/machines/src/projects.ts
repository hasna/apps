import { findManifestMachine, readManifest, writeManifest } from "./manifests.js";
import type { MachineTopologyOptions } from "./topology.js";
import {
  MACHINES_CONSUMER_CONTRACT_VERSION,
  MACHINES_PACKAGE_NAME,
  type MachinesContractPackage,
} from "./topology.js";
import type { FleetManifest, MachineManifest } from "./types.js";
import { getPackageVersion } from "./version.js";

export type MachineProjectAssignmentSource =
  | "project_assignments"
  | "workspace_paths"
  | "project_paths"
  | "repo_paths"
  | "projects";

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
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  generated_at: string;
  filters: {
    machine_id: string | null;
    project_id: string | null;
  };
  assignments: MachineProjectAssignment[];
  projects: MachineProjectAssignmentProjectSummary[];
  machines: MachineProjectAssignmentMachineSummary[];
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

const ASSIGNMENT_MAP_KEYS = ["project_assignments", "projectAssignments"] as const;
const PATH_MAP_KEYS = ["workspace_paths", "workspacePaths", "project_paths", "projectPaths", "repo_paths", "repoPaths", "projects"] as const;
const OPEN_FILES_MAP_KEYS = ["open_files_roots", "openFilesRoots", "open_files_paths", "openFilesPaths"] as const;
const PRIMARY_PROJECTS_KEYS = ["primary_projects", "primaryProjects"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeKey(value: string): string {
  return value.trim();
}

function metadataString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function metadataBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = booleanValue(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function metadataObject(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return null;
}

function metadataStringArray(record: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  return [];
}

function readPathFromAssignment(value: unknown): string | null {
  if (typeof value === "string") return stringValue(value);
  if (!isRecord(value)) return null;
  return metadataString(value, ["path", "root", "workspacePath", "workspace_path", "projectRoot", "project_root"]);
}

function readOpenFilesRoot(metadata: Record<string, unknown>, projectId: string): string | null {
  for (const key of OPEN_FILES_MAP_KEYS) {
    const container = metadata[key];
    if (!isRecord(container)) continue;
    const value = container[projectId];
    if (typeof value === "string") return stringValue(value);
    if (isRecord(value)) {
      const path = metadataString(value, ["path", "root", "openFilesRoot", "open_files_root"]);
      if (path) return path;
    }
  }
  return null;
}

function assignmentId(machineId: string, projectId: string): string {
  return `machine:${machineId}:project:${projectId}`;
}

function createAssignment(input: {
  machine: MachineManifest;
  localMachineId: string | null;
  projectId: string;
  source: MachineProjectAssignmentSource;
  value: unknown;
  pathFallback?: string | null;
}): MachineProjectAssignment | null {
  const projectId = normalizeKey(input.projectId);
  if (!projectId) return null;
  const assignmentRecord = isRecord(input.value) ? input.value : {};
  const metadata = isRecord(assignmentRecord.metadata) ? assignmentRecord.metadata : {};
  const machineMetadata = isRecord(input.machine.metadata) ? input.machine.metadata : {};
  const path = readPathFromAssignment(input.value) ?? input.pathFallback ?? null;
  const primaryProjects = metadataStringArray(machineMetadata, PRIMARY_PROJECTS_KEYS);
  const workspaceRoot = metadataString(assignmentRecord, ["workspace_root", "workspaceRoot"]) ?? input.machine.workspacePath ?? null;
  const openFilesRoot = metadataString(assignmentRecord, ["open_files_root", "openFilesRoot"]) ?? readOpenFilesRoot(machineMetadata, projectId);
  const workspaceId = metadataString(assignmentRecord, ["workspace_id", "workspaceId"]) ?? null;
  const repoName = metadataString(assignmentRecord, ["repo_name", "repoName"]) ?? projectId;
  const label = metadataString(assignmentRecord, ["label"]) ?? "main";
  const kind = metadataString(assignmentRecord, ["kind"]) ?? "local";
  const isPrimary = metadataBoolean(assignmentRecord, ["is_primary", "isPrimary", "primary"]) ?? primaryProjects.includes(projectId);
  const trustStatus = metadataBoolean(machineMetadata, ["trusted", "syncTrusted", "sync_trusted"]) === false
    ? "untrusted"
    : metadataString(machineMetadata, ["trust_status", "trustStatus"]) === "untrusted"
      ? "untrusted"
      : metadataString(machineMetadata, ["trust_status", "trustStatus"]) === "trusted" || input.machine.tags?.includes("trusted")
        ? "trusted"
        : "unknown";
  const authStatus = metadataBoolean(machineMetadata, ["authenticated", "sshAuthorized", "ssh_authorized"]) === false
    ? "unauthenticated"
    : metadataString(machineMetadata, ["auth_status", "authStatus"]) === "unauthenticated"
      ? "unauthenticated"
      : metadataString(machineMetadata, ["auth_status", "authStatus"]) === "authenticated"
        ? "authenticated"
        : "unknown";
  const id = assignmentId(input.machine.id, projectId);
  const projectsMetadata = {
    source: "machines",
    machine_id: input.machine.id,
    assignment_id: id,
    path_source: "manifest_metadata",
    workspace_id: workspaceId,
    repo_name: repoName,
    ...metadata,
  };
  return {
    id,
    project_type: "projects",
    project_id: projectId,
    workspace_id: workspaceId,
    repo_name: repoName,
    project: {
      project_type: "projects",
      project_id: projectId,
      workspace_id: workspaceId,
      repo_name: repoName,
    },
    machine_id: input.machine.id,
    machine: {
      machine_id: input.machine.id,
      hostname: input.machine.hostname ?? null,
      current: input.localMachineId ? input.machine.id === input.localMachineId : false,
      primary: isPrimary,
      trust_status: trustStatus,
      auth_status: authStatus,
    },
    path,
    location: {
      path,
      label,
      kind,
      primary: isPrimary,
      source: "manifest_metadata",
      exists: null,
    },
    workspace_root: workspaceRoot,
    workspace_root_ref: {
      path: workspaceRoot,
      source: workspaceRoot ? "manifest" : "unresolved",
    },
    open_files_root: openFilesRoot,
    open_files_root_ref: {
      path: openFilesRoot,
      source: openFilesRoot ? "manifest_metadata" : "unresolved",
    },
    label,
    kind,
    is_primary: isPrimary,
    manifest_declared: true,
    metadata,
    projects_location_input: {
      project: workspaceId ?? projectId,
      machine_id: input.machine.id,
      path,
      label,
      kind,
      primary: isPrimary,
      metadata: projectsMetadata,
    },
    diagnostics: path
      ? [{ id: "location_path", severity: "ok", message: "Project location path is available from machine manifest metadata." }]
      : [{ id: "location_path", severity: "fail", message: "Project location path is unresolved." }],
    warnings: [],
    source: input.source,
    created_at: metadataString(assignmentRecord, ["created_at", "createdAt"]),
    updated_at: metadataString(assignmentRecord, ["updated_at", "updatedAt"]),
  };
}

function collectAssignmentMapEntries(machine: MachineManifest, localMachineId: string | null): MachineProjectAssignment[] {
  const metadata = isRecord(machine.metadata) ? machine.metadata : {};
  const assignments: MachineProjectAssignment[] = [];

  for (const key of ASSIGNMENT_MAP_KEYS) {
    const container = metadata[key];
    if (Array.isArray(container)) {
      for (const value of container) {
        if (!isRecord(value)) continue;
        const projectId = metadataString(value, ["project_id", "projectId", "id", "slug", "workspace_id", "workspaceId"]);
        if (!projectId) continue;
        const assignment = createAssignment({ machine, localMachineId, projectId, source: "project_assignments", value });
        if (assignment) assignments.push(assignment);
      }
    } else if (isRecord(container)) {
      for (const [projectId, value] of Object.entries(container)) {
        const assignment = createAssignment({ machine, localMachineId, projectId, source: "project_assignments", value });
        if (assignment) assignments.push(assignment);
      }
    }
  }

  return assignments;
}

function collectPathMapEntries(machine: MachineManifest, localMachineId: string | null): MachineProjectAssignment[] {
  const metadata = isRecord(machine.metadata) ? machine.metadata : {};
  const assignments: MachineProjectAssignment[] = [];
  for (const key of PATH_MAP_KEYS) {
    const container = metadata[key];
    if (!isRecord(container)) continue;
    const source = key === "workspace_paths" || key === "workspacePaths"
      ? "workspace_paths"
      : key === "project_paths" || key === "projectPaths"
        ? "project_paths"
        : key === "repo_paths" || key === "repoPaths"
          ? "repo_paths"
          : "projects";
    for (const [projectId, value] of Object.entries(container)) {
      const assignment = createAssignment({ machine, localMachineId, projectId, source, value });
      if (assignment) assignments.push(assignment);
    }
  }
  return assignments;
}

function assignmentPriority(source: MachineProjectAssignmentSource): number {
  if (source === "project_assignments") return 0;
  if (source === "workspace_paths") return 1;
  if (source === "project_paths") return 2;
  if (source === "repo_paths") return 3;
  return 4;
}

function mergeAssignments(assignments: MachineProjectAssignment[]): MachineProjectAssignment[] {
  const byId = new Map<string, MachineProjectAssignment>();
  for (const assignment of assignments) {
    const existing = byId.get(assignment.id);
    if (!existing || assignmentPriority(assignment.source) < assignmentPriority(existing.source)) {
      byId.set(assignment.id, {
        ...existing,
        ...assignment,
        open_files_root: assignment.open_files_root ?? existing?.open_files_root ?? null,
        workspace_root: assignment.workspace_root ?? existing?.workspace_root ?? null,
        metadata: { ...(existing?.metadata ?? {}), ...assignment.metadata },
      });
      continue;
    }
    byId.set(assignment.id, {
      ...existing,
      open_files_root: existing.open_files_root ?? assignment.open_files_root,
      workspace_root: existing.workspace_root ?? assignment.workspace_root,
      metadata: { ...assignment.metadata, ...existing.metadata },
    });
  }
  return [...byId.values()].sort((left, right) => {
    const project = left.project_id.localeCompare(right.project_id);
    return project !== 0 ? project : left.machine_id.localeCompare(right.machine_id);
  });
}

function projectSummaries(assignments: MachineProjectAssignment[]): MachineProjectAssignmentProjectSummary[] {
  const groups = new Map<string, MachineProjectAssignment[]>();
  for (const assignment of assignments) {
    const key = assignment.workspace_id ?? assignment.project_id;
    groups.set(key, [...(groups.get(key) ?? []), assignment]);
  }
  return [...groups.values()].map((entries) => {
    const first = entries[0]!;
    return {
      project_type: "projects" as const,
      project_id: first.project_id,
      workspace_id: first.workspace_id,
      repo_name: first.repo_name,
      machine_ids: [...new Set(entries.map((entry) => entry.machine_id))].sort(),
      primary_machine_id: entries.find((entry) => entry.is_primary)?.machine_id ?? null,
      assignment_count: entries.length,
    };
  }).sort((left, right) => left.project_id.localeCompare(right.project_id));
}

function machineSummaries(assignments: MachineProjectAssignment[]): MachineProjectAssignmentMachineSummary[] {
  const groups = new Map<string, MachineProjectAssignment[]>();
  for (const assignment of assignments) {
    groups.set(assignment.machine_id, [...(groups.get(assignment.machine_id) ?? []), assignment]);
  }
  return [...groups.entries()].map(([machineId, entries]) => ({
    machine_id: machineId,
    project_ids: [...new Set(entries.map((entry) => entry.project_id))].sort(),
    primary_project_id: entries.find((entry) => entry.is_primary)?.project_id ?? null,
    assignment_count: entries.length,
  })).sort((left, right) => left.machine_id.localeCompare(right.machine_id));
}

export function listMachineProjectAssignments(options: MachineProjectAssignmentsOptions = {}): MachineProjectAssignments {
  const manifest = options.manifest ?? readManifest();
  const localMachineId = process.env["HASNA_MACHINES_MACHINE_ID"]?.trim() || null;
  const requestedMachine = options.machineId ? findManifestMachine(manifest, options.machineId) : null;
  const filterMachineId = requestedMachine?.id ?? options.machineId;
  const allAssignments = mergeAssignments(manifest.machines.flatMap((machine) => [
    ...collectAssignmentMapEntries(machine, localMachineId),
    ...collectPathMapEntries(machine, localMachineId),
  ]));
  const assignments = allAssignments.filter((assignment) => {
    if (filterMachineId && assignment.machine_id !== filterMachineId) return false;
    if (options.projectId && assignment.project_id !== options.projectId && assignment.workspace_id !== options.projectId) return false;
    return true;
  });
  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: {
      name: MACHINES_PACKAGE_NAME,
      version: getPackageVersion(),
    },
    generated_at: (options.now ?? new Date()).toISOString(),
    filters: {
      machine_id: filterMachineId ?? null,
      project_id: options.projectId ?? null,
    },
    assignments,
    projects: projectSummaries(assignments),
    machines: machineSummaries(assignments),
    warnings: [],
  };
}

function assignmentMapFromMetadata(metadata: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const map: Record<string, Record<string, unknown>> = {};
  for (const key of ASSIGNMENT_MAP_KEYS) {
    const container = metadata[key];
    if (Array.isArray(container)) {
      for (const value of container) {
        if (!isRecord(value)) continue;
        const projectId = metadataString(value, ["project_id", "projectId", "id", "slug", "workspace_id", "workspaceId"]);
        if (projectId) map[projectId] = { ...value };
      }
    } else if (isRecord(container)) {
      for (const [projectId, value] of Object.entries(container)) {
        map[projectId] = isRecord(value) ? { ...value } : { path: value };
      }
    }
  }
  return map;
}

function objectMap(metadata: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = metadata[key];
  return isRecord(current) ? { ...current } : {};
}

function removeProjectFromMaps(metadata: Record<string, unknown>, projectId: string): void {
  for (const key of [...ASSIGNMENT_MAP_KEYS, ...PATH_MAP_KEYS, ...OPEN_FILES_MAP_KEYS]) {
    const current = metadata[key];
    if (Array.isArray(current)) {
      metadata[key] = current.filter((value) => {
        if (!isRecord(value)) return true;
        const entryProjectId = metadataString(value, ["project_id", "projectId", "id", "slug", "workspace_id", "workspaceId"]);
        return entryProjectId !== projectId;
      });
      continue;
    }
    if (!isRecord(current)) continue;
    const next = { ...current };
    delete next[projectId];
    metadata[key] = next;
  }
  for (const key of PRIMARY_PROJECTS_KEYS) {
    const current = metadata[key];
    if (Array.isArray(current)) metadata[key] = current.filter((value) => value !== projectId);
  }
}

function updateManifestMachine(manifest: FleetManifest, machineId: string, updater: (machine: MachineManifest) => MachineManifest): FleetManifest {
  const target = findManifestMachine(manifest, machineId);
  let found = false;
  const machines = manifest.machines.map((machine) => {
    if (!target || machine.id !== target.id) return machine;
    found = true;
    return updater(machine);
  });
  if (!found) throw new Error(`Machine not found in manifest: ${machineId}`);
  return { ...manifest, machines };
}

export function projectAssignmentResourceId(machineId: string, projectId: string): string {
  return `project-assignment:${machineId}:${projectId}`;
}

export function projectAssignmentMutationArgs(input: AssignMachineProjectInput): Record<string, unknown> {
  return {
    machine_id: input.machineId,
    project_id: input.projectId,
    path: input.path,
    workspace_id: input.workspaceId ?? null,
    repo_name: input.repoName ?? null,
    workspace_root: input.workspaceRoot ?? null,
    open_files_root: input.openFilesRoot ?? null,
    label: input.label ?? "main",
    kind: input.kind ?? "local",
    primary: input.primary ?? null,
    metadata: input.metadata ?? null,
  };
}

export function removeProjectAssignmentMutationArgs(input: RemoveMachineProjectAssignmentInput): Record<string, unknown> {
  return {
    machine_id: input.machineId,
    project_id: input.projectId,
  };
}

export function assignMachineProject(input: AssignMachineProjectInput): MachineProjectAssignments {
  if (!input.machineId.trim()) throw new Error("machineId is required.");
  if (!input.projectId.trim()) throw new Error("projectId is required.");
  if (!input.path.trim()) throw new Error("path is required.");

  const now = new Date().toISOString();
  const manifest = readManifest();
  const nextManifest = updateManifestMachine(manifest, input.machineId, (machine) => {
    const metadata = isRecord(machine.metadata) ? { ...machine.metadata } : {};
    const assignments = assignmentMapFromMetadata(metadata);
    const existing = assignments[input.projectId];
    assignments[input.projectId] = {
      ...existing,
      project_id: input.projectId,
      workspace_id: input.workspaceId ?? metadataString(existing ?? {}, ["workspace_id", "workspaceId"]) ?? null,
      repo_name: input.repoName ?? metadataString(existing ?? {}, ["repo_name", "repoName"]) ?? input.projectId,
      path: input.path,
      workspace_root: input.workspaceRoot ?? metadataString(existing ?? {}, ["workspace_root", "workspaceRoot"]) ?? machine.workspacePath ?? null,
      open_files_root: input.openFilesRoot ?? metadataString(existing ?? {}, ["open_files_root", "openFilesRoot"]) ?? null,
      label: input.label ?? metadataString(existing ?? {}, ["label"]) ?? "main",
      kind: input.kind ?? metadataString(existing ?? {}, ["kind"]) ?? "local",
      is_primary: input.primary ?? metadataBoolean(existing ?? {}, ["is_primary", "isPrimary", "primary"]) ?? false,
      metadata: input.metadata ?? metadataObject(existing ?? {}, ["metadata"]) ?? {},
      created_at: metadataString(existing ?? {}, ["created_at", "createdAt"]) ?? now,
      updated_at: now,
    };
    metadata.project_assignments = assignments;

    const workspacePaths = objectMap(metadata, "workspace_paths");
    workspacePaths[input.projectId] = input.path;
    metadata.workspace_paths = workspacePaths;

    if (input.openFilesRoot) {
      const openFilesRoots = objectMap(metadata, "open_files_roots");
      openFilesRoots[input.projectId] = input.openFilesRoot;
      metadata.open_files_roots = openFilesRoots;
    }

    if (input.primary === true) {
      const primaryProjects = new Set(metadataStringArray(metadata, PRIMARY_PROJECTS_KEYS));
      primaryProjects.add(input.projectId);
      metadata.primary_projects = [...primaryProjects].sort();
    } else if (input.primary === false) {
      metadata.primary_projects = metadataStringArray(metadata, PRIMARY_PROJECTS_KEYS).filter((projectId) => projectId !== input.projectId);
    }

    return { ...machine, updatedAt: now, metadata };
  });
  writeManifest(nextManifest);
  return listMachineProjectAssignments({ machineId: input.machineId, projectId: input.projectId });
}

export function removeMachineProjectAssignment(input: RemoveMachineProjectAssignmentInput): MachineProjectAssignments {
  if (!input.machineId.trim()) throw new Error("machineId is required.");
  if (!input.projectId.trim()) throw new Error("projectId is required.");
  const now = new Date().toISOString();
  const manifest = readManifest();
  const nextManifest = updateManifestMachine(manifest, input.machineId, (machine) => {
    const metadata = isRecord(machine.metadata) ? { ...machine.metadata } : {};
    removeProjectFromMaps(metadata, input.projectId);
    return { ...machine, updatedAt: now, metadata };
  });
  writeManifest(nextManifest);
  return listMachineProjectAssignments({ machineId: input.machineId, projectId: input.projectId });
}
