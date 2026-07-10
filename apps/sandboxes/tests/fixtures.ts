import { sha256, type Digest } from "../src/canonical.js";
import { AesGcmProviderHandleSealerV1 } from "../src/handle-sealer.js";
import { InMemorySandboxRepositoryV1 } from "../src/repository-memory.js";
import type { SandboxRepositoryV1 } from "../src/repository.js";
import { DeterministicFakeRunnerV1, type FakeRunnerOptionsV1 } from "../src/testing-runner.js";
import {
  activationRequestDigest,
  createRequestDigest,
  destroyRequestDigest,
  dispatchedJournalAnchorDigest,
  expireRequestDigest,
  SandboxesReferenceServiceV1,
} from "../src/service.js";
import { DeterministicTestAuthorityVerifierV1 } from "../src/testing.js";
import {
  SCHEMA_VERSION,
  type ActivationGrantV1,
  type CanonicalSandboxEffectFenceV1,
  type CapabilityClaimsV1,
  type CheckpointDurabilityReceiptV1,
  type CreateSandboxV1,
  type InfinityCleanupGrantV1,
  type MutationContextV1,
  type SandboxOperation,
  type SandboxSpecV1,
  type SandboxV1,
} from "../src/types.js";

export const CLOCK = new Date("2030-01-01T00:00:00.000Z");

export function oid(prefix: string, seed: number): string {
  return `${prefix}_${seed.toString(16).padStart(32, "0")}`;
}

export function digest(seed: string): Digest {
  return sha256(seed);
}

export function spec(expiresAt = "2030-01-01T00:10:00.000Z"): SandboxSpecV1 {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: oid("run", 1),
    attempt_id: oid("attempt", 2),
    source: {
      repository_ref: oid("repo", 3),
      commit_sha: "a".repeat(40),
      source_bundle_sha256: digest("source"),
    },
    environment: {
      image_or_snapshot_sha256: digest("image"),
      toolchain_manifest_sha256: digest("toolchain"),
    },
    runtime_class: "strong_vm",
    architecture: "amd64",
    workspace_root: "/workspace",
    network_policy: { mode: "deny_all", policy_sha256: digest("network") },
    resources: {
      cpu_millis: 1_000,
      memory_bytes: 1_073_741_824,
      disk_bytes: 10_737_418_240,
      pids: 128,
      open_files: 1_024,
      output_bytes: 1_048_576,
    },
    exec_concurrency: 1,
    max_runtime_ms: 600_000,
    expires_at: expiresAt,
    data_class: "internal_non_sensitive",
    input_bundle_refs: [{ sha256: digest("bundle"), size_bytes: 100 }],
  };
}

export function createInput(expiresAt?: string): CreateSandboxV1 {
  return {
    schema_version: SCHEMA_VERSION,
    resource_id: oid("sbx", 4),
    allocation_key_sha256: digest("allocation"),
    spec: spec(expiresAt),
  };
}

export function fence(
  operationId: string,
  operationDigest: Digest,
  generation: bigint,
  executionEpoch: bigint,
): CanonicalSandboxEffectFenceV1 {
  return {
    authority_epoch: 1n,
    route_lineage_id: oid("route_lineage", 5),
    route_id: oid("route", 6),
    route_epoch: 1n,
    run_id: oid("run", 1),
    attempt_id: oid("attempt", 2),
    attempt_lease_id: oid("attempt_lease", 7),
    lease_epoch: 1n,
    resource_lease_id: oid("resource_lease", 8),
    resource_id: oid("sbx", 4),
    resource_lifecycle_generation: generation,
    operation_id: operationId,
    operation_digest: operationDigest,
    operation_execution_epoch: executionEpoch,
    actor_principal: oid("principal", 9),
    lease_holder_principal: oid("principal", 10),
    operation_executor_principal: oid("principal", 11),
    audience: SCHEMA_VERSION,
    issued_at: "2029-12-31T23:59:00.000Z",
    lease_expires_at: "2030-01-01T01:00:00.000Z",
    operation_execution_expires_at: "2030-01-01T00:05:00.000Z",
  };
}

export function context(
  operation: SandboxOperation,
  operationId: string,
  requestSha256: Digest,
  generation: bigint,
  expectedRevision: number,
  executionEpoch: bigint,
  seed: number,
): MutationContextV1 {
  const fullFence = fence(operationId, requestSha256, generation, executionEpoch);
  const capability: CapabilityClaimsV1 = {
    schema_version: SCHEMA_VERSION,
    capability_id: oid("cap", seed),
    use_nonce_sha256: digest(`capability-nonce-${seed}`),
    operation,
    target_resource_id: oid("sbx", 4),
    request_sha256: requestSha256,
    dispatch_journal_anchor_sha256: digest("temporary-anchor"),
    fence: fullFence,
    not_before: "2029-12-31T23:59:00.000Z",
    expires_at: "2030-01-01T00:05:00.000Z",
  };
  const transition = {
    expected_resource_lifecycle_generation: generation,
    post_resource_lifecycle_generation: generation + 1n,
  };
  const anchorBase = {
    schema_version: SCHEMA_VERSION,
    journal_anchor_id: oid("journal", seed),
    state: "dispatched" as const,
    operation_id: operationId,
    operation_digest: requestSha256,
    resource_id: oid("sbx", 4),
    authority_epoch: fullFence.authority_epoch,
    expected_resource_lifecycle_generation: generation,
    post_resource_lifecycle_generation: generation + 1n,
    recorded_at: "2029-12-31T23:59:30.000Z",
    expires_at: "2030-01-01T00:05:00.000Z",
    issuer_principal: oid("principal", 99),
    anchor_sha256: digest("temporary-anchor"),
  };
  const dispatchJournal = {
    ...anchorBase,
    anchor_sha256: dispatchedJournalAnchorDigest(anchorBase),
  };
  capability.dispatch_journal_anchor_sha256 = dispatchJournal.anchor_sha256;
  return {
    operation_id: operationId,
    idempotency_key_sha256: digest(`idempotency-${seed}`),
    request_sha256: requestSha256,
    expected_revision: expectedRevision,
    transition,
    dispatch_journal: dispatchJournal,
    fence: fullFence,
    capability,
  };
}

export interface Harness {
  repository: SandboxRepositoryV1;
  runner: DeterministicFakeRunnerV1;
  verifier: DeterministicTestAuthorityVerifierV1;
  service: SandboxesReferenceServiceV1;
}

export function harness(
  repository: SandboxRepositoryV1 = new InMemorySandboxRepositoryV1(),
  runnerOptions: FakeRunnerOptionsV1 = {},
): Harness {
  const runner = new DeterministicFakeRunnerV1({ clock: () => CLOCK, ...runnerOptions });
  const verifier = new DeterministicTestAuthorityVerifierV1();
  const service = new SandboxesReferenceServiceV1({
    repository,
    runner,
    handle_sealer: new AesGcmProviderHandleSealerV1(new Uint8Array(32).fill(17)),
    authority_verifier: verifier,
    clock: () => CLOCK,
    allow_test_runner: true,
  });
  return { repository, runner, verifier, service };
}

export async function createInert(h: Harness, expiresAt?: string): Promise<SandboxV1> {
  const input = createInput(expiresAt);
  const request = createRequestDigest(input);
  const ctx = context("create_inert", oid("op", 20), request, 1n, 0, 1n, 20);
  return h.service.create(input, ctx);
}

export function activationGrant(sandbox: SandboxV1, operationId = oid("op", 21)): ActivationGrantV1 {
  const request = activationRequestDigest(sandbox.id, sandbox.spec.network_policy.policy_sha256);
  return {
    schema_version: SCHEMA_VERSION,
    grant_id: oid("grant", 21),
    resource_id: sandbox.id,
    resource_lifecycle_generation: sandbox.resource_lifecycle_generation,
    post_resource_lifecycle_generation: sandbox.resource_lifecycle_generation + 1n,
    operation_id: operationId,
    operation_digest: request,
    network_policy_sha256: sandbox.spec.network_policy.policy_sha256,
    expires_at: "2030-01-01T00:05:00.000Z",
    one_use_nonce_sha256: digest("activation-grant-nonce"),
  };
}

export async function activate(h: Harness, sandbox: SandboxV1): Promise<SandboxV1> {
  const grant = activationGrant(sandbox);
  const ctx = context(
    "activate",
    grant.operation_id,
    grant.operation_digest,
    sandbox.resource_lifecycle_generation,
    sandbox.revision,
    2n,
    21,
  );
  return h.service.activate(sandbox.id, grant, ctx);
}

export function checkpointReceipt(sandbox: SandboxV1): CheckpointDurabilityReceiptV1 {
  const checkpointFence = fence(oid("op", 30), digest("checkpoint-operation"), sandbox.resource_lifecycle_generation, 3n);
  return {
    schema_version: SCHEMA_VERSION,
    receipt_id: oid("receipt", 30),
    checkpoint_id: oid("checkpoint", 30),
    checkpoint_root_sha256: digest("checkpoint-root"),
    storage_version: "object-version-1",
    resource_id: sandbox.id,
    run_id: sandbox.run_id,
    attempt_id: sandbox.attempt_id,
    fence: checkpointFence,
    durable_at: "2030-01-01T00:01:00.000Z",
    issuer_principal: oid("principal", 31),
    receipt_sha256: digest("checkpoint-receipt"),
  };
}

export function cleanupGrant(
  sandbox: SandboxV1,
  basis: InfinityCleanupGrantV1["basis"],
  operationId = oid("op", 40),
): InfinityCleanupGrantV1 {
  if (sandbox.provider_handle_sha256 === undefined) throw new Error("fixture sandbox has no provider handle");
  const request = destroyRequestDigest(sandbox.id, basis.receipt_sha256);
  return {
    schema_version: SCHEMA_VERSION,
    grant_id: oid("grant", 40),
    resource_id: sandbox.id,
    resource_lifecycle_generation: sandbox.resource_lifecycle_generation,
    post_resource_lifecycle_generation: sandbox.resource_lifecycle_generation + 1n,
    provider_handle_sha256: sandbox.provider_handle_sha256,
    operation_id: operationId,
    operation_digest: request,
    cleanup_executor_principal: oid("principal", 11),
    basis,
    expires_at: "2030-01-01T00:05:00.000Z",
    one_use_nonce_sha256: digest("cleanup-grant-nonce"),
  };
}

export function cleanupContext(sandbox: SandboxV1, grant: InfinityCleanupGrantV1): MutationContextV1 {
  return context(
    "destroy",
    grant.operation_id,
    grant.operation_digest,
    sandbox.resource_lifecycle_generation,
    sandbox.revision,
    4n,
    40,
  );
}

export function expireContext(sandbox: SandboxV1): MutationContextV1 {
  const operationId = oid("op", 50);
  return context(
    "expire",
    operationId,
    expireRequestDigest(sandbox.id),
    sandbox.resource_lifecycle_generation,
    sandbox.revision,
    3n,
    50,
  );
}
