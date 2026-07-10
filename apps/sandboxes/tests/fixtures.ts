import { canonicalDigest, sha256, type Digest } from "../src/canonical.js";
import {
  EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
  EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
} from "../src/effect-journal.js";
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
  lifecycleRecordRequestDigest,
  SandboxesReferenceServiceV1,
} from "../src/service.js";
import {
  DeterministicTestAuthorityVerifierV1,
  DeterministicTestProviderDispatchJournalV1,
  DeterministicTestProviderReadProbeJournalV1,
  DeterministicTestPhysicalSafetyControllerV1,
  DeterministicTestProviderOutcomeJournalV1,
} from "../src/testing.js";
import {
  SCHEMA_VERSION,
  type ActivationGrantV1,
  type CanonicalSandboxEffectFenceV1,
  type CapabilityClaimsV1,
  type CheckpointDurabilityReceiptV1,
  type CreateSandboxV1,
  type InfinityCleanupGrantV1,
  type LifecycleCommandContextV1,
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
  immutableFingerprint = digest(`target-fingerprint-${seed}`),
  authorizationConsumptionReceipt?: Digest,
): MutationContextV1 {
  const fullFence = fence(operationId, requestSha256, generation + 1n, executionEpoch);
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
    successor_resource_lifecycle_generation: generation + 1n,
  };
  const capabilityUseReceipt = canonicalDigest({
    capability_id: capability.capability_id,
    nonce: capability.use_nonce_sha256,
  });
  const anchorBase = {
    schema_version: SCHEMA_VERSION,
    journal_anchor_id: oid("journal", seed),
    state: "dispatched" as const,
    record_kind: "DISPATCHED" as const,
    outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
    outcome_schema_digest: EFFECT_JOURNAL_OUTCOME_SCHEMA_DIGEST,
    operation_id: operationId,
    operation_step_id: oid("step", seed),
    operation_execution_epoch: executionEpoch,
    operation_digest: requestSha256,
    resource_id: oid("sbx", 4),
    authority_epoch: fullFence.authority_epoch,
    expected_resource_lifecycle_generation: generation,
    successor_resource_lifecycle_generation: generation + 1n,
    recorded_at: "2030-01-01T00:00:00.000Z",
    expires_at: "2030-01-01T00:05:00.000Z",
    issuer_principal: oid("principal", 99),
    provider_idempotency_token_sha256: digest(`provider-token-${seed}`),
    immutable_fingerprint_sha256: immutableFingerprint,
    authorization_consumption_receipt_sha256:
      authorizationConsumptionReceipt ?? capabilityUseReceipt,
    frontier_sha256: digest(`journal-frontier-${seed}`),
    fence: fullFence,
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

export function lifecycleContext(
  operation: SandboxOperation,
  operationId: string,
  requestSha256: Digest,
  generation: bigint,
  expectedRevision: number,
  executionEpoch: bigint,
  seed: number,
): LifecycleCommandContextV1 {
  const providerContext = context(
    operation,
    operationId,
    requestSha256,
    generation,
    expectedRevision,
    executionEpoch,
    seed,
  );
  const { dispatch_journal: _dispatchJournal, capability, ...base } = providerContext;
  const { dispatch_journal_anchor_sha256: _dispatchAnchor, ...lifecycleCapability } = capability;
  return { ...base, capability: lifecycleCapability };
}

export function retryContext(
  prior: MutationContextV1,
  expectedRevision: number,
  executionEpoch: bigint,
  seed: number,
): MutationContextV1 {
  const nextFence: CanonicalSandboxEffectFenceV1 = {
    ...prior.fence,
    operation_execution_epoch: executionEpoch,
  };
  const nextCapability: CapabilityClaimsV1 = {
    ...prior.capability,
    capability_id: oid("cap", seed),
    use_nonce_sha256: digest(`capability-nonce-${seed}`),
    dispatch_journal_anchor_sha256: digest("temporary-retry-anchor"),
    fence: nextFence,
  };
  const anchorBase = {
    ...prior.dispatch_journal,
    journal_anchor_id: oid("journal", seed),
    operation_execution_epoch: executionEpoch,
    frontier_sha256: digest(`journal-frontier-${seed}`),
    fence: nextFence,
    anchor_sha256: digest("temporary-retry-anchor"),
  };
  const nextDispatch = {
    ...anchorBase,
    anchor_sha256: dispatchedJournalAnchorDigest(anchorBase),
  };
  nextCapability.dispatch_journal_anchor_sha256 = nextDispatch.anchor_sha256;
  return {
    ...prior,
    expected_revision: expectedRevision,
    fence: nextFence,
    capability: nextCapability,
    dispatch_journal: nextDispatch,
  };
}

export interface Harness {
  repository: SandboxRepositoryV1;
  runner: DeterministicFakeRunnerV1;
  verifier: DeterministicTestAuthorityVerifierV1;
  physicalSafety: DeterministicTestPhysicalSafetyControllerV1;
  outcomeJournal: DeterministicTestProviderOutcomeJournalV1;
  dispatchJournal: DeterministicTestProviderDispatchJournalV1;
  readProbeJournal: DeterministicTestProviderReadProbeJournalV1;
  service: SandboxesReferenceServiceV1;
}

export function harness(
  repository: SandboxRepositoryV1 | undefined = undefined,
  runnerOptions: FakeRunnerOptionsV1 = {},
): Harness {
  const selectedRepository = repository ?? new InMemorySandboxRepositoryV1(() => CLOCK);
  const runner = new DeterministicFakeRunnerV1({ clock: () => CLOCK, ...runnerOptions });
  const verifier = new DeterministicTestAuthorityVerifierV1();
  const physicalSafety = new DeterministicTestPhysicalSafetyControllerV1();
  const outcomeJournal = new DeterministicTestProviderOutcomeJournalV1();
  const dispatchJournal = new DeterministicTestProviderDispatchJournalV1();
  const readProbeJournal = new DeterministicTestProviderReadProbeJournalV1();
  const service = new SandboxesReferenceServiceV1({
    repository: selectedRepository,
    runner,
    handle_sealer: new AesGcmProviderHandleSealerV1(new Uint8Array(32).fill(17)),
    authority_verifier: verifier,
    physical_safety_controller: physicalSafety,
    provider_outcome_journal: outcomeJournal,
    provider_dispatch_journal: dispatchJournal,
    provider_read_probe_journal: readProbeJournal,
    allow_test_runner: true,
  });
  return { repository: selectedRepository, runner, verifier, physicalSafety, outcomeJournal, dispatchJournal, readProbeJournal, service };
}

export async function createInert(h: Harness, expiresAt?: string): Promise<SandboxV1> {
  const input = createInput(expiresAt);
  const request = createRequestDigest(input);
  const ctx = context("begin_create_inert", oid("op", 20), request, 1n, 0, 1n, 20);
  const creating = await h.service.create(input, ctx);
  if (creating.pending_provider_outcome?.target_state !== "inert") return creating;
  const evidence = creating.pending_provider_outcome.evidence_sha256;
  const recordOperationId = oid("op", 120);
  const recordRequest = lifecycleRecordRequestDigest("record_inert", creating.id, evidence);
  const recordContext = lifecycleContext(
    "record_inert",
    recordOperationId,
    recordRequest,
    creating.resource_lifecycle_generation,
    creating.revision,
    2n,
    120,
  );
  return h.service.recordInert(creating.id, evidence, recordContext);
}

export function activationGrant(sandbox: SandboxV1, operationId = oid("op", 21)): ActivationGrantV1 {
  const request = activationRequestDigest(sandbox.id, sandbox.spec.network_policy.policy_sha256);
  return {
    schema_version: SCHEMA_VERSION,
    grant_id: oid("grant", 21),
    resource_id: sandbox.id,
    resource_lifecycle_generation: sandbox.resource_lifecycle_generation,
    successor_resource_lifecycle_generation: sandbox.resource_lifecycle_generation + 1n,
    operation_id: operationId,
    operation_digest: request,
    network_policy_sha256: sandbox.spec.network_policy.policy_sha256,
    expires_at: "2030-01-01T00:05:00.000Z",
    one_use_nonce_sha256: digest("activation-grant-nonce"),
  };
}

export async function activate(h: Harness, sandbox: SandboxV1): Promise<SandboxV1> {
  if (sandbox.immutable_fingerprint_sha256 === undefined) throw new Error("fixture has no fingerprint");
  const grant = activationGrant(sandbox);
  const ctx = context(
    "begin_activate",
    grant.operation_id,
    grant.operation_digest,
    sandbox.resource_lifecycle_generation,
    sandbox.revision,
    2n,
    21,
    sandbox.immutable_fingerprint_sha256,
    canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
  );
  const activating = await h.service.activate(sandbox.id, grant, ctx);
  if (activating.pending_provider_outcome?.target_state !== "active") return activating;
  const evidence = activating.pending_provider_outcome.evidence_sha256;
  const recordOperationId = oid("op", 121);
  const recordRequest = lifecycleRecordRequestDigest("record_active", activating.id, evidence);
  const recordContext = lifecycleContext(
    "record_active",
    recordOperationId,
    recordRequest,
    activating.resource_lifecycle_generation,
    activating.revision,
    3n,
    121,
  );
  return h.service.recordActive(activating.id, evidence, recordContext);
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
    successor_resource_lifecycle_generation: sandbox.resource_lifecycle_generation + 1n,
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
  if (sandbox.immutable_fingerprint_sha256 === undefined) throw new Error("fixture has no fingerprint");
  return context(
    "begin_destroy",
    grant.operation_id,
    grant.operation_digest,
    sandbox.resource_lifecycle_generation,
    sandbox.revision,
    4n,
    40,
    sandbox.immutable_fingerprint_sha256,
    canonicalDigest({ id: grant.grant_id, nonce: grant.one_use_nonce_sha256 }),
  );
}

export async function recordDestroyed(h: Harness, sandbox: SandboxV1): Promise<SandboxV1> {
  const pending = sandbox.pending_provider_outcome;
  if (pending?.target_state !== "destroyed") throw new Error("fixture has no anchored destroy outcome");
  const operationId = oid("op", 140);
  const request = lifecycleRecordRequestDigest("record_destroyed", sandbox.id, pending.evidence_sha256);
  const ctx = lifecycleContext(
    "record_destroyed",
    operationId,
    request,
    sandbox.resource_lifecycle_generation,
    sandbox.revision,
    5n,
    140,
  );
  return h.service.recordDestroyed(sandbox.id, pending.evidence_sha256, ctx);
}

export function expireContext(sandbox: SandboxV1): MutationContextV1 {
  if (sandbox.immutable_fingerprint_sha256 === undefined) throw new Error("fixture has no fingerprint");
  const operationId = oid("op", 50);
  return context(
    "expire",
    operationId,
    expireRequestDigest(sandbox.id),
    sandbox.resource_lifecycle_generation,
    sandbox.revision,
    3n,
    50,
    sandbox.immutable_fingerprint_sha256,
  );
}
