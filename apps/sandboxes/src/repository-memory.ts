import { SandboxError } from "./errors.js";
import type {
  RepositoryHealthV1,
  SandboxRepositoryTxV1,
  SandboxRepositoryV1,
} from "./repository.js";
import type {
  OperationRecordV1,
  ExternalOperationAnchorRecordV1,
  SandboxEventV1,
  SandboxV1,
  SealedProviderHandleV1,
} from "./types.js";

interface MemoryState {
  sandboxes: Map<string, SandboxV1>;
  handles: Map<string, SealedProviderHandleV1>;
  operations: Map<string, OperationRecordV1>;
  idempotency: Map<string, string>;
  capabilityUses: Map<string, string>;
  activationGrantUses: Map<string, string>;
  cleanupGrantUses: Map<string, string>;
  events: SandboxEventV1[];
  externalAnchors: ExternalOperationAnchorRecordV1[];
}

function freshState(): MemoryState {
  return {
    sandboxes: new Map(),
    handles: new Map(),
    operations: new Map(),
    idempotency: new Map(),
    capabilityUses: new Map(),
    activationGrantUses: new Map(),
    cleanupGrantUses: new Map(),
    events: [],
    externalAnchors: [],
  };
}

function key(actor: string, operation: string, resourceId: string, digest: string): string {
  return `${actor}\u0000${operation}\u0000${resourceId}\u0000${digest}`;
}

export class InMemorySandboxRepositoryV1 implements SandboxRepositoryV1 {
  readonly backend = "memory" as const;
  #state = freshState();
  readonly #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  migrate(): void {}

  databaseTime(): Date {
    return new Date(this.#clock().getTime());
  }

  transaction<T>(fn: (tx: SandboxRepositoryTxV1) => T): T {
    const snapshot = structuredClone(this.#state);
    try {
      return fn(this.#tx());
    } catch (error) {
      this.#state = snapshot;
      throw error;
    }
  }

  health(): RepositoryHealthV1 {
    return {
      backend: "memory",
      schema_version: 2,
      integrity: "ok",
      sandbox_count: this.#state.sandboxes.size,
      operation_count: this.#state.operations.size,
    };
  }

  close(): void {}

  #tx(): SandboxRepositoryTxV1 {
    const state = this.#state;
    return {
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
      findIdempotentOperation(actorPrincipal, operation, resourceId, idempotencyKeySha256) {
        const operationId = state.idempotency.get(key(actorPrincipal, operation, resourceId, idempotencyKeySha256));
        if (operationId === undefined) return undefined;
        const value = state.operations.get(operationId);
        return value === undefined ? undefined : structuredClone(value);
      },
      insertOperation(record) {
        if (state.operations.has(record.operation_id)) {
          throw new SandboxError("idempotency_key_reused", "Operation ID already exists");
        }
        const idempotencyKey = key(
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
        const conflict = state.externalAnchors.find(
          (candidate) =>
            candidate.operation_id === record.operation_id &&
            candidate.operation_step_id === record.operation_step_id &&
            candidate.kind === record.kind &&
            (record.kind === "dispatched" || candidate.anchor_sha256 === record.anchor_sha256),
        );
        if (conflict !== undefined) {
          if (
            conflict.anchor_sha256 !== record.anchor_sha256 ||
            conflict.frontier_sha256 !== record.frontier_sha256 ||
            conflict.payload_sha256 !== record.payload_sha256
          ) {
            throw new SandboxError("integrity_failed", "External anchor frontier conflict");
          }
          return;
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
      consumeActivationGrant(grantUseSha256, operationId) {
        const prior = state.activationGrantUses.get(grantUseSha256);
        if (prior !== undefined && prior !== operationId) {
          throw new SandboxError("capability_replayed", "Activation grant was already consumed");
        }
        state.activationGrantUses.set(grantUseSha256, operationId);
      },
      consumeCleanupGrant(grantUseSha256, operationId) {
        const prior = state.cleanupGrantUses.get(grantUseSha256);
        if (prior !== undefined && prior !== operationId) {
          throw new SandboxError("cleanup_grant_mismatch", "Cleanup grant was already consumed");
        }
        state.cleanupGrantUses.set(grantUseSha256, operationId);
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
