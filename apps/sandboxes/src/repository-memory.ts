import { SandboxError } from "./errors.js";
import type {
  RepositoryHealthV1,
  SandboxRepositoryTxV1,
  SandboxRepositoryV1,
} from "./repository.js";
import { assertExternalOperationAnchorRecordV1 } from "./repository.js";
import { assertDigest, assertOpaqueId, canonicalDigest } from "./canonical.js";
import type {
  CheckpointDurabilityReceiptV1,
  ExecStreamStateV1,
  GitPromotionReceiptRefV1,
  OperationRecordV1,
  ExternalOperationAnchorRecordV1,
  SandboxEventV1,
  SandboxDestroyTombstoneV1,
  SandboxV1,
  SealedProviderHandleV1,
  StoredSafetyFenceObservationV1,
} from "./types.js";

export interface SandboxRepositoryStateV1 {
  sandboxes: Map<string, SandboxV1>;
  handles: Map<string, SealedProviderHandleV1>;
  operations: Map<string, OperationRecordV1>;
  execStreamStates: Map<string, ExecStreamStateV1>;
  idempotency: Map<string, string>;
  capabilityUses: Map<string, string>;
  activationGrantUses: Map<string, string>;
  cleanupGrantUses: Map<string, string>;
  events: SandboxEventV1[];
  externalAnchors: ExternalOperationAnchorRecordV1[];
  safetyObservations: Map<string, StoredSafetyFenceObservationV1>;
  destroyTombstones: Map<string, SandboxDestroyTombstoneV1>;
  checkpointReceipts: Map<string, CheckpointDurabilityReceiptV1>;
  gitPromotionReceipts: Map<string, GitPromotionReceiptRefV1>;
}

export function createSandboxRepositoryStateV1(): SandboxRepositoryStateV1 {
  return {
    sandboxes: new Map(),
    handles: new Map(),
    operations: new Map(),
    execStreamStates: new Map(),
    idempotency: new Map(),
    capabilityUses: new Map(),
    activationGrantUses: new Map(),
    cleanupGrantUses: new Map(),
    events: [],
    externalAnchors: [],
    safetyObservations: new Map(),
    destroyTombstones: new Map(),
    checkpointReceipts: new Map(),
    gitPromotionReceipts: new Map(),
  };
}

export function operationIdempotencyKeyV1(actor: string, operation: string, resourceId: string, digest: string): string {
  return `${actor}\u0000${operation}\u0000${resourceId}\u0000${digest}`;
}

export class InMemorySandboxRepositoryV1 implements SandboxRepositoryV1 {
  readonly backend = "memory" as const;
  #state: SandboxRepositoryStateV1;
  readonly #clock: () => Date;

  constructor(
    clock: () => Date = () => new Date(),
    initialState: SandboxRepositoryStateV1 = createSandboxRepositoryStateV1(),
  ) {
    this.#clock = clock;
    this.#state = structuredClone(initialState);
  }

  exportPersistenceState(): SandboxRepositoryStateV1 {
    return structuredClone(this.#state);
  }

  migrate(): void {}

  async databaseTime(): Promise<Date> {
    return new Date(this.#clock().getTime());
  }

  async transaction<T>(fn: (tx: SandboxRepositoryTxV1) => T): Promise<T> {
    const snapshot = structuredClone(this.#state);
    try {
      const result = fn(this.#tx());
      if (
        result !== null &&
        typeof result === "object" &&
        "then" in result &&
        typeof (result as { then?: unknown }).then === "function"
      ) {
        throw new SandboxError("validation_failed", "Repository transaction callbacks must be synchronous");
      }
      return result;
    } catch (error) {
      this.#state = snapshot;
      throw error;
    }
  }

  async health(): Promise<RepositoryHealthV1> {
    return {
      backend: "memory",
      schema_version: 6,
      integrity: "ok",
      sandbox_count: this.#state.sandboxes.size,
      operation_count: this.#state.operations.size,
    };
  }

  async close(): Promise<void> {}

  #tx(): SandboxRepositoryTxV1 {
    const state = this.#state;
    const clock = this.#clock;
    return {
      databaseTime() {
        return new Date(clock().getTime());
      },
      getSandbox(resourceId) {
        const value = state.sandboxes.get(resourceId);
        return value === undefined ? undefined : structuredClone(value);
      },
      listSandboxes() {
        return [...state.sandboxes.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((value) => structuredClone(value));
      },
      putSandbox(record, expectedRevision) {
        const current = state.sandboxes.get(record.id);
        if (expectedRevision === null) {
          if (current !== undefined) throw new SandboxError("stale_revision", "Sandbox already exists");
          if (record.revision !== 1) throw new SandboxError("stale_revision", "Initial revision must be one");
        } else {
          if (current === undefined || current.revision !== expectedRevision || record.revision !== expectedRevision + 1) {
            throw new SandboxError("stale_revision", "Sandbox revision compare-and-swap failed");
          }
        }
        state.sandboxes.set(record.id, structuredClone(record));
      },
      getHandle(resourceId) {
        const value = state.handles.get(resourceId);
        return value === undefined ? undefined : structuredClone(value);
      },
      putHandle(handle) {
        state.handles.set(handle.resource_id, structuredClone(handle));
      },
      getOperation(operationId) {
        const value = state.operations.get(operationId);
        return value === undefined ? undefined : structuredClone(value);
      },
      getExecStreamState(resourceId, execId) {
        const value = state.execStreamStates.get(`${resourceId}\u0000${execId}`);
        return value === undefined ? undefined : structuredClone(value);
      },
      putExecStreamState(streamState) {
        state.execStreamStates.set(
          `${streamState.resource_id}\u0000${streamState.exec_id}`,
          structuredClone(streamState),
        );
      },
      findIdempotentOperation(actorPrincipal, operation, resourceId, idempotencyKeySha256) {
        const operationId = state.idempotency.get(operationIdempotencyKeyV1(actorPrincipal, operation, resourceId, idempotencyKeySha256));
        if (operationId === undefined) return undefined;
        const value = state.operations.get(operationId);
        return value === undefined ? undefined : structuredClone(value);
      },
      insertOperation(record) {
        if (state.operations.has(record.operation_id)) {
          throw new SandboxError("idempotency_key_reused", "Operation ID already exists");
        }
        const idempotencyKey = operationIdempotencyKeyV1(
          record.actor_principal,
          record.operation,
          record.resource_id,
          record.idempotency_key_sha256,
        );
        if (state.idempotency.has(idempotencyKey)) {
          throw new SandboxError("idempotency_key_reused", "Idempotency key already exists in this scope");
        }
        state.operations.set(record.operation_id, structuredClone(record));
        state.idempotency.set(idempotencyKey, record.operation_id);
      },
      updateOperation(record) {
        if (!state.operations.has(record.operation_id)) {
          throw new SandboxError("not_found", "Operation does not exist");
        }
        state.operations.set(record.operation_id, structuredClone(record));
      },
      compareAndSwapOperationPhase(operationId, expectedPhases, nextPhase, updatedAt) {
        const current = state.operations.get(operationId);
        if (current === undefined) throw new SandboxError("not_found", "Operation does not exist");
        if (!expectedPhases.includes(current.effect_phase)) {
          throw new SandboxError("stale_revision", "Operation effect phase compare-and-swap failed");
        }
        const next: OperationRecordV1 = { ...current, effect_phase: nextPhase, updated_at: updatedAt };
        state.operations.set(operationId, structuredClone(next));
        return structuredClone(next);
      },
      appendExternalAnchor(record) {
        assertExternalOperationAnchorRecordV1(record);
        const isReadProbe = "anchor_kind" in record;
        const sequenceRecord = state.externalAnchors.find(
          (candidate) => candidate.journal_sequence === record.journal_sequence,
        );
        if (
          sequenceRecord !== undefined &&
          (
            sequenceRecord.prior_frontier_digest !== record.prior_frontier_digest ||
            sequenceRecord.record_digest !== record.record_digest ||
            sequenceRecord.frontier_digest !== record.frontier_digest ||
            sequenceRecord.envelope_digest !== record.envelope_digest
          )
        ) {
          throw new SandboxError("integrity_failed", "External journal sequence or frontier changed bytes");
        }
        const conflict = state.externalAnchors.find(
          (candidate) =>
            candidate.operation_id === record.operation_id &&
            candidate.operation_step_id === record.operation_step_id &&
            candidate.operation_execution_epoch === record.operation_execution_epoch &&
            (isReadProbe
              ? "anchor_kind" in candidate && candidate.envelope_digest === record.envelope_digest
              : "record_kind" in candidate && candidate.record_kind === record.record_kind),
        );
        if (conflict !== undefined) {
          if (canonicalDigest(conflict) !== canonicalDigest(record)) {
            throw new SandboxError("integrity_failed", "Immutable effect journal identity changed bytes");
          }
          return;
        }
        if (!isReadProbe && record.record_kind === "OUTCOME") {
          const dispatched = state.externalAnchors.find(
            (candidate) =>
              candidate.operation_id === record.operation_id &&
              candidate.operation_step_id === record.operation_step_id &&
              candidate.operation_execution_epoch === record.operation_execution_epoch &&
              "record_kind" in candidate && candidate.record_kind === "DISPATCHED",
          );
          if (dispatched === undefined) {
            throw new SandboxError("integrity_failed", "OUTCOME has no matching immutable DISPATCHED record");
          }
        }
        if (!isReadProbe && record.record_kind === "DISPATCHED") {
          const priorDispatches = state.externalAnchors
            .filter(
              (candidate) =>
                candidate.operation_id === record.operation_id &&
                candidate.operation_step_id === record.operation_step_id &&
                "record_kind" in candidate && candidate.record_kind === "DISPATCHED",
            )
            .sort((a, b) => (a.operation_execution_epoch < b.operation_execution_epoch ? -1 : 1));
          const prior = priorDispatches.at(-1);
          if (prior !== undefined) {
            if (record.operation_execution_epoch !== prior.operation_execution_epoch + 1n) {
              throw new SandboxError("integrity_failed", "Effect execution epoch must advance by exactly one");
            }
            const priorOutcome = state.externalAnchors.find(
              (candidate) =>
                candidate.operation_id === prior.operation_id &&
                candidate.operation_step_id === prior.operation_step_id &&
                candidate.operation_execution_epoch === prior.operation_execution_epoch &&
                "record_kind" in candidate && candidate.record_kind === "OUTCOME",
            );
            if (
              priorOutcome === undefined ||
              !("record_kind" in priorOutcome) ||
              priorOutcome.record_kind !== "OUTCOME" ||
              priorOutcome.outcome_kind !== "failed_no_effect"
            ) {
              throw new SandboxError("provider_state_unknown", "Higher execution epoch requires authoritative failed_no_effect");
            }
          }
        }
        state.externalAnchors.push(structuredClone(record));
      },
      listExternalAnchors(operationId) {
        return state.externalAnchors
          .filter((record) => record.operation_id === operationId)
          .map((record) => structuredClone(record));
      },
      consumeCapabilityUse(capabilityUseSha256, operationId) {
        const prior = state.capabilityUses.get(capabilityUseSha256);
        if (prior !== undefined && prior !== operationId) {
          throw new SandboxError("capability_replayed", "Capability nonce was already consumed");
        }
        state.capabilityUses.set(capabilityUseSha256, operationId);
      },
      getCapabilityUseOperation(capabilityUseSha256) {
        return state.capabilityUses.get(capabilityUseSha256);
      },
      consumeActivationGrant(grantUseSha256, operationId) {
        const prior = state.activationGrantUses.get(grantUseSha256);
        if (prior !== undefined && prior !== operationId) {
          throw new SandboxError("capability_replayed", "Activation grant was already consumed");
        }
        state.activationGrantUses.set(grantUseSha256, operationId);
      },
      getActivationGrantUseOperation(grantUseSha256) {
        return state.activationGrantUses.get(grantUseSha256);
      },
      consumeCleanupGrant(grantUseSha256, operationId) {
        const prior = state.cleanupGrantUses.get(grantUseSha256);
        if (prior !== undefined && prior !== operationId) {
          throw new SandboxError("cleanup_grant_mismatch", "Cleanup grant was already consumed");
        }
        state.cleanupGrantUses.set(grantUseSha256, operationId);
      },
      getCleanupGrantUseOperation(grantUseSha256) {
        return state.cleanupGrantUses.get(grantUseSha256);
      },
      putCheckpointReceipt(receipt) {
        assertDigest(receipt.receipt_sha256, "checkpoint_receipt.receipt_sha256");
        if (!state.sandboxes.has(receipt.resource_id)) {
          throw new SandboxError("not_found", "Checkpoint receipt resource does not exist");
        }
        const existing = state.checkpointReceipts.get(receipt.receipt_sha256);
        if (existing !== undefined) {
          if (canonicalDigest(existing) !== canonicalDigest(receipt)) {
            throw new SandboxError("integrity_failed", "Immutable checkpoint receipt changed bytes");
          }
          return;
        }
        if ([...state.checkpointReceipts.values()].some((candidate) => candidate.receipt_id === receipt.receipt_id)) {
          throw new SandboxError("integrity_failed", "Checkpoint receipt identity conflicts with stored bytes");
        }
        state.checkpointReceipts.set(receipt.receipt_sha256, structuredClone(receipt));
      },
      getCheckpointReceipt(receiptSha256) {
        const value = state.checkpointReceipts.get(receiptSha256);
        return value === undefined ? undefined : structuredClone(value);
      },
      putGitPromotionReceipt(receipt) {
        assertDigest(receipt.receipt_sha256, "promotion_receipt.receipt_sha256");
        if (!state.sandboxes.has(receipt.resource_id)) {
          throw new SandboxError("not_found", "Promotion receipt resource does not exist");
        }
        const existing = state.gitPromotionReceipts.get(receipt.receipt_sha256);
        if (existing !== undefined) {
          if (canonicalDigest(existing) !== canonicalDigest(receipt)) {
            throw new SandboxError("integrity_failed", "Immutable promotion receipt changed bytes");
          }
          return;
        }
        if ([...state.gitPromotionReceipts.values()].some((candidate) => candidate.receipt_id === receipt.receipt_id)) {
          throw new SandboxError("integrity_failed", "Promotion receipt identity conflicts with stored bytes");
        }
        state.gitPromotionReceipts.set(receipt.receipt_sha256, structuredClone(receipt));
      },
      getGitPromotionReceipt(receiptSha256) {
        const value = state.gitPromotionReceipts.get(receiptSha256);
        return value === undefined ? undefined : structuredClone(value);
      },
      appendSafetyFenceObservation(record) {
        assertOpaqueId(record.observation_id, "safety_observation.observation_id", "observation");
        assertOpaqueId(record.resource_id, "safety_observation.resource_id", "sbx");
        assertDigest(record.observation_sha256, "safety_observation.observation_sha256");
        if (
          record.resource_id !== record.observation.resource_id ||
          record.observation_sha256 !== canonicalDigest(record.observation)
        ) {
          throw new SandboxError("integrity_failed", "Safety observation record bytes do not match their digest");
        }
        if (!state.sandboxes.has(record.resource_id)) {
          throw new SandboxError("not_found", "Safety observation resource does not exist");
        }
        const existing = state.safetyObservations.get(record.observation_id);
        if (existing !== undefined) {
          if (canonicalDigest(existing) !== canonicalDigest(record)) {
            throw new SandboxError("integrity_failed", "Immutable safety observation changed bytes");
          }
          return;
        }
        state.safetyObservations.set(record.observation_id, structuredClone(record));
      },
      listSafetyFenceObservations(resourceId) {
        return [...state.safetyObservations.values()]
          .filter((record) => record.resource_id === resourceId)
          .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at) || a.observation_id.localeCompare(b.observation_id))
          .map((record) => structuredClone(record));
      },
      putDestroyTombstone(record) {
        assertOpaqueId(record.tombstone_id, "destroy_tombstone.tombstone_id", "tombstone");
        assertOpaqueId(record.resource_id, "destroy_tombstone.resource_id", "sbx");
        assertDigest(record.tombstone_sha256, "destroy_tombstone.tombstone_sha256");
        const { tombstone_sha256: _digest, ...protectedBytes } = record;
        if (record.tombstone_sha256 !== canonicalDigest(protectedBytes)) {
          throw new SandboxError("integrity_failed", "Destroy tombstone digest does not match its protected bytes");
        }
        const sandbox = state.sandboxes.get(record.resource_id);
        if (sandbox?.state !== "destroyed") {
          throw new SandboxError("integrity_failed", "Destroy tombstone requires a terminal sandbox record");
        }
        const existing = state.destroyTombstones.get(record.resource_id);
        if (existing !== undefined) {
          if (canonicalDigest(existing) !== canonicalDigest(record)) {
            throw new SandboxError("integrity_failed", "Immutable destroy tombstone changed bytes");
          }
          return;
        }
        state.destroyTombstones.set(record.resource_id, structuredClone(record));
      },
      getDestroyTombstone(resourceId) {
        const value = state.destroyTombstones.get(resourceId);
        return value === undefined ? undefined : structuredClone(value);
      },
      appendEvent(event) {
        const sequence = state.events.reduce(
          (max, candidate) => candidate.resource_id === event.resource_id ? Math.max(max, candidate.sequence) : max,
          0,
        ) + 1;
        const complete = { ...event, sequence };
        state.events.push(structuredClone(complete));
        return complete;
      },
      listEvents(resourceId) {
        return state.events
          .filter((event) => event.resource_id === resourceId)
          .sort((a, b) => a.sequence - b.sequence)
          .map((event) => structuredClone(event));
      },
    };
  }
}
