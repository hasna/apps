import type {
  JsonObject,
  ProjectResourceLinkMigrationEvent,
  ProjectResourceLinkMigrationManifestRow,
  ProjectResourceLinkMigrationManifestV1,
  ProjectResourceLinkMigrationPlanRequest,
  ProjectResourceLinkMigrationState,
  ProjectResourceLinkProducerEvidence,
  ProjectResourceLinkProjectsReferenceProof,
  Workspace,
  WorkspaceKind,
} from "../types/workspace.js";
import { canonicalJson, sha256 } from "./guarded-project-mutation.js";
import { deriveProjectChannel } from "./project-channel.js";
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

export type ProjectResourceLinkProducerAttestationPhase =
  | "readback"
  | "inverse_complete"
  | "inverse_retained_target";

export interface ProjectResourceLinkProducerAttestation {
  attestation_id: string;
  manifest_id: string;
  phase: ProjectResourceLinkProducerAttestationPhase;
  evidence_digest: string;
  verifier: string;
  verified_at: string;
}

export interface ProjectResourceLinkProducerProjectSubject {
  id: string;
  slug: string;
  name: string;
  kind: WorkspaceKind;
  conversations_channel: string;
}

export function projectResourceLinkProducerProjectSubject(
  project: Pick<Workspace, "id" | "slug" | "name" | "kind" | "integrations">,
): ProjectResourceLinkProducerProjectSubject {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    kind: project.kind,
    conversations_channel: deriveProjectChannel(project).channel,
  };
}

export interface ProjectResourceLinkProducerVerificationInput {
  manifest: ProjectResourceLinkMigrationManifestV1;
  trusted_project: ProjectResourceLinkProducerProjectSubject;
  phase: ProjectResourceLinkProducerAttestationPhase;
  producer_evidence: ProjectResourceLinkProducerEvidence[];
  transition_evidence: JsonObject;
  response_byte_limit: number;
  time_budget_ms: number;
}

/**
 * Trusted, out-of-band producer verifier. Implementations must look up the
 * named producer receipts and perform exact target readback; request JSON must
 * never supply or select this function. Its returned attestation is validated
 * here and persisted in the immutable migration transition event.
 */
export type ProjectResourceLinkProducerEvidenceVerifier = (
  input: ProjectResourceLinkProducerVerificationInput,
) => ProjectResourceLinkProducerAttestation;

export type AsyncProjectResourceLinkProducerEvidenceVerifier = (
  input: ProjectResourceLinkProducerVerificationInput,
) => ProjectResourceLinkProducerAttestation | Promise<ProjectResourceLinkProducerAttestation>;

export function projectResourceLinkProducerEvidenceDigest(
  manifest: ProjectResourceLinkMigrationManifestV1,
  phase: ProjectResourceLinkProducerAttestationPhase,
  producerEvidence: ProjectResourceLinkProducerEvidence[],
): string {
  return sha256(canonicalJson({
    manifest_id: manifest.manifest_id,
    phase,
    producer_context: manifest.links.map((item) => ({
      link_id: item.link_id,
      producer_resource_kind: item.producer_resource_kind,
      producer_binding: item.producer_binding,
    })),
    producer_evidence: producerEvidence,
  }));
}

export function projectResourceLinkProducerAttestationId(
  manifestId: string,
  phase: ProjectResourceLinkProducerAttestationPhase,
  evidenceDigest: string,
): string {
  return `prlpa_${sha256(canonicalJson({
    manifest_id: manifestId,
    phase,
    evidence_digest: evidenceDigest,
  })).slice(0, 36)}`;
}

export function assertProjectResourceLinkProducerAttestation(
  manifest: ProjectResourceLinkMigrationManifestV1,
  phase: ProjectResourceLinkProducerAttestationPhase,
  producerEvidence: ProjectResourceLinkProducerEvidence[],
  attestation: ProjectResourceLinkProducerAttestation | undefined,
): ProjectResourceLinkProducerAttestation {
  if (!attestation) {
    throw new Error(
      `project resource link migration ${phase} requires trusted producer receipt/readback attestation`,
    );
  }
  const evidenceDigest = projectResourceLinkProducerEvidenceDigest(
    manifest,
    phase,
    producerEvidence,
  );
  const attestationId = projectResourceLinkProducerAttestationId(
    manifest.manifest_id,
    phase,
    evidenceDigest,
  );
  if (
    attestation.attestation_id !== attestationId
    || attestation.manifest_id !== manifest.manifest_id
    || attestation.phase !== phase
    || attestation.evidence_digest !== evidenceDigest
  ) {
    throw new Error("producer attestation does not bind the exact manifest, phase, and producer evidence");
  }
  requireNonemptyProofValue(attestation.verifier, "producer attestation verifier");
  requireNonemptyProofValue(attestation.verified_at, "producer attestation verified_at");
  if (!Number.isFinite(Date.parse(attestation.verified_at))) {
    throw new Error("producer attestation verified_at must be an ISO-8601 timestamp");
  }
  return { ...attestation };
}

export function migrationEvidenceWithProducerAttestation(
  evidence: JsonObject,
  attestation: ProjectResourceLinkProducerAttestation,
): JsonObject {
  return {
    ...evidence,
    producer_attestation: { ...attestation },
  };
}

function requireNonemptyProofValue(value: string | null, label: string): string {
  if (!value?.trim()) throw new Error(`${label} must be a nonempty producer proof value`);
  return value;
}

function assertProducerBinding(
  item: ProjectResourceLinkMigrationManifestV1["links"][number],
): void {
  if (item.producer_binding.authority_id !== item.link.authority) {
    throw new Error("producer binding authority_id must match the resource-link authority");
  }
  requireNonemptyProofValue(item.producer_resource_kind, "producer resource_kind");
  requireNonemptyProofValue(item.producer_binding.tenant_id, "producer binding tenant_id");
  requireNonemptyProofValue(item.producer_binding.capability_digest, "producer binding capability_digest");
}

function assertUniqueReceiptIds(receiptIds: string[], label: string): void {
  for (const receiptId of receiptIds) requireNonemptyProofValue(receiptId, label);
  if (new Set(receiptIds).size !== receiptIds.length) {
    throw new Error(`${label} must not contain duplicate producer receipts`);
  }
}

export function reconcileProjectResourceLinkProducerProof(
  manifest: ProjectResourceLinkMigrationManifestV1,
  evidence: ProjectResourceLinkProducerEvidence[] | undefined,
  phase: "forward" | "readback" | "inverse",
  terminalOutcome?: "complete" | "retained_target",
): ProjectResourceLinkProducerEvidence[] {
  if (!evidence || evidence.length !== manifest.links.length) {
    const label = phase === "inverse" ? "producer inverse proof" : `producer ${phase} proof`;
    throw new Error(`${label} requires exact evidence for every manifest link`);
  }
  let retainedTargetCount = 0;
  const reconciled = evidence.map((candidate, index) => {
    const item = manifest.links[index]!;
    const persisted = item.producer_evidence;
    assertProducerBinding(item);
    requireNonemptyProofValue(candidate.forward_receipt_id, "producer forward receipt");
    requireNonemptyProofValue(candidate.target_revision, "producer target revision");
    requireNonemptyProofValue(candidate.target_digest, "producer target digest");
    assertUniqueReceiptIds(candidate.child_link_receipt_ids, "producer child-link receipt");
    if (phase !== "forward") {
      if (!persisted) throw new Error(`producer ${phase} proof has no persisted forward proof`);
      if (
        candidate.created_by_operation !== persisted.created_by_operation
        || candidate.forward_receipt_id !== persisted.forward_receipt_id
        || canonicalJson(candidate.child_link_receipt_ids) !== canonicalJson(persisted.child_link_receipt_ids)
      ) {
        throw new Error(`producer ${phase} proof does not match the persisted producer receipt identity`);
      }
    }
    if (phase === "forward" || phase === "readback") {
      if (candidate.inverse_verified !== null || candidate.inverse_outcome !== null) {
        throw new Error(`producer ${phase} proof must not claim an inverse outcome`);
      }
    } else {
      if (candidate.inverse_verified !== true) {
        throw new Error("producer inverse proof requires inverse_verified=true for every manifest link");
      }
      const inverseOutcome = requireNonemptyProofValue(
        candidate.inverse_outcome,
        "producer inverse outcome",
      );
      if (terminalOutcome === "complete" && candidate.created_by_operation && inverseOutcome !== "complete") {
        throw new Error("producer inverse proof for a created target must record inverse_outcome=complete");
      }
      if (terminalOutcome === "retained_target" && inverseOutcome === "retained_target") {
        retainedTargetCount += 1;
      }
    }
    return { ...candidate };
  });
  if (
    phase === "inverse"
    && terminalOutcome === "retained_target"
    && retainedTargetCount === 0
  ) {
    throw new Error("producer inverse proof for retained_target must record a retained_target outcome");
  }
  return reconciled;
}

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
  for (const item of items) assertProducerBinding(item);
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
