import { getManifestPath } from "../paths.js";
import { findManifestMachine, readManifest, writeManifest } from "../manifests.js";
import { resolveMachineWorkspace, type MachineWorkspaceResolution } from "../topology.js";
import type { FleetManifest, MachineManifest } from "../types.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return isRecord(metadata) ? { ...metadata } : {};
}

function mappedPath(metadata: Record<string, unknown>, field: "workspace_paths" | "open_files_roots", key: string): string | null {
  const container = metadata[field];
  if (!isRecord(container)) return null;
  const value = container[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isRecord(value)) {
    const nested = value["path"] ?? value["root"] ?? value["workspacePath"] ?? value["workspace_path"];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return null;
}

function writeMappedPath(metadata: Record<string, unknown>, field: "workspace_paths" | "open_files_roots", key: string, path: string): void {
  const existing = metadata[field];
  const container = isRecord(existing) ? { ...existing } : {};
  container[key] = path;
  metadata[field] = container;
}

function buildPatch(input: {
  metadata: Record<string, unknown>;
  field: "workspace_paths" | "open_files_roots";
  key: string;
  path: string | null;
  apply: boolean;
}): WorkspaceManifestRepairPatch {
  const previous = mappedPath(input.metadata, input.field, input.key);
  if (!input.path) {
    return {
      field: input.field,
      key: input.key,
      path: null,
      previous_path: previous,
      status: "unresolved",
    };
  }
  const status: WorkspaceManifestRepairStatus = previous === input.path
    ? "unchanged"
    : input.apply
      ? "written"
      : "would_write";
  return {
    field: input.field,
    key: input.key,
    path: input.path,
    previous_path: previous,
    status,
  };
}

function upsertMachineMetadata(manifest: FleetManifest, machineId: string, metadata: Record<string, unknown>): FleetManifest {
  return {
    ...manifest,
    machines: manifest.machines.map((machine): MachineManifest => (
      machine.id === machineId ? { ...machine, metadata } : machine
    )),
  };
}

export function repairWorkspaceManifestMappings(options: WorkspaceManifestRepairOptions): WorkspaceManifestRepairResult {
  const projectId = options.projectId;
  const repoName = options.repoName ?? projectId;
  const openFilesRepoName = options.openFilesRepoName ?? "open-files";
  const apply = options.apply === true;
  const resolution = resolveMachineWorkspace({
    machineId: options.machineId,
    projectId,
    repoName,
    openFilesRepoName,
    projectRoot: options.projectRoot,
    openFilesRoot: options.openFilesRoot,
    workspaceRoot: options.workspaceRoot,
    includeTailscale: options.includeTailscale,
    now: options.now,
  });
  const warnings = [...resolution.warnings];
  const manifest = readManifest();
  const manifestMachineId = resolution.machine_id ?? options.machineId;
  const machine = findManifestMachine(manifest, manifestMachineId);
  const trusted = resolution.machine.trust_status === "trusted" || options.allowUntrusted === true;

  if (!machine) {
    warnings.push(`manifest_machine_missing:${manifestMachineId}`);
    return {
      ok: false,
      applied: false,
      manifest_path: getManifestPath(),
      machine_id: resolution.machine_id,
      project_id: projectId,
      repo_name: repoName,
      open_files_repo_name: openFilesRepoName,
      trusted,
      resolution,
      patches: [],
      warnings,
    };
  }

  const metadata = cloneMetadata(machine.metadata);
  const patches = [
    buildPatch({
      metadata,
      field: "workspace_paths",
      key: projectId,
      path: options.projectRoot ?? resolution.paths.project_root.path,
      apply,
    }),
    buildPatch({
      metadata,
      field: "open_files_roots",
      key: projectId,
      path: options.openFilesRoot ?? resolution.paths.open_files_root.path,
      apply,
    }),
  ];
  const hasUnresolved = patches.some((patch) => patch.status === "unresolved");
  const hasWrites = patches.some((patch) => patch.status === "would_write" || patch.status === "written");

  if (apply && hasWrites && !trusted) {
    warnings.push(`manifest_repair_requires_trusted_machine:${manifestMachineId}`);
    return {
      ok: false,
      applied: false,
      manifest_path: getManifestPath(),
      machine_id: manifestMachineId,
      project_id: projectId,
      repo_name: repoName,
      open_files_repo_name: openFilesRepoName,
      trusted,
      resolution,
      patches: patches.map((patch) => patch.status === "written" ? { ...patch, status: "would_write" } : patch),
      warnings,
    };
  }

  let applied = false;
  if (apply && !hasUnresolved && hasWrites) {
    for (const patch of patches) {
      if (patch.path && patch.status === "written") writeMappedPath(metadata, patch.field, patch.key, patch.path);
    }
    writeManifest(upsertMachineMetadata(manifest, manifestMachineId, metadata));
    applied = true;
  }

  return {
    ok: resolution.ok && !hasUnresolved && (!apply || applied || !hasWrites),
    applied,
    manifest_path: getManifestPath(),
    machine_id: manifestMachineId,
    project_id: projectId,
    repo_name: repoName,
    open_files_repo_name: openFilesRepoName,
    trusted,
    resolution,
    patches,
    warnings,
  };
}
