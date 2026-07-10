import { canonicalDigest, nowRfc3339, sha256, type Digest } from "./canonical.js";
import { SandboxError } from "./errors.js";
import {
  AmbiguousProviderEffectError,
  type AdapterCallContextV1,
  type DestroyContextV1,
  type ReconcileContextV1,
  type SandboxRunnerV1,
} from "./runner.js";
import {
  SCHEMA_VERSION,
  type ActivationGrantV1,
  type ActivationReceiptV1,
  type AdapterDescriptorV1,
  type AdapterObservationV1,
  type DestroyObservationV1,
  type ExpireObservationV1,
  type OwnedProviderHandleV1,
  type OwnedResourcePageV1,
  type ProviderOperationObservationV1,
  type ProviderOperationV1,
  type SandboxSpecV1,
} from "./types.js";

interface FakeResource {
  handle: OwnedProviderHandleV1;
  state: "inert" | "active" | "absent";
}

export interface FakeRunnerOptionsV1 {
  ambiguous_create?: "none" | "adoptable" | "unknown" | "delayed";
  destroy_result?: "absent" | "still_present" | "unknown";
  clock?: () => Date;
}

/** Hermetic-test-only runner; excluded from the production bundle and declarations. */
export class DeterministicFakeRunnerV1 implements SandboxRunnerV1 {
  readonly #resources = new Map<string, FakeResource>();
  readonly #operations = new Map<string, OwnedProviderHandleV1>();
  readonly #clock: () => Date;
  readonly #ambiguousCreate: "none" | "adoptable" | "unknown" | "delayed";
  readonly #delayedOperations = new Map<string, OwnedProviderHandleV1>();
  readonly #destroyResult: "absent" | "still_present" | "unknown";
  readonly calls = { create_inert: 0, activate: 0, inspect: 0, expire: 0, destroy: 0, lookup: 0 };
  readonly observed_generations: bigint[] = [];

  constructor(options: FakeRunnerOptionsV1 = {}) {
    this.#ambiguousCreate = options.ambiguous_create ?? "none";
    this.#destroyResult = options.destroy_result ?? "absent";
    this.#clock = options.clock ?? (() => new Date());
  }

  async descriptor(): Promise<AdapterDescriptorV1> {
    const facts = {
      adapter_id: "fake",
      adapter_version: "1.0.0-test",
      runtime_class: "strong_vm",
      network_modes: ["deny_all", "broker_only"],
      exact_operation_lookup: true,
      inert_create: true,
      whole_scope_cancel: true,
      native_bounded_files: true,
    } as const;
    return {
      schema_version: SCHEMA_VERSION,
      ...facts,
      build_sha256: sha256("deterministic-fake-runner-v1"),
      descriptor_sha256: canonicalDigest(facts),
      status: "test_only",
    };
  }

  async createInert(
    _ctx: AdapterCallContextV1,
    spec: SandboxSpecV1,
    op: ProviderOperationV1,
    allocationKey: Digest,
  ): Promise<OwnedProviderHandleV1> {
    this.#assertSink(_ctx, op);
    this.calls.create_inert += 1;
    this.observed_generations.push(op.fence.resource_lifecycle_generation);
    if (op.operation !== "create_inert") throw new SandboxError("validation_failed", "Wrong fake operation");
    const existing = this.#operations.get(op.fence.operation_id);
    if (existing !== undefined) return existing;
    const seed = sha256(`${allocationKey}:${op.fence.operation_id}`).slice(7, 39);
    const handle: OwnedProviderHandleV1 = {
      schema_version: SCHEMA_VERSION,
      adapter_id: "fake",
      adapter_version: "1.0.0-test",
      installation_id: "installation_00000000000000000000000000000001",
      provider_scope_ref: "fake-test-scope",
      resource_kind: "strong_vm",
      opaque_resource_id: `native-${seed}`,
      ownership_nonce: `nonce-${sha256(op.fence.resource_id).slice(7, 39)}`,
      create_inert_operation_id: op.fence.operation_id,
      provider_creation_token_sha256: sha256(`token:${op.fence.operation_id}`),
      creation_receipt_sha256: sha256(`creation:${op.fence.operation_id}`),
      provider_created_at: nowRfc3339(this.#clock()),
      provider_resource_version: "1",
      immutable_fingerprint_sha256: op.target.immutable_fingerprint_sha256,
      resource_lease_id: op.fence.resource_lease_id,
      resource_id: op.fence.resource_id,
      resource_lifecycle_generation: op.fence.resource_lifecycle_generation,
      spec_sha256: canonicalDigest(spec),
    };
    this.#resources.set(handle.resource_id, { handle, state: "inert" });
    if (this.#ambiguousCreate === "adoptable") this.#operations.set(op.fence.operation_id, handle);
    if (this.#ambiguousCreate === "delayed") this.#delayedOperations.set(op.fence.operation_id, handle);
    if (this.#ambiguousCreate !== "none") throw new AmbiguousProviderEffectError();
    this.#operations.set(op.fence.operation_id, handle);
    return handle;
  }

  async activate(
    _ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    grant: ActivationGrantV1,
    op: ProviderOperationV1,
  ): Promise<ActivationReceiptV1> {
    this.#assertSink(_ctx, op);
    this.calls.activate += 1;
    this.observed_generations.push(op.fence.resource_lifecycle_generation);
    const resource = this.#exact(handle);
    if (resource.state !== "inert" || op.operation !== "activate") {
      throw new SandboxError("provider_state_unknown", "Fake resource is not provably inert");
    }
    resource.state = "active";
    resource.handle = handle;
    return {
      schema_version: SCHEMA_VERSION,
      receipt_sha256: sha256(`activate:${op.fence.operation_id}`),
      immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
      network_policy_sha256: grant.network_policy_sha256,
      activated_at: nowRfc3339(this.#clock()),
    };
  }

  async inspect(
    _ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    _op: ProviderOperationV1,
  ): Promise<AdapterObservationV1> {
    this.#assertSink(_ctx, _op);
    this.calls.inspect += 1;
    const resource = this.#resources.get(handle.resource_id);
    if (resource === undefined || resource.state === "absent") return { state: "absent" };
    return {
      state: resource.state,
      immutable_fingerprint_sha256: resource.handle.immutable_fingerprint_sha256,
      provider_resource_version: resource.handle.provider_resource_version,
    };
  }

  async expire(
    _ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<ExpireObservationV1> {
    this.#assertSink(_ctx, op);
    this.calls.expire += 1;
    this.observed_generations.push(op.fence.resource_lifecycle_generation);
    const resource = this.#exact(handle);
    if (op.operation !== "expire") throw new SandboxError("validation_failed", "Wrong fake expire operation");
    resource.state = "inert";
    return { state: "quarantined", receipt_sha256: sha256(`expire:${op.fence.operation_id}`) };
  }

  async destroy(
    _ctx: DestroyContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<DestroyObservationV1> {
    this.#assertSink(_ctx, op);
    this.calls.destroy += 1;
    this.observed_generations.push(op.fence.resource_lifecycle_generation);
    const resource = this.#exact(handle);
    if (op.operation !== "destroy") throw new SandboxError("validation_failed", "Wrong fake destroy operation");
    if (this.#destroyResult === "absent") resource.state = "absent";
    return {
      state: this.#destroyResult,
      provider_receipt_sha256: sha256(`destroy:${op.fence.operation_id}:${this.#destroyResult}`),
      observed_at: nowRfc3339(this.#clock()),
    };
  }

  async lookupOperation(
    _ctx: ReconcileContextV1,
    op: ProviderOperationV1,
    _handle?: OwnedProviderHandleV1,
  ): Promise<ProviderOperationObservationV1> {
    this.calls.lookup += 1;
    const handle = this.#operations.get(op.fence.operation_id);
    if (handle !== undefined) {
      return {
        state: "completed",
        handle,
        observation_sha256: sha256(`lookup:completed:${op.fence.operation_id}`),
      };
    }
    const delayed = this.#delayedOperations.get(op.fence.operation_id);
    if (delayed !== undefined) {
      this.#delayedOperations.delete(op.fence.operation_id);
      this.#operations.set(op.fence.operation_id, delayed);
      return {
        state: "unknown",
        observation_sha256: sha256(`lookup:delayed:${op.fence.operation_id}`),
      };
    }
    return {
      state: this.#ambiguousCreate === "unknown" ? "unknown" : "not_found",
      observation_sha256: sha256(`lookup:${this.#ambiguousCreate}:${op.fence.operation_id}`),
    };
  }

  async listOwnedResources(_ctx: ReconcileContextV1, cursor?: string): Promise<OwnedResourcePageV1> {
    const resources = [...this.#resources.values()]
      .filter((resource) => resource.state !== "absent")
      .sort((a, b) => a.handle.resource_id.localeCompare(b.handle.resource_id))
      .map((resource) => ({
        resource_id: resource.handle.resource_id,
        immutable_fingerprint_sha256: resource.handle.immutable_fingerprint_sha256,
        state: resource.state,
      }));
    if (cursor === undefined) return { resources };
    const position = resources.findIndex((resource) => resource.resource_id === cursor);
    return { resources: position < 0 ? [] : resources.slice(position + 1) };
  }

  replaceFingerprint(resourceId: string): void {
    const resource = this.#resources.get(resourceId);
    if (resource !== undefined) {
      resource.handle = {
        ...resource.handle,
        immutable_fingerprint_sha256: sha256(`replacement:${resourceId}`),
        provider_resource_version: "replacement",
      };
    }
  }

  #exact(handle: OwnedProviderHandleV1): FakeResource {
    const resource = this.#resources.get(handle.resource_id);
    if (
      resource === undefined ||
      resource.handle.immutable_fingerprint_sha256 !== handle.immutable_fingerprint_sha256 ||
      resource.handle.provider_creation_token_sha256 !== handle.provider_creation_token_sha256
    ) {
      throw new SandboxError("provider_state_unknown", "Fake provider identity is not exact");
    }
    return resource;
  }

  #assertSink(ctx: AdapterCallContextV1, op: ProviderOperationV1): void {
    if (
      canonicalDigest(ctx.fence) !== canonicalDigest(op.fence) ||
      canonicalDigest(ctx.target) !== canonicalDigest(op.target) ||
      ctx.external_anchor_receipt_sha256 !== op.external_anchor_receipt_sha256 ||
      op.target.resource_lifecycle_generation !== op.fence.resource_lifecycle_generation ||
      op.target.operation_id !== op.fence.operation_id ||
      op.target.operation_digest !== op.fence.operation_digest
    ) {
      throw new SandboxError("integrity_failed", "Fake adapter sink rejected mismatched protected effect bytes");
    }
  }
}
