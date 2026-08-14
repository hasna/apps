import {
  canonicalJson,
  sha256,
  workspaceSnapshot,
} from "./guarded-project-mutation.js";
import { projectResourceLinksDigest } from "./project-resource-links.js";
import type {
  JsonObject,
  ProjectQuarantineRequest,
  ProjectQuarantineSnapshot,
  ProjectResourceLink,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceLocation,
} from "../types/workspace.js";

export const PROJECT_QUARANTINE_ROUTE = "projects.duplicate-quarantine.v1";
export const PROJECT_QUARANTINE_EVENT = "duplicate_project_quarantined";
export const PROJECT_QUARANTINE_ROLLBACK_EVENT = "duplicate_project_quarantine_rolled_back";
export const PROJECT_QUARANTINE_METADATA_KEY = "projects_duplicate_quarantine";

export function workspaceLocationsDigest(locations: readonly WorkspaceLocation[]): string {
  return sha256(canonicalJson([...locations].sort((a, b) => a.id.localeCompare(b.id))));
}

export function projectDigest(project: Workspace, locations: readonly WorkspaceLocation[] = []): string {
  return sha256(canonicalJson({
    project: workspaceSnapshot(project),
    workspace_locations: [...locations].sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

export function projectQuarantineSnapshot(
  project: Workspace,
  resourceLinks: ProjectResourceLink[],
  workspaceLocations: WorkspaceLocation[],
): ProjectQuarantineSnapshot {
  return {
    project,
    project_digest: projectDigest(project, workspaceLocations),
    resource_links: resourceLinks,
    resource_link_collection_digest: projectResourceLinksDigest(resourceLinks),
    workspace_locations: workspaceLocations,
    workspace_location_collection_digest: workspaceLocationsDigest(workspaceLocations),
  };
}

export function projectQuarantineSnapshotJson(snapshot: ProjectQuarantineSnapshot): JsonObject {
  return snapshot as unknown as JsonObject;
}

export function parseProjectQuarantineSnapshot(
  value: JsonObject | null,
  label: string,
): ProjectQuarantineSnapshot {
  const snapshot = value as unknown as ProjectQuarantineSnapshot | null;
  if (
    !snapshot?.project?.id
    || !Array.isArray(snapshot.resource_links)
    || !Array.isArray(snapshot.workspace_locations)
    || typeof snapshot.project_digest !== "string"
    || typeof snapshot.resource_link_collection_digest !== "string"
    || typeof snapshot.workspace_location_collection_digest !== "string"
  ) {
    throw new Error(`${label} quarantine receipt snapshot is incomplete`);
  }
  if (projectDigest(snapshot.project, snapshot.workspace_locations) !== snapshot.project_digest) {
    throw new Error(`${label} quarantine receipt project digest mismatch`);
  }
  if (projectResourceLinksDigest(snapshot.resource_links) !== snapshot.resource_link_collection_digest) {
    throw new Error(`${label} quarantine receipt resource-link digest mismatch`);
  }
  if (workspaceLocationsDigest(snapshot.workspace_locations) !== snapshot.workspace_location_collection_digest) {
    throw new Error(`${label} quarantine receipt workspace-location digest mismatch`);
  }
  return snapshot;
}

export function normalizedExpectedResourceLinkIds(input: ProjectQuarantineRequest): string[] {
  const ids = input.expected_resource_link_ids.map((value) => value.trim()).sort();
  if (ids.some((value) => !value)) {
    throw new Error("project quarantine expected_resource_link_ids must be non-empty strings");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("project quarantine expected_resource_link_ids must be unique");
  }
  if (ids.length > input.resource_link_max_items) {
    throw new Error("project quarantine expected link set exceeds resource_link_max_items");
  }
  return ids;
}

export function normalizedExpectedWorkspaceLocationIds(input: ProjectQuarantineRequest): string[] {
  const ids = input.expected_workspace_location_ids.map((value) => value.trim()).sort();
  if (ids.some((value) => !value)) {
    throw new Error("project quarantine expected_workspace_location_ids must be non-empty strings");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("project quarantine expected_workspace_location_ids must be unique");
  }
  if (ids.length > input.workspace_location_max_items) {
    throw new Error("project quarantine expected workspace-location set exceeds workspace_location_max_items");
  }
  return ids;
}

export function projectQuarantineRequestDigest(input: ProjectQuarantineRequest): string {
  return sha256(canonicalJson({
    route: PROJECT_QUARANTINE_ROUTE,
    quarantine_name: input.quarantine_name.trim(),
    quarantine_slug: input.quarantine_slug.trim(),
  }));
}

export function projectQuarantinePreconditionDigest(
  input: ProjectQuarantineRequest,
  expectedIds = normalizedExpectedResourceLinkIds(input),
  expectedLocationIds = normalizedExpectedWorkspaceLocationIds(input),
): string {
  return sha256(canonicalJson({
    route: PROJECT_QUARANTINE_ROUTE,
    project_id: input.project_id,
    expected_revision: input.expected_revision,
    expected_project_digest: input.expected_project_digest,
    expected_resource_link_collection_digest: input.expected_resource_link_collection_digest,
    expected_resource_link_ids: expectedIds,
    resource_link_max_items: input.resource_link_max_items,
    expected_workspace_location_collection_digest: input.expected_workspace_location_collection_digest,
    expected_workspace_location_ids: expectedLocationIds,
    workspace_location_max_items: input.workspace_location_max_items,
  }));
}

export function projectQuarantinePatch(
  input: ProjectQuarantineRequest,
  before: ProjectQuarantineSnapshot,
): UpdateWorkspaceInput {
  const quarantineName = input.quarantine_name.trim();
  const quarantineSlug = input.quarantine_slug.trim();
  if (!quarantineName) throw new Error("project quarantine requires a non-empty quarantine_name");
  if (!quarantineSlug) throw new Error("project quarantine requires a non-empty quarantine_slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(quarantineSlug)) {
    throw new Error("project quarantine requires an already-canonical quarantine_slug");
  }
  return {
    name: quarantineName,
    slug: quarantineSlug,
    status: "archived",
    root_id: null,
    recipe_id: null,
    canonical_machine: null,
    primary_path: null,
    git_remote: null,
    s3_bucket: null,
    s3_prefix: null,
    integrations: {},
    tags: [...new Set([...before.project.tags, "duplicate-quarantine", "provenance-only"])].sort(),
    metadata: {
      ...before.project.metadata,
      [PROJECT_QUARANTINE_METADATA_KEY]: {
        schema: "hasna.projects.duplicate-quarantine.v1",
        operation_id: input.operation_id,
        step_id: input.step_id,
        original_project_digest: before.project_digest,
        original_resource_link_collection_digest: before.resource_link_collection_digest,
        original_resource_link_ids: before.resource_links.map((link) => link.id).sort(),
        original_workspace_location_collection_digest: before.workspace_location_collection_digest,
        original_workspace_location_ids: before.workspace_locations.map((location) => location.id).sort(),
      },
    },
    last_opened_at: null,
  };
}

export function assertProjectQuarantinePreconditions(
  input: ProjectQuarantineRequest,
  before: ProjectQuarantineSnapshot,
): string | null {
  const expectedIds = normalizedExpectedResourceLinkIds(input);
  const expectedLocationIds = normalizedExpectedWorkspaceLocationIds(input);
  const actualIds = before.resource_links.map((link) => link.id).sort();
  const actualLocationIds = before.workspace_locations.map((location) => location.id).sort();
  if (before.project.updated_at !== input.expected_revision) return "stale_revision";
  if (before.project_digest !== input.expected_project_digest) return "project_digest_mismatch";
  if (canonicalJson(actualIds) !== canonicalJson(expectedIds)) return "resource_link_target_set_mismatch";
  if (before.resource_link_collection_digest !== input.expected_resource_link_collection_digest) {
    return "resource_link_collection_digest_mismatch";
  }
  if (canonicalJson(actualLocationIds) !== canonicalJson(expectedLocationIds)) {
    return "workspace_location_target_set_mismatch";
  }
  if (before.workspace_location_collection_digest !== input.expected_workspace_location_collection_digest) {
    return "workspace_location_collection_digest_mismatch";
  }
  return null;
}

export function assertProjectQuarantinePostimage(
  input: ProjectQuarantineRequest,
  before: ProjectQuarantineSnapshot,
  after: ProjectQuarantineSnapshot,
): void {
  const marker = after.project.metadata[PROJECT_QUARANTINE_METADATA_KEY] as Record<string, unknown> | undefined;
  if (
    after.project.status !== "archived"
    || after.project.name !== input.quarantine_name.trim()
    || after.project.slug !== input.quarantine_slug.trim()
    || after.project.root_id !== null
    || after.project.recipe_id !== null
    || after.project.canonical_machine !== null
    || after.project.primary_path !== null
    || after.project.git_remote !== null
    || after.project.s3_bucket !== null
    || after.project.s3_prefix !== null
    || Object.keys(after.project.integrations).length !== 0
    || after.resource_links.length !== 0
    || after.workspace_locations.length !== 0
    || marker?.original_project_digest !== before.project_digest
    || marker?.original_resource_link_collection_digest !== before.resource_link_collection_digest
    || canonicalJson(marker?.original_resource_link_ids) !== canonicalJson(before.resource_links.map((link) => link.id).sort())
    || marker?.original_workspace_location_collection_digest !== before.workspace_location_collection_digest
    || canonicalJson(marker?.original_workspace_location_ids) !== canonicalJson(before.workspace_locations.map((location) => location.id).sort())
  ) {
    throw new Error("project quarantine exact post-write readback mismatch");
  }
}

export function restoreProjectPatch(snapshot: ProjectQuarantineSnapshot): UpdateWorkspaceInput {
  const before = snapshot.project;
  return {
    name: before.name,
    slug: before.slug,
    description: before.description,
    kind: before.kind,
    status: before.status,
    root_id: before.root_id,
    recipe_id: before.recipe_id,
    canonical_machine: before.canonical_machine,
    primary_path: before.primary_path,
    git_remote: before.git_remote,
    s3_bucket: before.s3_bucket,
    s3_prefix: before.s3_prefix,
    tags: before.tags,
    integrations: before.integrations,
    metadata: before.metadata,
    last_opened_at: before.last_opened_at,
  };
}
