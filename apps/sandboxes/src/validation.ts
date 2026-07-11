import {
  assertDigest,
  assertOpaqueId,
  assertRfc3339,
  canonicalDigest,
  parsePositiveInt64,
  type Digest,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import {
  assertEffectJournalOutcomeSchema,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  EFFECT_JOURNAL_OUTCOME_KINDS,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
} from "./effect-journal.js";
import {
  SCHEMA_VERSION,
  type ActivationGrantV1,
  type CanonicalSandboxEffectFenceV1,
  type AuthorizationConsumptionReceiptSetV1,
  type AuthorizationConsumptionReceiptV1,
  type CapabilityClaimsV1,
  type CapabilityConstraintsV1,
  type CapabilitySenderProofV1,
  type CapabilityTargetV1,
  type CheckpointDurabilityReceiptV1,
  type CleanupBasisV1,
  type CreateSandboxV1,
  type DispatchedJournalAnchorV1,
  type DispatchedJournalRecordV1,
  type InfinityCleanupGrantV1,
  type LifecycleTransitionBindingV1,
  type ProviderEffectTargetV1,
  type ProviderDiscoveryScopeV1,
  type ProviderOutcomeAnchorV1,
  type ProviderOutcomeRecordV1,
  type ReadProbeJournalAnchorV1,
  type ReadProbeJournalRecordV1,
  type ReadProbeNoEffectReceiptV1,
  type SignedEffectJournalAnchorV1,
  type SandboxSpecV1,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, field: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SandboxError("validation_failed", `${field} must be an object`, { field });
  }
  return value as JsonRecord;
}

function closed(value: unknown, field: string, keys: readonly string[]): JsonRecord {
  const result = record(value, field);
  const allowed = new Set(keys);
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) {
      throw new SandboxError("validation_failed", `${field} contains an unknown field`, {
        field: `${field}.${key}`,
      });
    }
  }
  for (const key of keys) {
    if (!(key in result)) {
      throw new SandboxError("validation_failed", `${field} is missing a required field`, {
        field: `${field}.${key}`,
      });
    }
  }
  return result;
}

function closedOptional(
  value: unknown,
  field: string,
  required: readonly string[],
  optional: readonly string[],
): JsonRecord {
  const result = record(value, field);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) {
      throw new SandboxError("validation_failed", `${field} contains an unknown field`, {
        field: `${field}.${key}`,
      });
    }
  }
  for (const key of required) {
    if (!(key in result)) {
      throw new SandboxError("validation_failed", `${field} is missing a required field`, {
        field: `${field}.${key}`,
      });
    }
  }
  return result;
}

function literal<T extends string>(value: unknown, expected: T, field: string): T {
  if (value !== expected) {
    throw new SandboxError("protocol_incompatible", `${field} must be ${expected}`, { field });
  }
  return expected;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new SandboxError("validation_failed", `${field} is not an allowed value`, { field });
  }
  return value as T;
}

function stringValue(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new SandboxError("validation_failed", `${field} must be a bounded safe string`, { field });
  }
  return value;
}

function positiveInteger(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new SandboxError("validation_failed", `${field} must be a positive bounded integer`, { field });
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SandboxError("validation_failed", `${field} must be a non-negative safe integer`, { field });
  }
  return value as number;
}

function digest(value: unknown, field: string): Digest {
  assertDigest(value, field);
  return value;
}

function signature(value: unknown, field: string): string {
  const parsed = stringValue(value, field, 128);
  if (!/^[A-Za-z0-9_-]{86}$/u.test(parsed) || Buffer.from(parsed, "base64url").toString("base64url") !== parsed) {
    throw new SandboxError("validation_failed", `${field} must be canonical Ed25519 base64url`, { field });
  }
  return parsed;
}

function validateCapabilitySenderProof(value: unknown): CapabilitySenderProofV1 {
  const v = closed(value, "capability.sender_proof", [
    "schema_version", "sender_principal", "confirmation_key_id",
    "transport_session_sha256", "proof_nonce_sha256", "issued_at",
    "proof_sha256", "signature",
  ]);
  const facts = {
    schema_version: literal(
      v.schema_version,
      "infinity.capability-sender-proof/v1",
      "capability.sender_proof.schema_version",
    ),
    sender_principal: id(v.sender_principal, "capability.sender_proof.sender_principal", "principal"),
    confirmation_key_id: id(v.confirmation_key_id, "capability.sender_proof.confirmation_key_id", "key"),
    transport_session_sha256: digest(
      v.transport_session_sha256,
      "capability.sender_proof.transport_session_sha256",
    ),
    proof_nonce_sha256: digest(v.proof_nonce_sha256, "capability.sender_proof.proof_nonce_sha256"),
    issued_at: time(v.issued_at, "capability.sender_proof.issued_at"),
  };
  const proofSha256 = digest(v.proof_sha256, "capability.sender_proof.proof_sha256");
  if (proofSha256 !== canonicalDigest(facts)) {
    throw new SandboxError("integrity_failed", "Capability sender proof digest does not bind its closed facts");
  }
  return {
    ...facts,
    proof_sha256: proofSha256,
    signature: signature(v.signature, "capability.sender_proof.signature"),
  };
}

function validateCapabilityTarget(value: unknown): CapabilityTargetV1 {
  const v = closed(value, "capability.target", [
    "schema_version", "operation", "operation_id", "operation_step_id",
    "resource_id", "request_sha256", "idempotency_key_sha256",
    "expected_revision", "handle_sha256", "fence_sha256", "target_sha256",
  ]);
  const facts = {
    schema_version: literal(v.schema_version, "infinity.capability-target/v1", "capability.target.schema_version"),
    operation: enumValue(
      v.operation,
      [
        "begin_create_inert", "record_inert", "begin_activate", "record_active",
        "expire", "quarantine", "record_failed", "record_lost", "begin_destroy",
        "record_cleanup_failed", "resume_destroy", "record_destroyed", "exec.start",
        "exec.frames.read", "exec.result.read", "exec.cancel", "file.read", "file.write",
        "file.list", "checkpoint.export_bundle",
      ] as const,
      "capability.target.operation",
    ),
    operation_id: id(v.operation_id, "capability.target.operation_id", "op"),
    operation_step_id: id(v.operation_step_id, "capability.target.operation_step_id", "step"),
    resource_id: id(v.resource_id, "capability.target.resource_id", "sbx"),
    request_sha256: digest(v.request_sha256, "capability.target.request_sha256"),
    idempotency_key_sha256: digest(v.idempotency_key_sha256, "capability.target.idempotency_key_sha256"),
    expected_revision: nonNegativeInteger(v.expected_revision, "capability.target.expected_revision"),
    handle_sha256: v.handle_sha256 === null ? null : digest(v.handle_sha256, "capability.target.handle_sha256"),
    fence_sha256: digest(v.fence_sha256, "capability.target.fence_sha256"),
  };
  const targetSha256 = digest(v.target_sha256, "capability.target.target_sha256");
  if (targetSha256 !== canonicalDigest(facts)) {
    throw new SandboxError("integrity_failed", "Capability target digest does not bind its closed facts");
  }
  return { ...facts, target_sha256: targetSha256 };
}

function validateCapabilityConstraints(value: unknown): CapabilityConstraintsV1 {
  const v = closed(value, "capability.constraints", [
    "schema_version", "not_before", "expires_at", "use_mode", "max_uses",
    "constraints_sha256",
  ]);
  const facts = {
    schema_version: literal(
      v.schema_version,
      "infinity.capability-constraints/v1",
      "capability.constraints.schema_version",
    ),
    not_before: time(v.not_before, "capability.constraints.not_before"),
    expires_at: time(v.expires_at, "capability.constraints.expires_at"),
    use_mode: literal(v.use_mode, "once", "capability.constraints.use_mode"),
    max_uses: v.max_uses === 1
      ? 1 as const
      : (() => { throw new SandboxError("validation_failed", "Capability max_uses must be one"); })(),
  };
  const constraintsSha256 = digest(v.constraints_sha256, "capability.constraints.constraints_sha256");
  if (constraintsSha256 !== canonicalDigest(facts)) {
    throw new SandboxError("integrity_failed", "Capability constraints digest does not bind its closed facts");
  }
  return { ...facts, constraints_sha256: constraintsSha256 };
}

function validateAuthorizationConsumptionReceipt(value: unknown): AuthorizationConsumptionReceiptV1 {
  const v = closed(value, "authorization_consumption_receipt", [
    "schema_version", "receipt_id", "capability_sha256", "use_nonce_sha256",
    "operation_id", "operation_step_id", "target_sha256", "fence_sha256",
    "consumer_principal", "transaction_id", "commit_sequence", "use_ordinal",
    "max_uses", "committed_at", "issuer_principal", "signing_key_id",
    "receipt_sha256", "signature",
  ]);
  const facts = {
    schema_version: literal(
      v.schema_version,
      "infinity.authorization-consumption-receipt/v1",
      "authorization_consumption_receipt.schema_version",
    ),
    receipt_id: id(v.receipt_id, "authorization_consumption_receipt.receipt_id", "receipt"),
    capability_sha256: digest(v.capability_sha256, "authorization_consumption_receipt.capability_sha256"),
    use_nonce_sha256: digest(v.use_nonce_sha256, "authorization_consumption_receipt.use_nonce_sha256"),
    operation_id: id(v.operation_id, "authorization_consumption_receipt.operation_id", "op"),
    operation_step_id: id(v.operation_step_id, "authorization_consumption_receipt.operation_step_id", "step"),
    target_sha256: digest(v.target_sha256, "authorization_consumption_receipt.target_sha256"),
    fence_sha256: digest(v.fence_sha256, "authorization_consumption_receipt.fence_sha256"),
    consumer_principal: id(v.consumer_principal, "authorization_consumption_receipt.consumer_principal", "principal"),
    transaction_id: id(v.transaction_id, "authorization_consumption_receipt.transaction_id", "tx"),
    commit_sequence: parsePositiveInt64(v.commit_sequence, "authorization_consumption_receipt.commit_sequence"),
    use_ordinal: v.use_ordinal === 1
      ? 1 as const
      : (() => { throw new SandboxError("validation_failed", "Authorization use ordinal must be one"); })(),
    max_uses: v.max_uses === 1
      ? 1 as const
      : (() => { throw new SandboxError("validation_failed", "Authorization max_uses must be one"); })(),
    committed_at: time(v.committed_at, "authorization_consumption_receipt.committed_at"),
    issuer_principal: id(v.issuer_principal, "authorization_consumption_receipt.issuer_principal", "principal"),
    signing_key_id: id(v.signing_key_id, "authorization_consumption_receipt.signing_key_id", "key"),
  };
  const receiptSha256 = digest(v.receipt_sha256, "authorization_consumption_receipt.receipt_sha256");
  if (receiptSha256 !== canonicalDigest(facts)) {
    throw new SandboxError("integrity_failed", "Authorization consumption receipt digest differs");
  }
  return {
    ...facts,
    receipt_sha256: receiptSha256,
    signature: signature(v.signature, "authorization_consumption_receipt.signature"),
  };
}

export function validateAuthorizationConsumptionSet(
  value: unknown,
): AuthorizationConsumptionReceiptSetV1 {
  const v = closed(value, "authorization_consumption_set", [
    "schema_version", "capability_sha256", "operation_id", "operation_step_id",
    "target_sha256", "fence_sha256", "consumer_principal",
    "first_commit_sequence", "last_commit_sequence", "receipts", "set_sha256",
    "issuer_principal", "signing_key_id", "signature",
  ]);
  if (!Array.isArray(v.receipts) || v.receipts.length !== 1) {
    throw new SandboxError("validation_failed", "Authorization consumption set must contain exactly one receipt");
  }
  const receipt = validateAuthorizationConsumptionReceipt(v.receipts[0]);
  const facts = {
    schema_version: literal(
      v.schema_version,
      "infinity.authorization-consumption-set/v1",
      "authorization_consumption_set.schema_version",
    ),
    capability_sha256: digest(v.capability_sha256, "authorization_consumption_set.capability_sha256"),
    operation_id: id(v.operation_id, "authorization_consumption_set.operation_id", "op"),
    operation_step_id: id(v.operation_step_id, "authorization_consumption_set.operation_step_id", "step"),
    target_sha256: digest(v.target_sha256, "authorization_consumption_set.target_sha256"),
    fence_sha256: digest(v.fence_sha256, "authorization_consumption_set.fence_sha256"),
    consumer_principal: id(v.consumer_principal, "authorization_consumption_set.consumer_principal", "principal"),
    first_commit_sequence: parsePositiveInt64(v.first_commit_sequence, "authorization_consumption_set.first_commit_sequence"),
    last_commit_sequence: parsePositiveInt64(v.last_commit_sequence, "authorization_consumption_set.last_commit_sequence"),
    receipts: [receipt] as [AuthorizationConsumptionReceiptV1],
    issuer_principal: id(v.issuer_principal, "authorization_consumption_set.issuer_principal", "principal"),
    signing_key_id: id(v.signing_key_id, "authorization_consumption_set.signing_key_id", "key"),
  };
  if (
    facts.first_commit_sequence !== facts.last_commit_sequence ||
    receipt.commit_sequence !== facts.first_commit_sequence ||
    receipt.capability_sha256 !== facts.capability_sha256 ||
    receipt.operation_id !== facts.operation_id ||
    receipt.operation_step_id !== facts.operation_step_id ||
    receipt.target_sha256 !== facts.target_sha256 ||
    receipt.fence_sha256 !== facts.fence_sha256 ||
    receipt.consumer_principal !== facts.consumer_principal ||
    receipt.issuer_principal !== facts.issuer_principal ||
    receipt.signing_key_id !== facts.signing_key_id
  ) {
    throw new SandboxError("integrity_failed", "Authorization consumption set facts are not contiguous and exact");
  }
  const setSha256 = digest(v.set_sha256, "authorization_consumption_set.set_sha256");
  if (setSha256 !== canonicalDigest(facts)) {
    throw new SandboxError("integrity_failed", "Authorization consumption set digest differs");
  }
  return {
    ...facts,
    set_sha256: setSha256,
    signature: signature(v.signature, "authorization_consumption_set.signature"),
  };
}

function id(value: unknown, field: string, prefix: string): string {
  assertOpaqueId(value, field, prefix);
  return value;
}

function time(value: unknown, field: string): string {
  assertRfc3339(value, field);
  return value;
}

export function validateFence(value: unknown): CanonicalSandboxEffectFenceV1 {
  const v = closed(value, "fence", [
    "authority_epoch",
    "route_lineage_id",
    "route_id",
    "route_epoch",
    "run_id",
    "attempt_id",
    "attempt_lease_id",
    "lease_epoch",
    "resource_lease_id",
    "resource_id",
    "resource_lifecycle_generation",
    "operation_id",
    "operation_digest",
    "operation_execution_epoch",
    "actor_principal",
    "lease_holder_principal",
    "operation_executor_principal",
    "audience",
    "issued_at",
    "lease_expires_at",
    "operation_execution_expires_at",
  ]);

  const issuedAt = time(v.issued_at, "fence.issued_at");
  const leaseExpiresAt = time(v.lease_expires_at, "fence.lease_expires_at");
  const operationExpiresAt = time(
    v.operation_execution_expires_at,
    "fence.operation_execution_expires_at",
  );
  if (Date.parse(issuedAt) >= Date.parse(leaseExpiresAt) || Date.parse(issuedAt) >= Date.parse(operationExpiresAt)) {
    throw new SandboxError("validation_failed", "Fence expiry must be after issue time");
  }

  return {
    authority_epoch: parsePositiveInt64(v.authority_epoch, "fence.authority_epoch"),
    route_lineage_id: id(v.route_lineage_id, "fence.route_lineage_id", "route_lineage"),
    route_id: id(v.route_id, "fence.route_id", "route"),
    route_epoch: parsePositiveInt64(v.route_epoch, "fence.route_epoch"),
    run_id: id(v.run_id, "fence.run_id", "run"),
    attempt_id: id(v.attempt_id, "fence.attempt_id", "attempt"),
    attempt_lease_id: id(v.attempt_lease_id, "fence.attempt_lease_id", "attempt_lease"),
    lease_epoch: parsePositiveInt64(v.lease_epoch, "fence.lease_epoch"),
    resource_lease_id: id(v.resource_lease_id, "fence.resource_lease_id", "resource_lease"),
    resource_id: id(v.resource_id, "fence.resource_id", "sbx"),
    resource_lifecycle_generation: parsePositiveInt64(
      v.resource_lifecycle_generation,
      "fence.resource_lifecycle_generation",
    ),
    operation_id: id(v.operation_id, "fence.operation_id", "op"),
    operation_digest: digest(v.operation_digest, "fence.operation_digest"),
    operation_execution_epoch: parsePositiveInt64(
      v.operation_execution_epoch,
      "fence.operation_execution_epoch",
    ),
    actor_principal: id(v.actor_principal, "fence.actor_principal", "principal"),
    lease_holder_principal: id(v.lease_holder_principal, "fence.lease_holder_principal", "principal"),
    operation_executor_principal: id(
      v.operation_executor_principal,
      "fence.operation_executor_principal",
      "principal",
    ),
    audience: literal(v.audience, SCHEMA_VERSION, "fence.audience"),
    issued_at: issuedAt,
    lease_expires_at: leaseExpiresAt,
    operation_execution_expires_at: operationExpiresAt,
  };
}

export function validateSandboxSpec(value: unknown): SandboxSpecV1 {
  const v = closed(value, "spec", [
    "schema_version",
    "run_id",
    "attempt_id",
    "source",
    "environment",
    "runtime_class",
    "architecture",
    "workspace_root",
    "network_policy",
    "resources",
    "exec_concurrency",
    "max_runtime_ms",
    "expires_at",
    "data_class",
    "input_bundle_refs",
  ]);
  literal(v.schema_version, SCHEMA_VERSION, "spec.schema_version");
  const source = closed(v.source, "spec.source", [
    "repository_ref",
    "commit_sha",
    "source_bundle_sha256",
  ]);
  const environment = closed(v.environment, "spec.environment", [
    "image_or_snapshot_sha256",
    "toolchain_manifest_sha256",
  ]);
  const network = closed(v.network_policy, "spec.network_policy", ["mode", "policy_sha256"]);
  const resources = closed(v.resources, "spec.resources", [
    "cpu_millis",
    "memory_bytes",
    "disk_bytes",
    "pids",
    "open_files",
    "output_bytes",
  ]);

  const repositoryRef = id(source.repository_ref, "spec.source.repository_ref", "repo");
  const commitSha = stringValue(source.commit_sha, "spec.source.commit_sha", 64);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commitSha)) {
    throw new SandboxError("validation_failed", "spec.source.commit_sha must be an exact lowercase commit digest");
  }
  if (!Array.isArray(v.input_bundle_refs) || v.input_bundle_refs.length > 128) {
    throw new SandboxError("validation_failed", "spec.input_bundle_refs must be a bounded array");
  }
  const refs = v.input_bundle_refs.map((candidate, index) => {
    const ref = closed(candidate, `spec.input_bundle_refs.${index}`, ["sha256", "size_bytes"]);
    return {
      sha256: digest(ref.sha256, `spec.input_bundle_refs.${index}.sha256`),
      size_bytes: nonNegativeInteger(ref.size_bytes, `spec.input_bundle_refs.${index}.size_bytes`),
    };
  });
  const concurrency = positiveInteger(v.exec_concurrency, "spec.exec_concurrency", 1);

  return {
    schema_version: SCHEMA_VERSION,
    run_id: id(v.run_id, "spec.run_id", "run"),
    attempt_id: id(v.attempt_id, "spec.attempt_id", "attempt"),
    source: {
      repository_ref: repositoryRef,
      commit_sha: commitSha,
      source_bundle_sha256: digest(source.source_bundle_sha256, "spec.source.source_bundle_sha256"),
    },
    environment: {
      image_or_snapshot_sha256: digest(
        environment.image_or_snapshot_sha256,
        "spec.environment.image_or_snapshot_sha256",
      ),
      toolchain_manifest_sha256: digest(
        environment.toolchain_manifest_sha256,
        "spec.environment.toolchain_manifest_sha256",
      ),
    },
    runtime_class: literal(v.runtime_class, "strong_vm", "spec.runtime_class"),
    architecture: enumValue(v.architecture, ["arm64", "amd64"] as const, "spec.architecture"),
    workspace_root: literal(v.workspace_root, "/workspace", "spec.workspace_root"),
    network_policy: {
      mode: enumValue(network.mode, ["deny_all", "broker_only"] as const, "spec.network_policy.mode"),
      policy_sha256: digest(network.policy_sha256, "spec.network_policy.policy_sha256"),
    },
    resources: {
      cpu_millis: positiveInteger(resources.cpu_millis, "spec.resources.cpu_millis", 256_000),
      memory_bytes: positiveInteger(resources.memory_bytes, "spec.resources.memory_bytes"),
      disk_bytes: positiveInteger(resources.disk_bytes, "spec.resources.disk_bytes"),
      pids: positiveInteger(resources.pids, "spec.resources.pids", 65_536),
      open_files: positiveInteger(resources.open_files, "spec.resources.open_files", 1_048_576),
      output_bytes: positiveInteger(resources.output_bytes, "spec.resources.output_bytes"),
    },
    exec_concurrency: concurrency,
    max_runtime_ms: positiveInteger(v.max_runtime_ms, "spec.max_runtime_ms", 604_800_000),
    expires_at: time(v.expires_at, "spec.expires_at"),
    data_class: enumValue(
      v.data_class,
      ["public", "internal_non_sensitive", "restricted"] as const,
      "spec.data_class",
    ),
    input_bundle_refs: refs,
  };
}

export function validateCreateSandbox(value: unknown): CreateSandboxV1 {
  const v = closed(value, "create", ["schema_version", "resource_id", "allocation_key_sha256", "spec"]);
  return {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "create.schema_version"),
    resource_id: id(v.resource_id, "create.resource_id", "sbx"),
    allocation_key_sha256: digest(v.allocation_key_sha256, "create.allocation_key_sha256"),
    spec: validateSandboxSpec(v.spec),
  };
}

export function validateCapability(value: unknown): CapabilityClaimsV1 {
  const v = closedOptional(value, "capability", [
    "schema_version",
    "capability_id",
    "use_nonce_sha256",
    "operation",
    "target_resource_id",
    "request_sha256",
    "idempotency_key_sha256",
    "expected_revision",
    "fence",
    "not_before",
    "expires_at",
    "issuer_principal",
    "subject_principal",
    "audience",
    "sender_proof",
    "target",
    "constraints",
    "use_mode",
    "max_uses",
    "authorization_consumption_set",
    "capability_sha256",
    "signing_key_id",
    "signature",
  ], ["handle_sha256"]);
  const base = {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "capability.schema_version"),
    capability_id: id(v.capability_id, "capability.capability_id", "cap"),
    use_nonce_sha256: digest(v.use_nonce_sha256, "capability.use_nonce_sha256"),
    operation: enumValue(
      v.operation,
      [
        "begin_create_inert",
        "record_inert",
        "begin_activate",
        "record_active",
        "expire",
        "quarantine",
        "record_failed",
        "record_lost",
        "begin_destroy",
        "record_cleanup_failed",
        "resume_destroy",
        "record_destroyed",
        "exec.start",
        "exec.frames.read",
        "exec.result.read",
        "exec.cancel",
        "file.read",
        "file.write",
        "file.list",
        "checkpoint.export_bundle",
      ] as const,
      "capability.operation",
    ),
    target_resource_id: id(v.target_resource_id, "capability.target_resource_id", "sbx"),
    request_sha256: digest(v.request_sha256, "capability.request_sha256"),
    idempotency_key_sha256: digest(
      v.idempotency_key_sha256,
      "capability.idempotency_key_sha256",
    ),
    expected_revision: nonNegativeInteger(
      v.expected_revision,
      "capability.expected_revision",
    ),
    ...(v.handle_sha256 === undefined
      ? {}
      : { handle_sha256: digest(v.handle_sha256, "capability.handle_sha256") }),
    fence: validateFence(v.fence),
    not_before: time(v.not_before, "capability.not_before"),
    expires_at: time(v.expires_at, "capability.expires_at"),
    issuer_principal: id(v.issuer_principal, "capability.issuer_principal", "principal"),
    subject_principal: id(v.subject_principal, "capability.subject_principal", "principal"),
    audience: literal(v.audience, SCHEMA_VERSION, "capability.audience"),
    sender_proof: validateCapabilitySenderProof(v.sender_proof),
    target: validateCapabilityTarget(v.target),
    constraints: validateCapabilityConstraints(v.constraints),
    use_mode: literal(v.use_mode, "once", "capability.use_mode"),
    max_uses: v.max_uses === 1
      ? 1 as const
      : (() => { throw new SandboxError("validation_failed", "Capability max_uses must be one"); })(),
  };
  const capabilitySha256 = digest(v.capability_sha256, "capability.capability_sha256");
  const signingKeyId = id(v.signing_key_id, "capability.signing_key_id", "key");
  const capabilityFacts = { ...base, signing_key_id: signingKeyId };
  if (capabilitySha256 !== canonicalDigest(capabilityFacts)) {
    throw new SandboxError("integrity_failed", "Capability digest does not bind its closed signed claims");
  }
  const consumptionSet = validateAuthorizationConsumptionSet(v.authorization_consumption_set);
  if (
    base.target.operation !== base.operation ||
    base.target.operation_id !== base.fence.operation_id ||
    base.target.resource_id !== base.target_resource_id ||
    base.target.request_sha256 !== base.request_sha256 ||
    base.target.idempotency_key_sha256 !== base.idempotency_key_sha256 ||
    base.target.expected_revision !== base.expected_revision ||
    base.target.handle_sha256 !== (base.handle_sha256 ?? null) ||
    base.target.fence_sha256 !== canonicalDigest(base.fence) ||
    base.constraints.not_before !== base.not_before ||
    base.constraints.expires_at !== base.expires_at ||
    base.constraints.use_mode !== base.use_mode ||
    base.constraints.max_uses !== base.max_uses ||
    base.sender_proof.sender_principal !== base.subject_principal ||
    Date.parse(base.sender_proof.issued_at) > Date.parse(base.not_before) ||
    base.subject_principal !== base.fence.operation_executor_principal ||
    base.audience !== base.fence.audience ||
    consumptionSet.capability_sha256 !== capabilitySha256 ||
    consumptionSet.operation_id !== base.target.operation_id ||
    consumptionSet.operation_step_id !== base.target.operation_step_id ||
    consumptionSet.target_sha256 !== base.target.target_sha256 ||
    consumptionSet.fence_sha256 !== base.target.fence_sha256 ||
    consumptionSet.consumer_principal !== base.subject_principal ||
    consumptionSet.issuer_principal !== base.issuer_principal ||
    consumptionSet.signing_key_id !== signingKeyId ||
    consumptionSet.receipts[0].use_nonce_sha256 !== base.use_nonce_sha256 ||
    Date.parse(consumptionSet.receipts[0].committed_at) < Date.parse(base.not_before) ||
    Date.parse(consumptionSet.receipts[0].committed_at) >= Date.parse(base.expires_at)
  ) {
    throw new SandboxError("capability_denied", "Capability signed target, sender, constraints, or consumption set differs");
  }
  return {
    ...base,
    authorization_consumption_set: consumptionSet,
    capability_sha256: capabilitySha256,
    signing_key_id: signingKeyId,
    signature: signature(v.signature, "capability.signature"),
  };
}

export function validateActivationGrant(value: unknown): ActivationGrantV1 {
  const v = closed(value, "activation_grant", [
    "schema_version",
    "grant_id",
    "resource_id",
    "resource_lifecycle_generation",
    "successor_resource_lifecycle_generation",
    "operation_id",
    "operation_digest",
    "network_policy_sha256",
    "expires_at",
    "one_use_nonce_sha256",
  ]);
  const expectedGeneration = parsePositiveInt64(
    v.resource_lifecycle_generation,
    "activation_grant.resource_lifecycle_generation",
  );
  const successorGeneration = parsePositiveInt64(
    v.successor_resource_lifecycle_generation,
    "activation_grant.successor_resource_lifecycle_generation",
  );
  if (successorGeneration !== expectedGeneration + 1n) {
    throw new SandboxError("validation_failed", "Activation grant successor must be exactly expected plus one");
  }
  return {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "activation_grant.schema_version"),
    grant_id: id(v.grant_id, "activation_grant.grant_id", "grant"),
    resource_id: id(v.resource_id, "activation_grant.resource_id", "sbx"),
    resource_lifecycle_generation: expectedGeneration,
    successor_resource_lifecycle_generation: successorGeneration,
    operation_id: id(v.operation_id, "activation_grant.operation_id", "op"),
    operation_digest: digest(v.operation_digest, "activation_grant.operation_digest"),
    network_policy_sha256: digest(v.network_policy_sha256, "activation_grant.network_policy_sha256"),
    expires_at: time(v.expires_at, "activation_grant.expires_at"),
    one_use_nonce_sha256: digest(v.one_use_nonce_sha256, "activation_grant.one_use_nonce_sha256"),
  };
}

function validateCleanupBasis(value: unknown): CleanupBasisV1 {
  const v = closedOptional(
    value,
    "cleanup_grant.basis",
    ["kind", "receipt_sha256"],
    ["recovery_checkpoint_attempted", "promotion_grants_revoked", "permanent_outcome"],
  );
  const kind = enumValue(
    v.kind,
    ["checkpoint_durable", "git_promotion", "discard_uncheckpointed"] as const,
    "cleanup_grant.basis.kind",
  );
  if (kind === "discard_uncheckpointed") {
    if (
      v.recovery_checkpoint_attempted !== true ||
      v.promotion_grants_revoked !== true ||
      v.permanent_outcome !== "discarded_uncheckpointed"
    ) {
      throw new SandboxError(
        "cleanup_grant_mismatch",
        "Uncheckpointed discard must be recovery-first, revoke promotion, and bind the permanent disposition",
      );
    }
    return {
      kind,
      receipt_sha256: digest(v.receipt_sha256, "cleanup_grant.basis.receipt_sha256"),
      recovery_checkpoint_attempted: true,
      promotion_grants_revoked: true,
      permanent_outcome: "discarded_uncheckpointed",
    };
  }
  if (
    v.recovery_checkpoint_attempted !== undefined ||
    v.promotion_grants_revoked !== undefined ||
    v.permanent_outcome !== undefined
  ) {
    throw new SandboxError("validation_failed", "Cleanup basis contains fields that do not apply to its kind");
  }
  return {
    kind,
    receipt_sha256: digest(v.receipt_sha256, "cleanup_grant.basis.receipt_sha256"),
  };
}

export function validateCleanupGrant(value: unknown): InfinityCleanupGrantV1 {
  const v = closed(value, "cleanup_grant", [
    "schema_version",
    "grant_id",
    "resource_id",
    "resource_lifecycle_generation",
    "successor_resource_lifecycle_generation",
    "provider_handle_sha256",
    "operation_id",
    "operation_digest",
    "cleanup_executor_principal",
    "basis",
    "expires_at",
    "one_use_nonce_sha256",
  ]);
  const expectedGeneration = parsePositiveInt64(
    v.resource_lifecycle_generation,
    "cleanup_grant.resource_lifecycle_generation",
  );
  const successorGeneration = parsePositiveInt64(
    v.successor_resource_lifecycle_generation,
    "cleanup_grant.successor_resource_lifecycle_generation",
  );
  if (successorGeneration !== expectedGeneration + 1n) {
    throw new SandboxError("validation_failed", "Cleanup grant successor must be exactly expected plus one");
  }
  return {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "cleanup_grant.schema_version"),
    grant_id: id(v.grant_id, "cleanup_grant.grant_id", "grant"),
    resource_id: id(v.resource_id, "cleanup_grant.resource_id", "sbx"),
    resource_lifecycle_generation: expectedGeneration,
    successor_resource_lifecycle_generation: successorGeneration,
    provider_handle_sha256: digest(v.provider_handle_sha256, "cleanup_grant.provider_handle_sha256"),
    operation_id: id(v.operation_id, "cleanup_grant.operation_id", "op"),
    operation_digest: digest(v.operation_digest, "cleanup_grant.operation_digest"),
    cleanup_executor_principal: id(
      v.cleanup_executor_principal,
      "cleanup_grant.cleanup_executor_principal",
      "principal",
    ),
    basis: validateCleanupBasis(v.basis),
    expires_at: time(v.expires_at, "cleanup_grant.expires_at"),
    one_use_nonce_sha256: digest(v.one_use_nonce_sha256, "cleanup_grant.one_use_nonce_sha256"),
  };
}

export function validateLifecycleTransition(value: unknown): LifecycleTransitionBindingV1 {
  const v = closed(value, "transition", [
    "expected_resource_lifecycle_generation",
    "successor_resource_lifecycle_generation",
  ]);
  const expected = parsePositiveInt64(
    v.expected_resource_lifecycle_generation,
    "transition.expected_resource_lifecycle_generation",
  );
  const successor = parsePositiveInt64(
    v.successor_resource_lifecycle_generation,
    "transition.successor_resource_lifecycle_generation",
  );
  if (successor !== expected + 1n) {
    throw new SandboxError("validation_failed", "Infinity successor generation must be exactly expected plus one");
  }
  return {
    expected_resource_lifecycle_generation: expected,
    successor_resource_lifecycle_generation: successor,
  };
}

function validateSignedJournalAnchor<RecordV1>(
  value: unknown,
  field: string,
  parseRecord: (record: unknown) => RecordV1,
): SignedEffectJournalAnchorV1<RecordV1> {
  const v = closed(value, field, [
    "anchor_schema_version",
    "journal_sequence",
    "prior_frontier_digest",
    "record_digest",
    "frontier_digest",
    "signer_principal",
    "signing_key_id",
    "signature",
    "record",
  ]);
  const recordValue = parseRecord(v.record);
  const recordDigest = digest(v.record_digest, `${field}.record_digest`);
  if (recordDigest !== canonicalDigest(recordValue)) {
    throw new SandboxError("integrity_failed", `${field} record digest does not bind its canonical bytes`);
  }
  const anchor = {
    anchor_schema_version: literal(
      v.anchor_schema_version,
      "infinity.effect-journal-anchor/v1",
      `${field}.anchor_schema_version`,
    ),
    journal_sequence: parsePositiveInt64(v.journal_sequence, `${field}.journal_sequence`),
    prior_frontier_digest: digest(v.prior_frontier_digest, `${field}.prior_frontier_digest`),
    record_digest: recordDigest,
    frontier_digest: digest(v.frontier_digest, `${field}.frontier_digest`),
    signer_principal: id(v.signer_principal, `${field}.signer_principal`, "principal"),
    signing_key_id: id(v.signing_key_id, `${field}.signing_key_id`, "key"),
    signature: stringValue(v.signature, `${field}.signature`, 128),
    record: recordValue,
  } satisfies SignedEffectJournalAnchorV1<RecordV1>;
  if (!/^[A-Za-z0-9_-]{86}$/.test(anchor.signature)) {
    throw new SandboxError("validation_failed", `${field}.signature must be an Ed25519 base64url value`);
  }
  const expectedFrontier = canonicalDigest({
    anchor_schema_version: anchor.anchor_schema_version,
    journal_sequence: anchor.journal_sequence,
    prior_frontier_digest: anchor.prior_frontier_digest,
    record_digest: anchor.record_digest,
    signer_principal: anchor.signer_principal,
    signing_key_id: anchor.signing_key_id,
  });
  if (anchor.frontier_digest !== expectedFrontier) {
    throw new SandboxError("integrity_failed", `${field} frontier digest does not bind its signed tuple`);
  }
  return anchor;
}

function validateDispatchedJournalRecord(value: unknown): DispatchedJournalRecordV1 {
  const v = closed(value, "dispatch_journal.record", [
    "schema_version",
    "state",
    "record_kind",
    "outcome_schema_version",
    "outcome_schema_digest",
    "operation_id",
    "operation_step_id",
    "operation_execution_epoch",
    "operation_digest",
    "resource_id",
    "authority_epoch",
    "expected_resource_lifecycle_generation",
    "successor_resource_lifecycle_generation",
    "recorded_at",
    "expires_at",
    "provider_idempotency_token_sha256",
    "provider_creation_token_sha256",
    "immutable_fingerprint_sha256",
    "authorization_consumption_receipt_sha256",
    "fence",
  ]);
  const expectedGeneration = parsePositiveInt64(
    v.expected_resource_lifecycle_generation,
    "dispatch_journal.expected_resource_lifecycle_generation",
  );
  const successorGeneration = parsePositiveInt64(
    v.successor_resource_lifecycle_generation,
    "dispatch_journal.successor_resource_lifecycle_generation",
  );
  if (successorGeneration !== expectedGeneration + 1n) {
    throw new SandboxError("validation_failed", "Journal successor must be exactly expected plus one");
  }
  assertEffectJournalOutcomeSchema(v.outcome_schema_version, v.outcome_schema_digest);
  return {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "dispatch_journal.schema_version"),
    state: literal(v.state, "dispatched", "dispatch_journal.state"),
    record_kind: literal(v.record_kind, "DISPATCHED", "dispatch_journal.record_kind"),
    outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
    outcome_schema_digest: EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
    operation_id: id(v.operation_id, "dispatch_journal.operation_id", "op"),
    operation_step_id: id(v.operation_step_id, "dispatch_journal.operation_step_id", "step"),
    operation_execution_epoch: parsePositiveInt64(
      v.operation_execution_epoch,
      "dispatch_journal.operation_execution_epoch",
    ),
    operation_digest: digest(v.operation_digest, "dispatch_journal.operation_digest"),
    resource_id: id(v.resource_id, "dispatch_journal.resource_id", "sbx"),
    authority_epoch: parsePositiveInt64(v.authority_epoch, "dispatch_journal.authority_epoch"),
    expected_resource_lifecycle_generation: expectedGeneration,
    successor_resource_lifecycle_generation: successorGeneration,
    recorded_at: time(v.recorded_at, "dispatch_journal.recorded_at"),
    expires_at: time(v.expires_at, "dispatch_journal.expires_at"),
    provider_idempotency_token_sha256: digest(
      v.provider_idempotency_token_sha256,
      "dispatch_journal.provider_idempotency_token_sha256",
    ),
    provider_creation_token_sha256: digest(
      v.provider_creation_token_sha256,
      "dispatch_journal.provider_creation_token_sha256",
    ),
    immutable_fingerprint_sha256: digest(
      v.immutable_fingerprint_sha256,
      "dispatch_journal.immutable_fingerprint_sha256",
    ),
    authorization_consumption_receipt_sha256: digest(
      v.authorization_consumption_receipt_sha256,
      "dispatch_journal.authorization_consumption_receipt_sha256",
    ),
    fence: validateFence(v.fence),
  };
}

export function validateDispatchedJournalAnchor(value: unknown): DispatchedJournalAnchorV1 {
  return validateSignedJournalAnchor(value, "dispatch_journal", validateDispatchedJournalRecord);
}

export function validateProviderEffectTarget(value: unknown): ProviderEffectTargetV1 {
  const v = closed(value, "provider_target", [
    "operation_id",
    "operation_digest",
    "operation_step_id",
    "resource_id",
    "resource_lifecycle_generation",
    "provider_idempotency_token_sha256",
    "provider_creation_token_sha256",
    "immutable_fingerprint_sha256",
    "authorization_consumption_receipt_sha256",
  ]);
  return {
    operation_id: id(v.operation_id, "provider_target.operation_id", "op"),
    operation_digest: digest(v.operation_digest, "provider_target.operation_digest"),
    operation_step_id: id(v.operation_step_id, "provider_target.operation_step_id", "step"),
    resource_id: id(v.resource_id, "provider_target.resource_id", "sbx"),
    resource_lifecycle_generation: parsePositiveInt64(
      v.resource_lifecycle_generation,
      "provider_target.resource_lifecycle_generation",
    ),
    provider_idempotency_token_sha256: digest(
      v.provider_idempotency_token_sha256,
      "provider_target.provider_idempotency_token_sha256",
    ),
    provider_creation_token_sha256: digest(
      v.provider_creation_token_sha256,
      "provider_target.provider_creation_token_sha256",
    ),
    immutable_fingerprint_sha256: digest(
      v.immutable_fingerprint_sha256,
      "provider_target.immutable_fingerprint_sha256",
    ),
    authorization_consumption_receipt_sha256: digest(
      v.authorization_consumption_receipt_sha256,
      "provider_target.authorization_consumption_receipt_sha256",
    ),
  };
}

function validateProviderOutcomeRecord(value: unknown): ProviderOutcomeRecordV1 {
  const baseKeys = [
    "schema_version",
    "record_kind",
    "outcome_schema_version",
    "outcome_schema_digest",
    "operation_id",
    "operation_step_id",
    "operation_execution_epoch",
    "dispatch_anchor_sha256",
    "outcome_kind",
    "outcome_sha256",
    "recorded_at",
    "fence",
    "target",
  ] as const;
  const raw = record(value, "outcome_anchor.record");
  const outcomeKind = enumValue(
    raw.outcome_kind,
    EFFECT_JOURNAL_OUTCOME_KINDS,
    "outcome_anchor.outcome_kind",
  );
  const v = outcomeKind === "failed_no_effect"
    ? closed(value, "outcome_anchor.record", [
        ...baseKeys,
        "provider_no_effect_verification_receipt_sha256",
      ])
    : closed(value, "outcome_anchor.record", baseKeys);
  assertEffectJournalOutcomeSchema(v.outcome_schema_version, v.outcome_schema_digest);
  const facts = {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "outcome_anchor.schema_version"),
    record_kind: literal(v.record_kind, "OUTCOME", "outcome_anchor.record_kind"),
    outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
    outcome_schema_digest: EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
    operation_id: id(v.operation_id, "outcome_anchor.operation_id", "op"),
    operation_step_id: id(v.operation_step_id, "outcome_anchor.operation_step_id", "step"),
    operation_execution_epoch: parsePositiveInt64(
      v.operation_execution_epoch,
      "outcome_anchor.operation_execution_epoch",
    ),
    dispatch_anchor_sha256: digest(
      v.dispatch_anchor_sha256,
      "outcome_anchor.dispatch_anchor_sha256",
    ),
    outcome_sha256: digest(v.outcome_sha256, "outcome_anchor.outcome_sha256"),
    recorded_at: time(v.recorded_at, "outcome_anchor.recorded_at"),
    fence: validateFence(v.fence),
    target: validateProviderEffectTarget(v.target),
  };
  return outcomeKind === "failed_no_effect"
    ? {
        ...facts,
        outcome_kind: outcomeKind,
        provider_no_effect_verification_receipt_sha256: digest(
          v.provider_no_effect_verification_receipt_sha256,
          "outcome_anchor.provider_no_effect_verification_receipt_sha256",
        ),
      }
    : { ...facts, outcome_kind: outcomeKind };
}

export function validateProviderOutcomeAnchor(value: unknown): ProviderOutcomeAnchorV1 {
  return validateSignedJournalAnchor(value, "outcome_anchor", validateProviderOutcomeRecord);
}

function validateReadProbeJournalRecord(value: unknown): ReadProbeJournalRecordV1 {
  const v = closed(value, "read_probe_anchor.record", [
    "schema_version",
    "state",
    "operation_id",
    "operation_step_id",
    "operation_digest",
    "resource_id",
    "recorded_at",
    "expires_at",
    "fence",
    "target",
    "discovery_scope",
  ]);
  return {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "read_probe_anchor.schema_version"),
    state: literal(v.state, "read_probe", "read_probe_anchor.state"),
    operation_id: id(v.operation_id, "read_probe_anchor.operation_id", "op"),
    operation_step_id: id(v.operation_step_id, "read_probe_anchor.operation_step_id", "step"),
    operation_digest: digest(v.operation_digest, "read_probe_anchor.operation_digest"),
    resource_id: id(v.resource_id, "read_probe_anchor.resource_id", "sbx"),
    recorded_at: time(v.recorded_at, "read_probe_anchor.recorded_at"),
    expires_at: time(v.expires_at, "read_probe_anchor.expires_at"),
    fence: validateFence(v.fence),
    target: validateProviderEffectTarget(v.target),
    discovery_scope: validateProviderDiscoveryScope(v.discovery_scope),
  };
}

export function validateProviderDiscoveryScope(value: unknown): ProviderDiscoveryScopeV1 {
  const v = closed(value, "provider_discovery_scope", [
    "schema_version",
    "read_kind",
    "installation_id",
    "provider_scope_ref",
    "resource_id",
    "provider_creation_token_sha256",
    "immutable_fingerprint_sha256",
    "max_pages",
    "scope_sha256",
  ]);
  const protectedBytes = {
    schema_version: literal(
      v.schema_version,
      "sandboxes.provider-discovery-scope/v1",
      "provider_discovery_scope.schema_version",
    ),
    read_kind: literal(
      v.read_kind,
      "exact_operation_and_owned_resource",
      "provider_discovery_scope.read_kind",
    ),
    installation_id: stringValue(v.installation_id, "provider_discovery_scope.installation_id", 256),
    provider_scope_ref: stringValue(v.provider_scope_ref, "provider_discovery_scope.provider_scope_ref", 512),
    resource_id: id(v.resource_id, "provider_discovery_scope.resource_id", "sbx"),
    provider_creation_token_sha256: digest(
      v.provider_creation_token_sha256,
      "provider_discovery_scope.provider_creation_token_sha256",
    ),
    immutable_fingerprint_sha256: digest(
      v.immutable_fingerprint_sha256,
      "provider_discovery_scope.immutable_fingerprint_sha256",
    ),
    max_pages: positiveInteger(v.max_pages, "provider_discovery_scope.max_pages", 1_000),
  };
  const scopeSha256 = digest(v.scope_sha256, "provider_discovery_scope.scope_sha256");
  if (scopeSha256 !== canonicalDigest(protectedBytes)) {
    throw new SandboxError("integrity_failed", "Provider discovery scope digest does not bind its exact bytes");
  }
  return { ...protectedBytes, scope_sha256: scopeSha256 };
}

export function validateReadProbeJournalAnchor(value: unknown): ReadProbeJournalAnchorV1 {
  return validateSignedJournalAnchor(value, "read_probe_anchor", validateReadProbeJournalRecord);
}

export function validateReadProbeNoEffectReceipt(
  value: unknown,
): ReadProbeNoEffectReceiptV1 {
  const v = closed(value, "read_probe_no_effect_receipt", [
    "schema_version", "read_probe_anchor_sha256", "operation_id",
    "operation_step_id", "target_sha256", "discovery_scope_sha256",
    "proof_kind", "observed_at", "expires_at", "issuer_principal",
    "signing_key_id", "receipt_sha256", "signature",
  ]);
  const facts = {
    schema_version: literal(
      v.schema_version,
      "sandboxes.read-probe-no-effect-receipt/v1",
      "read_probe_no_effect_receipt.schema_version",
    ),
    read_probe_anchor_sha256: digest(
      v.read_probe_anchor_sha256,
      "read_probe_no_effect_receipt.read_probe_anchor_sha256",
    ),
    operation_id: id(v.operation_id, "read_probe_no_effect_receipt.operation_id", "op"),
    operation_step_id: id(v.operation_step_id, "read_probe_no_effect_receipt.operation_step_id", "step"),
    target_sha256: digest(v.target_sha256, "read_probe_no_effect_receipt.target_sha256"),
    discovery_scope_sha256: digest(
      v.discovery_scope_sha256,
      "read_probe_no_effect_receipt.discovery_scope_sha256",
    ),
    proof_kind: literal(
      v.proof_kind,
      "independent_read_only_no_effect",
      "read_probe_no_effect_receipt.proof_kind",
    ),
    observed_at: time(v.observed_at, "read_probe_no_effect_receipt.observed_at"),
    expires_at: time(v.expires_at, "read_probe_no_effect_receipt.expires_at"),
    issuer_principal: id(v.issuer_principal, "read_probe_no_effect_receipt.issuer_principal", "principal"),
    signing_key_id: id(v.signing_key_id, "read_probe_no_effect_receipt.signing_key_id", "key"),
  };
  const receiptSha256 = digest(v.receipt_sha256, "read_probe_no_effect_receipt.receipt_sha256");
  if (receiptSha256 !== canonicalDigest(facts)) {
    throw new SandboxError("integrity_failed", "Read-probe no-effect receipt digest differs");
  }
  return {
    ...facts,
    receipt_sha256: receiptSha256,
    signature: signature(v.signature, "read_probe_no_effect_receipt.signature"),
  };
}

export function validateCheckpointReceipt(value: unknown): CheckpointDurabilityReceiptV1 {
  const v = closed(value, "checkpoint_receipt", [
    "schema_version",
    "receipt_id",
    "checkpoint_id",
    "checkpoint_root_sha256",
    "storage_version",
    "resource_id",
    "run_id",
    "attempt_id",
    "fence",
    "durable_at",
    "issuer_principal",
    "receipt_sha256",
  ]);
  return {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "checkpoint_receipt.schema_version"),
    receipt_id: id(v.receipt_id, "checkpoint_receipt.receipt_id", "receipt"),
    checkpoint_id: id(v.checkpoint_id, "checkpoint_receipt.checkpoint_id", "checkpoint"),
    checkpoint_root_sha256: digest(v.checkpoint_root_sha256, "checkpoint_receipt.checkpoint_root_sha256"),
    storage_version: stringValue(v.storage_version, "checkpoint_receipt.storage_version", 128),
    resource_id: id(v.resource_id, "checkpoint_receipt.resource_id", "sbx"),
    run_id: id(v.run_id, "checkpoint_receipt.run_id", "run"),
    attempt_id: id(v.attempt_id, "checkpoint_receipt.attempt_id", "attempt"),
    fence: validateFence(v.fence),
    durable_at: time(v.durable_at, "checkpoint_receipt.durable_at"),
    issuer_principal: id(v.issuer_principal, "checkpoint_receipt.issuer_principal", "principal"),
    receipt_sha256: digest(v.receipt_sha256, "checkpoint_receipt.receipt_sha256"),
  };
}

export type ValidationKind =
  | "sandbox-spec"
  | "create-sandbox"
  | "fence"
  | "capability"
  | "activation-grant"
  | "cleanup-grant"
  | "checkpoint-receipt";

export function validateDocument(kind: ValidationKind, value: unknown): unknown {
  switch (kind) {
    case "sandbox-spec":
      return validateSandboxSpec(value);
    case "create-sandbox":
      return validateCreateSandbox(value);
    case "fence":
      return validateFence(value);
    case "capability":
      return validateCapability(value);
    case "activation-grant":
      return validateActivationGrant(value);
    case "cleanup-grant":
      return validateCleanupGrant(value);
    case "checkpoint-receipt":
      return validateCheckpointReceipt(value);
  }
}
