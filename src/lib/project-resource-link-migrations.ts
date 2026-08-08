import type {
  JsonObject,
  ProjectResourceLinkMigrationEvent,
  ProjectResourceLinkMigrationManifestRow,
  ProjectResourceLinkMigrationManifestV1,
  ProjectResourceLinkMigrationPlanRequest,
  ProjectResourceLinkMigrationState,
  ProjectResourceLinkProducerEvidence,
  ProjectResourceLinkProjectsReferenceProof,
} from "../types/workspace.js";
import { canonicalJson, sha256 } from "./guarded-project-mutation.js";
import {
  normalizeProjectResourceLinks,
  projectResourceLinkId,
  projectResourceLinksDigest,
} from "./project-resource-links.js";

const TRANSITIONS: Record<ProjectResourceLinkMigrationState, readonly ProjectResourceLinkMigrationState[]> = {
  planned: ["producer_applied", "rollback_in_progress", "rolled_back", "failed_reconcilable"],
  producer_applied: ["projects_applied", "rollback_in_progress", "rolled_back", "retained_target", "failed_reconcilable"],
  projects_applied: ["verified", "rollback_in_progress", "failed_reconcilable"],
  verified: ["rollback_in_progress", "failed_reconcilable"],
  rollback_in_progress: ["rolled_back", "retained_target", "failed_reconcilable"],
  rolled_back: [],
  retained_target: [],
  failed_reconcilable: ["rollback_in_progress"],
};

export function projectResourceLinkMigrationManifestId(
  projectId: string,
  operationId: string,
  stepId: string,
  desiredCollectionDigest: string,
): string {
  return `prlm_${sha256(canonicalJson({
    project_id: projectId,
    operation_id: operationId,
    step_id: stepId,
    desired_collection_digest: desiredCollectionDigest,
  })).slice(0, 36)}`;
}

export function projectResourceLinkMigrationEventId(
  manifestId: string,
  transitionVersion: number,
  toState: ProjectResourceLinkMigrationState,
): string {
  return `prlme_${sha256(canonicalJson({
    manifest_id: manifestId,
    transition_version: transitionVersion,
    to_state: toState,
  })).slice(0, 36)}`;
}

export function buildProjectResourceLinkMigrationPlan(
  input: ProjectResourceLinkMigrationPlanRequest,
  createdAt: string,
): ProjectResourceLinkMigrationManifestV1 {
  const normalizedInInputOrder = input.links.map((item) => normalizeProjectResourceLinks([item.link])[0]!);
  const normalized = normalizeProjectResourceLinks(normalizedInInputOrder);
  if (normalized.length !== input.links.length) {
    throw new Error("project resource link migration plan lost link cardinality");
  }
  const items = input.links.map((item, index) => {
    const link = normalizedInInputOrder[index];
    if (!link) throw new Error("project resource link migration plan contains an ambiguous normalized identity");
    return {
      ...item,
      link,
      link_id: projectResourceLinkId(input.project_id, link),
      producer_evidence: null,
    };
  });
  const desiredCollectionDigest = projectResourceLinksDigest(items.map((item) => ({
    ...item.link,
    id: item.link_id,
    project_id: input.project_id,
    labels: item.link.labels ?? {},
    created_at: createdAt,
    updated_at: createdAt,
  })));
  return {
    schema: "projects.project_resource_link_migration_manifest.v1",
    manifest_id: projectResourceLinkMigrationManifestId(
      input.project_id,
      input.operation_id,
      input.step_id,
      desiredCollectionDigest,
    ),
    project_id: input.project_id,
    operation_id: input.operation_id,
    step_id: input.step_id,
    state: "planned",
    expected_project_revision: input.expected_project_revision,
    desired_collection_digest: desiredCollectionDigest,
    links: items,
    projects_forward_receipt_id: null,
    projects_inverse_receipt_id: null,
    projects_reference_proof: null,
    last_verified_projects_revision: null,
    last_verified_projects_digest: null,
    transition_version: 1,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export function assertProjectResourceLinkMigrationTransition(
  from: ProjectResourceLinkMigrationState,
  to: ProjectResourceLinkMigrationState,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`project resource link migration transition ${from} -> ${to} is not allowed`);
  }
}

export function applyProjectResourceLinkMigrationTransition(
  manifest: ProjectResourceLinkMigrationManifestV1,
  toState: ProjectResourceLinkMigrationState,
  updatedAt: string,
  updates: {
    producer_evidence?: ProjectResourceLinkProducerEvidence[];
    projects_forward_receipt_id?: string | null;
    projects_inverse_receipt_id?: string | null;
    projects_reference_proof?: ProjectResourceLinkProjectsReferenceProof | null;
    last_verified_projects_revision?: string | null;
    last_verified_projects_digest?: string | null;
  } = {},
): ProjectResourceLinkMigrationManifestV1 {
  assertProjectResourceLinkMigrationTransition(manifest.state, toState);
  if (updates.producer_evidence && updates.producer_evidence.length !== manifest.links.length) {
    throw new Error("producer evidence cardinality must equal manifest links cardinality");
  }
  return {
    ...manifest,
    state: toState,
    links: updates.producer_evidence
      ? manifest.links.map((item, index) => ({
          ...item,
          producer_evidence: updates.producer_evidence![index]!,
        }))
      : manifest.links,
    projects_forward_receipt_id:
      updates.projects_forward_receipt_id === undefined
        ? manifest.projects_forward_receipt_id
        : updates.projects_forward_receipt_id,
    projects_inverse_receipt_id:
      updates.projects_inverse_receipt_id === undefined
        ? manifest.projects_inverse_receipt_id
        : updates.projects_inverse_receipt_id,
    projects_reference_proof:
      updates.projects_reference_proof === undefined
        ? manifest.projects_reference_proof
        : updates.projects_reference_proof,
    last_verified_projects_revision:
      updates.last_verified_projects_revision === undefined
        ? manifest.last_verified_projects_revision
        : updates.last_verified_projects_revision,
    last_verified_projects_digest:
      updates.last_verified_projects_digest === undefined
        ? manifest.last_verified_projects_digest
        : updates.last_verified_projects_digest,
    transition_version: manifest.transition_version + 1,
    updated_at: updatedAt,
  };
}

export function rowToProjectResourceLinkMigrationManifest(
  row: ProjectResourceLinkMigrationManifestRow,
): ProjectResourceLinkMigrationManifestV1 {
  return {
    schema: "projects.project_resource_link_migration_manifest.v1",
    manifest_id: row.manifest_id,
    project_id: row.project_id,
    operation_id: row.operation_id,
    step_id: row.step_id,
    state: row.state as ProjectResourceLinkMigrationState,
    expected_project_revision: row.expected_project_revision,
    desired_collection_digest: row.desired_collection_digest,
    links: JSON.parse(row.links_json) as ProjectResourceLinkMigrationManifestV1["links"],
    projects_forward_receipt_id: row.projects_forward_receipt_id,
    projects_inverse_receipt_id: row.projects_inverse_receipt_id,
    projects_reference_proof: row.projects_reference_proof_json
      ? JSON.parse(row.projects_reference_proof_json) as ProjectResourceLinkProjectsReferenceProof
      : null,
    last_verified_projects_revision: row.last_verified_projects_revision,
    last_verified_projects_digest: row.last_verified_projects_digest,
    transition_version: Number(row.transition_version),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function migrationEvent(
  manifestId: string,
  transitionVersion: number,
  fromState: ProjectResourceLinkMigrationState | null,
  toState: ProjectResourceLinkMigrationState,
  requestDigest: string,
  preconditionDigest: string,
  evidence: JsonObject,
  createdAt: string,
): ProjectResourceLinkMigrationEvent {
  return {
    event_id: projectResourceLinkMigrationEventId(manifestId, transitionVersion, toState),
    manifest_id: manifestId,
    transition_version: transitionVersion,
    from_state: fromState,
    to_state: toState,
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    evidence,
    created_at: createdAt,
  };
}
