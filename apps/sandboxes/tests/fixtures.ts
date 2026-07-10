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
  effectJournalFrontierDigest,
  effectJournalRecordDigest,
  expireRequestDigest,
  lifecycleRecordRequestDigest,
  providerCreationTokenDigest,
  providerIdempotencyTokenDigest,
  SandboxesReferenceServiceV1,
} from "../src/service.js";
import { providerTargetFingerprintDigest } from "../src/provider-identity.js";
import {
  DeterministicTestAuthorityVerifierV1,
  DeterministicTestProviderDispatchJournalV1,
  DeterministicTestProviderReadProbeJournalV1,
  DeterministicTestProviderLifecycleLockV1,
  DeterministicTestJournalLedgerV1,
  DeterministicTestProviderJournalRecoveryV1,
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
  clock: Date = CLOCK,
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
    issued_at: new Date(clock.getTime() - 60_000).toISOString(),
    lease_expires_at: new Date(clock.getTime() + 3_600_000).toISOString(),
    operation_execution_expires_at: new Date(clock.getTime() + 300_000).toISOString(),
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
  immutableFingerprint?: Digest,
  authorizationConsumptionReceipt?: Digest,
  clock: Date = CLOCK,
  createBinding?: CreateSandboxV1,
): MutationContextV1 {
  const fullFence = fence(operationId, requestSha256, generation + 1n, executionEpoch, clock);
  const capability: CapabilityClaimsV1 = {
    schema_version: SCHEMA_VERSION,
    capability_id: oid("cap", seed),
    use_nonce_sha256: digest(`capability-nonce-${seed}`),
    operation,
    target_resource_id: oid("sbx", 4),
    request_sha256: requestSha256,
    dispatch_journal_anchor_sha256: digest("temporary-anchor"),
    fence: fullFence,
    not_before: new Date(clock.getTime() - 60_000).toISOString(),
    expires_at: new Date(clock.getTime() + 300_000).toISOString(),
  };
  const transition = {
    expected_resource_lifecycle_generation: generation,
    successor_resource_lifecycle_generation: generation + 1n,
  };
  const capabilityUseReceipt = canonicalDigest({
    capability_id: capability.capability_id,
    nonce: capability.use_nonce_sha256,
  });
  const creationInput = createBinding ?? createInput();
  const providerCreationToken = providerCreationTokenDigest({
    resource_id: oid("sbx", 4),
    resource_lease_id: fullFence.resource_lease_id,
    allocation_key_sha256: creationInput.allocation_key_sha256,
    spec_sha256: canonicalDigest(creationInput.spec),
  });
  const targetFingerprint = immutableFingerprint ?? providerTargetFingerprintDigest({
    adapter_id: "fake",
    adapter_version: "1.0.0-test",
    installation_id: "installation_00000000000000000000000000000001",
    provider_scope_ref: "fake-test-scope",
    resource_kind: "strong_vm",
    resource_id: oid("sbx", 4),
    resource_lease_id: fullFence.resource_lease_id,
    provider_creation_token_sha256: providerCreationToken,
    spec_sha256: canonicalDigest(creationInput.spec),
  });
  const dispatchRecordBase = {
    schema_version: SCHEMA_VERSION,
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
    recorded_at: clock.toISOString(),
    expires_at: new Date(clock.getTime() + 300_000).toISOString(),
    provider_creation_token_sha256: providerCreationToken,
    immutable_fingerprint_sha256: targetFingerprint,
    authorization_consumption_receipt_sha256:
      authorizationConsumptionReceipt ?? capabilityUseReceipt,
    fence: fullFence,
  };
  const dispatchRecord = {
    ...dispatchRecordBase,
    provider_idempotency_token_sha256: providerIdempotencyTokenDigest({
      operation_id: dispatchRecordBase.operation_id,
      operation_step_id: dispatchRecordBase.operation_step_id,
      operation_digest: dispatchRecordBase.operation_digest,
      resource_id: dispatchRecordBase.resource_id,
      provider_creation_token_sha256: dispatchRecordBase.provider_creation_token_sha256,
    }),
  };
  const anchorCore = {
    anchor_schema_version: "infinity.effect-journal-anchor/v1" as const,
    journal_sequence: BigInt(seed) * 10n + executionEpoch,
    prior_frontier_digest: digest(`journal-prior-frontier-${seed}-${executionEpoch}`),
    record_digest: effectJournalRecordDigest(dispatchRecord),
    signer_principal: oid("principal", 99),
    signing_key_id: oid("key", 98),
  };
  const dispatchJournal = {
    ...anchorCore,
    frontier_digest: effectJournalFrontierDigest(anchorCore),
    signature: "A".repeat(86),
    record: dispatchRecord,
  };
  capability.dispatch_journal_anchor_sha256 = dispatchedJournalAnchorDigest(dispatchJournal);
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
  clock: Date = CLOCK,
): LifecycleCommandContextV1 {
  const providerContext = context(
    operation,
    operationId,
    requestSha256,
    generation,
    expectedRevision,
    executionEpoch,
    seed,
    undefined,
    undefined,
    clock,
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
    journal_sequence: BigInt(seed) * 10n + executionEpoch,
    prior_frontier_digest: digest(`journal-prior-frontier-${seed}-${executionEpoch}`),
    record: {
      ...prior.dispatch_journal.record,
      operation_execution_epoch: executionEpoch,
      fence: nextFence,
    },
  };
  const nextDispatch = {
    ...anchorBase,
    record_digest: effectJournalRecordDigest(anchorBase.record),
    frontier_digest: effectJournalFrontierDigest({
      ...anchorBase,
      record_digest: effectJournalRecordDigest(anchorBase.record),
    }),
    signature: "B".repeat(86),
  };
  nextCapability.dispatch_journal_anchor_sha256 = dispatchedJournalAnchorDigest(nextDispatch);
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
  lifecycleLock: DeterministicTestProviderLifecycleLockV1;
  journalRecovery: DeterministicTestProviderJournalRecoveryV1;
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
  const journalLedger = new DeterministicTestJournalLedgerV1();
  verifier.current_journal_head = () => journalLedger.currentHead();
  const outcomeJournal = new DeterministicTestProviderOutcomeJournalV1(journalLedger);
  const dispatchJournal = new DeterministicTestProviderDispatchJournalV1(journalLedger);
  const readProbeJournal = new DeterministicTestProviderReadProbeJournalV1(journalLedger);
  const journalRecovery = new DeterministicTestProviderJournalRecoveryV1(journalLedger);
  const lifecycleLock = new DeterministicTestProviderLifecycleLockV1();
  const service = new SandboxesReferenceServiceV1({
    repository: selectedRepository,
    runner,
    handle_sealer: new AesGcmProviderHandleSealerV1(new Uint8Array(32).fill(17)),
    authority_verifier: verifier,
    physical_safety_controller: physicalSafety,
    provider_outcome_journal: outcomeJournal,
    provider_dispatch_journal: dispatchJournal,
    provider_read_probe_journal: readProbeJournal,
    provider_lifecycle_lock: lifecycleLock,
    provider_journal_recovery: journalRecovery,
    allow_test_runner: true,
  });
  return { repository: selectedRepository, runner, verifier, physicalSafety, outcomeJournal, dispatchJournal, readProbeJournal, lifecycleLock, journalRecovery, service };
}

export async function createInert(h: Harness, expiresAt?: string): Promise<SandboxV1> {
  const input = createInput(expiresAt);
  const request = createRequestDigest(input);
  const ctx = context(
    "begin_create_inert",
    oid("op", 20),
    request,
    1n,
    0,
    1n,
    20,
    undefined,
    undefined,
    CLOCK,
    input,
  );
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

function creationBindingForSandbox(sandbox: SandboxV1): CreateSandboxV1 {
  return {
    schema_version: SCHEMA_VERSION,
    resource_id: sandbox.id,
    allocation_key_sha256: digest("allocation"),
    spec: sandbox.spec,
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
    CLOCK,
    creationBindingForSandbox(sandbox),
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
    CLOCK,
    creationBindingForSandbox(sandbox),
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
    undefined,
    CLOCK,
    creationBindingForSandbox(sandbox),
  );
}
