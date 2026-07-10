import {
  assertDigest,
  assertOpaqueId,
  assertRfc3339,
  parsePositiveInt64,
  type Digest,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import {
  SCHEMA_VERSION,
  type ActivationGrantV1,
  type CanonicalSandboxEffectFenceV1,
  type CapabilityClaimsV1,
  type CheckpointDurabilityReceiptV1,
  type CleanupBasisV1,
  type CreateSandboxV1,
  type DispatchedJournalAnchorV1,
  type InfinityCleanupGrantV1,
  type LifecycleTransitionBindingV1,
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
  const v = closed(value, "capability", [
    "schema_version",
    "capability_id",
    "use_nonce_sha256",
    "operation",
    "target_resource_id",
    "request_sha256",
    "dispatch_journal_anchor_sha256",
    "fence",
    "not_before",
    "expires_at",
  ]);
  return {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "capability.schema_version"),
    capability_id: id(v.capability_id, "capability.capability_id", "cap"),
    use_nonce_sha256: digest(v.use_nonce_sha256, "capability.use_nonce_sha256"),
    operation: enumValue(
      v.operation,
      ["create_inert", "activate", "expire", "quarantine", "destroy"] as const,
      "capability.operation",
    ),
    target_resource_id: id(v.target_resource_id, "capability.target_resource_id", "sbx"),
    request_sha256: digest(v.request_sha256, "capability.request_sha256"),
    dispatch_journal_anchor_sha256: digest(
      v.dispatch_journal_anchor_sha256,
      "capability.dispatch_journal_anchor_sha256",
    ),
    fence: validateFence(v.fence),
    not_before: time(v.not_before, "capability.not_before"),
    expires_at: time(v.expires_at, "capability.expires_at"),
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

export function validateDispatchedJournalAnchor(value: unknown): DispatchedJournalAnchorV1 {
  const v = closed(value, "dispatch_journal", [
    "schema_version",
    "journal_anchor_id",
    "state",
    "operation_id",
    "operation_step_id",
    "operation_digest",
    "resource_id",
    "authority_epoch",
    "expected_resource_lifecycle_generation",
    "successor_resource_lifecycle_generation",
    "recorded_at",
    "expires_at",
    "issuer_principal",
    "provider_idempotency_token_sha256",
    "immutable_fingerprint_sha256",
    "authorization_consumption_receipt_sha256",
    "frontier_sha256",
    "fence",
    "anchor_sha256",
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
  return {
    schema_version: literal(v.schema_version, SCHEMA_VERSION, "dispatch_journal.schema_version"),
    journal_anchor_id: id(v.journal_anchor_id, "dispatch_journal.journal_anchor_id", "journal"),
    state: literal(v.state, "dispatched", "dispatch_journal.state"),
    operation_id: id(v.operation_id, "dispatch_journal.operation_id", "op"),
    operation_step_id: id(v.operation_step_id, "dispatch_journal.operation_step_id", "step"),
    operation_digest: digest(v.operation_digest, "dispatch_journal.operation_digest"),
    resource_id: id(v.resource_id, "dispatch_journal.resource_id", "sbx"),
    authority_epoch: parsePositiveInt64(v.authority_epoch, "dispatch_journal.authority_epoch"),
    expected_resource_lifecycle_generation: expectedGeneration,
    successor_resource_lifecycle_generation: successorGeneration,
    recorded_at: time(v.recorded_at, "dispatch_journal.recorded_at"),
    expires_at: time(v.expires_at, "dispatch_journal.expires_at"),
    issuer_principal: id(v.issuer_principal, "dispatch_journal.issuer_principal", "principal"),
    provider_idempotency_token_sha256: digest(
      v.provider_idempotency_token_sha256,
      "dispatch_journal.provider_idempotency_token_sha256",
    ),
    immutable_fingerprint_sha256: digest(
      v.immutable_fingerprint_sha256,
      "dispatch_journal.immutable_fingerprint_sha256",
    ),
    authorization_consumption_receipt_sha256: digest(
      v.authorization_consumption_receipt_sha256,
      "dispatch_journal.authorization_consumption_receipt_sha256",
    ),
    frontier_sha256: digest(v.frontier_sha256, "dispatch_journal.frontier_sha256"),
    fence: validateFence(v.fence),
    anchor_sha256: digest(v.anchor_sha256, "dispatch_journal.anchor_sha256"),
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
