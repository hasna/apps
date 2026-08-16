import type {
  JsonObject,
  ProjectResourceLinkMigrationItem,
  ProjectResourceLinkMigrationManifestV1,
  ProjectResourceLinkProducerEvidence,
} from "../types/workspace.js";
import { canonicalJson, sha256 } from "./guarded-project-mutation.js";
import {
  projectResourceLinkProducerAttestationId,
  projectResourceLinkProducerEvidenceDigest,
  type AsyncProjectResourceLinkProducerEvidenceVerifier,
  type ProjectResourceLinkProducerAttestation,
  type ProjectResourceLinkProducerAttestationPhase,
  type ProjectResourceLinkProducerVerificationInput,
} from "./project-resource-link-migrations.js";
import {
  deriveProjectRegistrationIdempotencyKey,
  ProjectRegistrationPathHandle,
  type ProjectRegistrationAuthorities,
  type ProjectRegistrationAuthorityAdapter,
  type ProjectRegistrationAuthorityCapability,
  type ProjectRegistrationAuthorityLookupResult,
  type ProjectRegistrationAuthorityName,
  type ProjectRegistrationAuthorityReceipt,
  type ProjectRegistrationResourceKind,
} from "./project-registration.js";
import { productionProjectRegistrationAuthorities } from "./production-project-registration-authorities.js";

export const PROJECT_RESOURCE_LINK_PRODUCER_VERIFICATION_SCHEMA =
  "projects.project_resource_link_producer_verification.v1";
export const PROJECT_RESOURCE_LINK_PRODUCER_VERIFIER =
  "projects.production-producer-authority-readback.v1";

interface ProducerInverseRequestEvidence {
  project_slug: string;
  project_name: string;
  desired: JsonObject;
}

interface ProducerLinkVerificationEvidence {
  link_id: string;
  target_context_digest: string;
  target_selector: string;
  forward_receipt: ProjectRegistrationAuthorityReceipt;
  inverse_receipt?: ProjectRegistrationAuthorityReceipt;
  inverse_request?: ProducerInverseRequestEvidence;
}

interface ProducerVerificationEnvelope {
  schema: typeof PROJECT_RESOURCE_LINK_PRODUCER_VERIFICATION_SCHEMA;
  links: ProducerLinkVerificationEvidence[];
}

interface ProducerRequestBinding {
  target_selector: string;
  idempotency_key: string;
  request_digest: string;
  precondition_digest: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  desired: JsonObject;
}

export interface ProductionProjectResourceLinkProducerVerifierOptions {
  authorities?: Partial<ProjectRegistrationAuthorities>;
  now?: () => string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
}

function nullableStringValue(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function receiptValue(value: unknown, label: string): ProjectRegistrationAuthorityReceipt {
  const receipt = objectValue(value, label);
  const authority = stringValue(receipt.authority, `${label}.authority`);
  const resourceKind = stringValue(receipt.resource_kind, `${label}.resource_kind`);
  const direction = stringValue(receipt.direction, `${label}.direction`);
  const outcome = stringValue(receipt.outcome, `${label}.outcome`);
  if (!["todos", "mementos", "conversations"].includes(authority)) {
    throw new Error(`${label}.authority is not a supported project-registration authority`);
  }
  if (!["project", "task_list", "channel"].includes(resourceKind)) {
    throw new Error(`${label}.resource_kind is unsupported`);
  }
  if (!["forward", "inverse"].includes(direction)) {
    throw new Error(`${label}.direction is unsupported`);
  }
  if (!["accepted", "duplicate_of_accepted", "terminal_nonacceptance"].includes(outcome)) {
    throw new Error(`${label}.outcome is unsupported`);
  }
  return {
    receipt_id: stringValue(receipt.receipt_id, `${label}.receipt_id`),
    authority: authority as ProjectRegistrationAuthorityName,
    route: stringValue(receipt.route, `${label}.route`),
    package_version: stringValue(receipt.package_version, `${label}.package_version`),
    authority_id: stringValue(receipt.authority_id, `${label}.authority_id`),
    tenant_id: stringValue(receipt.tenant_id, `${label}.tenant_id`),
    corpus_id: stringValue(receipt.corpus_id, `${label}.corpus_id`),
    operation_id: stringValue(receipt.operation_id, `${label}.operation_id`),
    step_id: stringValue(receipt.step_id, `${label}.step_id`),
    resource_kind: resourceKind as ProjectRegistrationResourceKind,
    direction: direction as ProjectRegistrationAuthorityReceipt["direction"],
    idempotency_key: stringValue(receipt.idempotency_key, `${label}.idempotency_key`),
    request_digest: stringValue(receipt.request_digest, `${label}.request_digest`),
    precondition_digest: stringValue(receipt.precondition_digest, `${label}.precondition_digest`),
    outcome: outcome as ProjectRegistrationAuthorityReceipt["outcome"],
    reason: nullableStringValue(receipt.reason, `${label}.reason`),
    target_id: nullableStringValue(receipt.target_id, `${label}.target_id`),
    result_revision: nullableStringValue(receipt.result_revision, `${label}.result_revision`),
    result_digest: nullableStringValue(receipt.result_digest, `${label}.result_digest`),
    duplicate_of_receipt_id: nullableStringValue(
      receipt.duplicate_of_receipt_id,
      `${label}.duplicate_of_receipt_id`,
    ),
    accepted_receipt_id: nullableStringValue(
      receipt.accepted_receipt_id,
      `${label}.accepted_receipt_id`,
    ),
    created_by_operation: booleanValue(
      receipt.created_by_operation,
      `${label}.created_by_operation`,
    ),
    created_at: stringValue(receipt.created_at, `${label}.created_at`),
  };
}

function envelopeValue(evidence: JsonObject): ProducerVerificationEnvelope {
  const raw = objectValue(
    evidence.producer_verification,
    "producer verification evidence",
  );
  if (raw.schema !== PROJECT_RESOURCE_LINK_PRODUCER_VERIFICATION_SCHEMA) {
    throw new Error(
      `producer verification evidence schema must be ${PROJECT_RESOURCE_LINK_PRODUCER_VERIFICATION_SCHEMA}`,
    );
  }
  if (!Array.isArray(raw.links)) {
    throw new Error("producer verification evidence links must be an array");
  }
  const links = raw.links.map((value, index) => {
    const link = objectValue(value, `producer verification link ${index}`);
    const inverseRequest = link.inverse_request === undefined
      ? undefined
      : objectValue(link.inverse_request, `producer verification link ${index}.inverse_request`);
    return {
      link_id: stringValue(link.link_id, `producer verification link ${index}.link_id`),
      target_context_digest: stringValue(
        link.target_context_digest,
        `producer verification link ${index}.target_context_digest`,
      ),
      target_selector: stringValue(
        link.target_selector,
        `producer verification link ${index}.target_selector`,
      ),
      forward_receipt: receiptValue(
        link.forward_receipt,
        `producer verification link ${index}.forward_receipt`,
      ),
      ...(link.inverse_receipt === undefined
        ? {}
        : {
            inverse_receipt: receiptValue(
              link.inverse_receipt,
              `producer verification link ${index}.inverse_receipt`,
            ),
          }),
      ...(inverseRequest
        ? {
            inverse_request: {
              project_slug: stringValue(
                inverseRequest.project_slug,
                `producer verification link ${index}.inverse_request.project_slug`,
              ),
              project_name: stringValue(
                inverseRequest.project_name,
                `producer verification link ${index}.inverse_request.project_name`,
              ),
              desired: objectValue(
                inverseRequest.desired,
                `producer verification link ${index}.inverse_request.desired`,
              ),
            },
          }
        : {}),
    };
  });
  if (new Set(links.map((link) => link.link_id)).size !== links.length) {
    throw new Error("producer verification evidence contains duplicate link ids");
  }
  return {
    schema: PROJECT_RESOURCE_LINK_PRODUCER_VERIFICATION_SCHEMA,
    links,
  };
}

function authorityName(
  item: ProjectResourceLinkMigrationItem,
): ProjectRegistrationAuthorityName {
  const authority = item.link.authority;
  if (!["todos", "mementos", "conversations"].includes(authority)) {
    throw new Error(`producer authority ${authority} is not configured for trusted readback`);
  }
  return authority as ProjectRegistrationAuthorityName;
}

function resourceKind(
  item: ProjectResourceLinkMigrationItem,
): ProjectRegistrationResourceKind {
  const targetKind = item.link.target_kind;
  if (!["project", "task_list", "channel"].includes(targetKind)) {
    throw new Error(`producer target kind ${targetKind} is not supported for trusted readback`);
  }
  return targetKind as ProjectRegistrationResourceKind;
}

function expectedTargetId(item: ProjectResourceLinkMigrationItem): string {
  const { kind, value } = item.link.locator;
  if (kind === "canonical_uri") {
    const parts = value.split(/[:/]/).filter(Boolean);
    const targetId = parts.at(-1);
    if (!targetId) throw new Error("producer canonical locator does not contain a target id");
    return targetId;
  }
  if (kind === "external_uuid" || kind.endsWith("_id")) return value;
  throw new Error(`producer locator kind ${kind} is not supported for trusted readback`);
}

function assertCapability(
  item: ProjectResourceLinkMigrationItem,
  capability: ProjectRegistrationAuthorityCapability,
  expectedAuthority: ProjectRegistrationAuthorityName,
  expectedResourceKind: ProjectRegistrationResourceKind,
): void {
  const binding = item.producer_binding;
  if (
    capability.authority !== expectedAuthority
    || capability.authority_id !== binding.authority_id
    || capability.tenant_id !== binding.tenant_id
    || capability.corpus_id !== binding.corpus_id
  ) {
    throw new Error("producer capability does not match the manifest authority, tenant, and corpus binding");
  }
  if (sha256(canonicalJson(capability)) !== binding.capability_digest) {
    throw new Error("producer capability digest does not match the manifest binding");
  }
  if (
    !capability.immutable_receipts
    || !capability.exact_terminal_lookup
    || !capability.exact_readback
    || !capability.supported_resources.includes(expectedResourceKind)
  ) {
    throw new Error("producer capability does not support immutable exact receipt/readback verification");
  }
}

function assertReceiptContext(
  receipt: ProjectRegistrationAuthorityReceipt,
  manifest: ProjectResourceLinkMigrationManifestV1,
  item: ProjectResourceLinkMigrationItem,
  capability: ProjectRegistrationAuthorityCapability,
  expectedDirection: ProjectRegistrationAuthorityReceipt["direction"],
  expectedResourceKind: ProjectRegistrationResourceKind,
): void {
  const binding = item.producer_binding;
  if (
    receipt.authority !== capability.authority
    || receipt.route !== capability.route
    || receipt.package_version !== capability.package_version
    || receipt.authority_id !== binding.authority_id
    || receipt.tenant_id !== binding.tenant_id
    || receipt.corpus_id !== binding.corpus_id
    || receipt.operation_id !== manifest.operation_id
    || receipt.step_id !== manifest.step_id
    || receipt.resource_kind !== expectedResourceKind
    || receipt.direction !== expectedDirection
  ) {
    throw new Error("producer receipt does not bind the manifest operation and authority context");
  }
}

function trustedConversationsForwardRequest(
  manifest: ProjectResourceLinkMigrationManifestV1,
  item: ProjectResourceLinkMigrationItem,
  input: ProjectResourceLinkProducerVerificationInput,
): ProducerRequestBinding {
  const project = input.trusted_project;
  if (manifest.project_id !== project.id) {
    throw new Error("producer manifest does not match the trusted project subject");
  }
  if (item.link.authority !== "conversations" || item.link.target_kind !== "channel") {
    throw new Error(
      `producer request reconstruction is not configured for ${item.link.authority}/${item.link.target_kind}`,
    );
  }
  const targetSelector = project.conversations_channel;
  if (
    item.link.labels?.channel_name !== undefined
    && item.link.labels.channel_name !== targetSelector
  ) {
    throw new Error("producer manifest channel label does not match the trusted project subject");
  }
  const desired = {
    channel: targetSelector,
    project_id: project.id,
    project_slug: project.slug,
    project_kind: project.kind,
  };
  const requestDigest = sha256(canonicalJson(desired));
  const preconditionDigest = sha256(canonicalJson({
    target_selector: targetSelector,
    expected: "absent",
  }));
  return {
    target_selector: targetSelector,
    idempotency_key: deriveProjectRegistrationIdempotencyKey({
      operation_id: manifest.operation_id,
      step_id: manifest.step_id,
      direction: "forward",
      target_selector: targetSelector,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
    }),
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    project_id: project.id,
    project_slug: project.slug,
    project_name: project.name,
    desired,
  };
}

function trustedInverseRequest(
  manifest: ProjectResourceLinkMigrationManifestV1,
  forwardReceipt: ProjectRegistrationAuthorityReceipt,
  input: ProjectResourceLinkProducerVerificationInput,
): ProducerRequestBinding {
  const project = input.trusted_project;
  if (manifest.project_id !== project.id) {
    throw new Error("producer manifest does not match the trusted project subject");
  }
  if (!forwardReceipt.target_id) {
    throw new Error("producer forward receipt does not identify an inverse target");
  }
  const desired = {
    accepted_receipt_id: forwardReceipt.receipt_id,
    target_id: forwardReceipt.target_id,
  };
  const requestDigest = sha256(canonicalJson(desired));
  const preconditionDigest = sha256(canonicalJson({
    target_id: forwardReceipt.target_id,
    expected_revision: forwardReceipt.result_revision,
    expected_digest: forwardReceipt.result_digest,
  }));
  return {
    target_selector: forwardReceipt.target_id,
    idempotency_key: deriveProjectRegistrationIdempotencyKey({
      operation_id: manifest.operation_id,
      step_id: manifest.step_id,
      direction: "inverse",
      target_selector: forwardReceipt.target_id,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
    }),
    request_digest: requestDigest,
    precondition_digest: preconditionDigest,
    project_id: project.id,
    project_slug: project.slug,
    project_name: project.name,
    desired,
  };
}

function assertLookupControl(
  result: ProjectRegistrationAuthorityLookupResult,
  input: ProjectResourceLinkProducerVerificationInput,
): void {
  const control = result.response_control;
  if (
    control.complete !== true
    || control.truncated !== false
    || control.response_bytes > input.response_byte_limit
    || control.elapsed_ms > input.time_budget_ms
  ) {
    throw new Error("producer receipt lookup did not return one complete bounded result");
  }
}

async function lookupStoredReceipt(
  authority: ProjectRegistrationAuthorityAdapter,
  receipt: ProjectRegistrationAuthorityReceipt,
  request: ProducerRequestBinding,
  input: ProjectResourceLinkProducerVerificationInput,
): Promise<ProjectRegistrationAuthorityReceipt> {
  const result = await authority.lookupReceipt({
    operation_id: receipt.operation_id,
    step_id: receipt.step_id,
    resource_kind: receipt.resource_kind,
    direction: receipt.direction,
    authority: receipt.authority,
    authority_route: receipt.route,
    package_version: receipt.package_version,
    authority_id: receipt.authority_id,
    tenant_id: receipt.tenant_id,
    corpus_id: receipt.corpus_id,
    target_selector: request.target_selector,
    idempotency_key: request.idempotency_key,
    request_digest: request.request_digest,
    precondition_digest: request.precondition_digest,
    ...(receipt.target_id ? { target_id: receipt.target_id } : {}),
    max_items: 1,
    response_byte_limit: input.response_byte_limit,
    time_budget_ms: input.time_budget_ms,
  });
  assertLookupControl(result, input);
  if (canonicalJson(result.receipt) !== canonicalJson(receipt)) {
    throw new Error("stored producer receipt does not match the supplied verification envelope");
  }
  return result.receipt;
}

function opaqueTargetHandle(digest: string): ProjectRegistrationPathHandle {
  return {
    digest,
    withOwnedPath<T>(): T {
      throw new Error(
        "producer authority requires an owned path, but migration verification only carries an opaque target context",
      );
    },
  } as unknown as ProjectRegistrationPathHandle;
}

function assertForwardReceipt(
  receipt: ProjectRegistrationAuthorityReceipt,
  manifest: ProjectResourceLinkMigrationManifestV1,
  item: ProjectResourceLinkMigrationItem,
  producerEvidence: ProjectResourceLinkProducerEvidence,
  capability: ProjectRegistrationAuthorityCapability,
  expectedResourceKind: ProjectRegistrationResourceKind,
  request: ProducerRequestBinding,
): void {
  assertReceiptContext(receipt, manifest, item, capability, "forward", expectedResourceKind);
  const persisted = item.producer_evidence;
  if (!persisted) throw new Error("producer verification has no persisted forward evidence");
  if (
    receipt.outcome !== "accepted"
    || receipt.receipt_id !== producerEvidence.forward_receipt_id
    || receipt.receipt_id !== persisted.forward_receipt_id
    || receipt.created_by_operation !== persisted.created_by_operation
    || receipt.target_id !== expectedTargetId(item)
    || receipt.idempotency_key !== request.idempotency_key
    || receipt.request_digest !== request.request_digest
    || receipt.precondition_digest !== request.precondition_digest
  ) {
    throw new Error("producer forward receipt does not bind the trusted project subject and manifest target");
  }
  if (producerEvidence.child_link_receipt_ids.length > 0) {
    throw new Error("producer child-link receipt verification is not configured; refusing terminal transition");
  }
}

async function assertCurrentReadback(
  authority: ProjectRegistrationAuthorityAdapter,
  receipt: ProjectRegistrationAuthorityReceipt,
  proof: ProducerLinkVerificationEvidence,
  producerEvidence: ProjectResourceLinkProducerEvidence,
  input: ProjectResourceLinkProducerVerificationInput,
): Promise<void> {
  if (!receipt.target_id) throw new Error("producer forward receipt does not identify a target");
  const record = await authority.readExact({
    resource_kind: receipt.resource_kind,
    target_id: receipt.target_id,
    target: opaqueTargetHandle(proof.target_context_digest),
    response_byte_limit: input.response_byte_limit,
    time_budget_ms: input.time_budget_ms,
  });
  if (
    record.target_id !== receipt.target_id
    || record.revision !== producerEvidence.target_revision
    || record.digest !== producerEvidence.target_digest
  ) {
    throw new Error("producer exact readback does not match the terminal migration evidence");
  }
}

function assertInverseReceipt(
  receipt: ProjectRegistrationAuthorityReceipt,
  forwardReceipt: ProjectRegistrationAuthorityReceipt,
  manifest: ProjectResourceLinkMigrationManifestV1,
  item: ProjectResourceLinkMigrationItem,
  producerEvidence: ProjectResourceLinkProducerEvidence,
  capability: ProjectRegistrationAuthorityCapability,
  expectedResourceKind: ProjectRegistrationResourceKind,
  phase: ProjectResourceLinkProducerAttestationPhase,
  request: ProducerRequestBinding,
): void {
  assertReceiptContext(receipt, manifest, item, capability, "inverse", expectedResourceKind);
  const expectedOutcome = phase === "inverse_complete"
    ? ["accepted", "duplicate_of_accepted"]
    : ["terminal_nonacceptance"];
  if (
    !expectedOutcome.includes(receipt.outcome)
    || receipt.accepted_receipt_id !== forwardReceipt.receipt_id
    || receipt.target_id !== forwardReceipt.target_id
    || receipt.result_revision !== producerEvidence.target_revision
    || receipt.result_digest !== producerEvidence.target_digest
    || receipt.idempotency_key !== request.idempotency_key
    || receipt.request_digest !== request.request_digest
    || receipt.precondition_digest !== request.precondition_digest
  ) {
    throw new Error("producer inverse receipt does not prove the requested terminal outcome");
  }
}

async function assertInverseComplete(
  authority: ProjectRegistrationAuthorityAdapter,
  forwardReceipt: ProjectRegistrationAuthorityReceipt,
  inverseReceipt: ProjectRegistrationAuthorityReceipt,
  inverseRequest: ProducerInverseRequestEvidence,
  proof: ProducerLinkVerificationEvidence,
  request: ProducerRequestBinding,
  input: ProjectResourceLinkProducerVerificationInput,
): Promise<void> {
  if (!forwardReceipt.target_id) throw new Error("producer forward receipt does not identify a target");
  if (
    inverseRequest.project_slug !== request.project_slug
    || inverseRequest.project_name !== request.project_name
    || canonicalJson(inverseRequest.desired) !== canonicalJson(request.desired)
  ) {
    throw new Error("producer inverse request evidence does not match the trusted project subject");
  }
  const verification = await authority.verifyInverse({
    operation_id: inverseReceipt.operation_id,
    step_id: inverseReceipt.step_id,
    resource_kind: inverseReceipt.resource_kind,
    direction: "inverse",
    authority_route: inverseReceipt.route,
    package_version: inverseReceipt.package_version,
    authority_id: inverseReceipt.authority_id,
    tenant_id: inverseReceipt.tenant_id,
    corpus_id: inverseReceipt.corpus_id,
    target_selector: request.target_selector,
    idempotency_key: request.idempotency_key,
    request_digest: request.request_digest,
    precondition_digest: request.precondition_digest,
    project_id: request.project_id,
    project_slug: request.project_slug,
    project_name: request.project_name,
    desired: request.desired,
    target: opaqueTargetHandle(proof.target_context_digest),
    accepted_receipt: forwardReceipt,
    response_byte_limit: input.response_byte_limit,
    time_budget_ms: input.time_budget_ms,
  });
  if (
    verification.absent !== true
    || verification.target_id !== forwardReceipt.target_id
    || verification.accepted_receipt_id !== forwardReceipt.receipt_id
    || !verification.digest?.trim()
  ) {
    throw new Error("producer inverse verification did not prove exact target absence");
  }
}

async function verifyLink(
  authority: ProjectRegistrationAuthorityAdapter,
  capability: ProjectRegistrationAuthorityCapability,
  manifest: ProjectResourceLinkMigrationManifestV1,
  item: ProjectResourceLinkMigrationItem,
  proof: ProducerLinkVerificationEvidence,
  producerEvidence: ProjectResourceLinkProducerEvidence,
  input: ProjectResourceLinkProducerVerificationInput,
): Promise<void> {
  const expectedAuthority = authorityName(item);
  const expectedResourceKind = resourceKind(item);
  const forwardRequest = trustedConversationsForwardRequest(manifest, item, input);
  assertCapability(item, capability, expectedAuthority, expectedResourceKind);
  if (proof.target_selector !== forwardRequest.target_selector) {
    throw new Error("producer verification target selector does not match the trusted project subject");
  }
  assertForwardReceipt(
    proof.forward_receipt,
    manifest,
    item,
    producerEvidence,
    capability,
    expectedResourceKind,
    forwardRequest,
  );
  const storedForward = await lookupStoredReceipt(
    authority,
    proof.forward_receipt,
    forwardRequest,
    input,
  );
  if (input.phase === "readback") {
    await assertCurrentReadback(authority, storedForward, proof, producerEvidence, input);
    return;
  }
  if (!capability.conditional_inverse) {
    throw new Error("producer capability does not support conditional inverse verification");
  }
  if (!proof.inverse_receipt || !proof.inverse_request) {
    throw new Error("producer inverse verification requires an exact inverse receipt and request context");
  }
  const inverseRequest = trustedInverseRequest(manifest, storedForward, input);
  assertInverseReceipt(
    proof.inverse_receipt,
    storedForward,
    manifest,
    item,
    producerEvidence,
    capability,
    expectedResourceKind,
    input.phase,
    inverseRequest,
  );
  const storedInverse = await lookupStoredReceipt(
    authority,
    proof.inverse_receipt,
    inverseRequest,
    input,
  );
  if (input.phase === "inverse_complete") {
    await assertInverseComplete(
      authority,
      storedForward,
      storedInverse,
      proof.inverse_request,
      proof,
      inverseRequest,
      input,
    );
    return;
  }
  await assertCurrentReadback(authority, storedForward, proof, producerEvidence, input);
}

export function createProductionProjectResourceLinkProducerEvidenceVerifier(
  options: ProductionProjectResourceLinkProducerVerifierOptions = {},
): AsyncProjectResourceLinkProducerEvidenceVerifier {
  const authorities = options.authorities ?? productionProjectRegistrationAuthorities();
  const now = options.now ?? (() => new Date().toISOString());
  return async (input): Promise<ProjectResourceLinkProducerAttestation> => {
    const envelope = envelopeValue(input.transition_evidence);
    if (envelope.links.length !== input.manifest.links.length) {
      throw new Error("producer verification evidence requires exact proof for every manifest link");
    }
    const proofByLink = new Map(envelope.links.map((proof) => [proof.link_id, proof]));
    const capabilityByAuthority = new Map<
      ProjectRegistrationAuthorityName,
      ProjectRegistrationAuthorityCapability
    >();
    for (let index = 0; index < input.manifest.links.length; index += 1) {
      const item = input.manifest.links[index]!;
      const proof = proofByLink.get(item.link_id);
      if (!proof) throw new Error(`producer verification evidence is missing link ${item.link_id}`);
      const name = authorityName(item);
      const authority = authorities[name];
      if (!authority) throw new Error(`producer authority ${name} is not configured for trusted readback`);
      let capability = capabilityByAuthority.get(name);
      if (!capability) {
        capability = await authority.capability();
        capabilityByAuthority.set(name, capability);
      }
      await verifyLink(
        authority,
        capability,
        input.manifest,
        item,
        proof,
        input.producer_evidence[index]!,
        input,
      );
    }
    const evidenceDigest = projectResourceLinkProducerEvidenceDigest(
      input.manifest,
      input.phase,
      input.producer_evidence,
    );
    return {
      attestation_id: projectResourceLinkProducerAttestationId(
        input.manifest.manifest_id,
        input.phase,
        evidenceDigest,
      ),
      manifest_id: input.manifest.manifest_id,
      phase: input.phase,
      evidence_digest: evidenceDigest,
      verifier: PROJECT_RESOURCE_LINK_PRODUCER_VERIFIER,
      verified_at: now(),
    };
  };
}
