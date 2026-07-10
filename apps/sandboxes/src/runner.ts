import { canonicalDigest, sha256, type Digest } from "./canonical.js";
import { SandboxError } from "./errors.js";
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
  type ProviderEffectTargetV1,
  type ProviderOperationV1,
  type SandboxSpecV1,
} from "./types.js";

export interface AdapterCallContextV1 {
  trace_id: string;
  deadline: string;
  constraints_sha256: Digest;
  fence: import("./types.js").CanonicalSandboxEffectFenceV1;
  target: ProviderEffectTargetV1;
  external_anchor_receipt_sha256: Digest;
}

export interface DestroyContextV1 extends AdapterCallContextV1 {
  cleanup_grant_sha256: Digest;
}

export interface ReconcileContextV1 {
  installation_id: string;
  deadline: string;
}

export interface SandboxRunnerV1 {
  descriptor(): Promise<AdapterDescriptorV1>;
  createInert(
    ctx: AdapterCallContextV1,
    spec: SandboxSpecV1,
    op: ProviderOperationV1,
    allocationKey: Digest,
  ): Promise<OwnedProviderHandleV1>;
  activate(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    grant: ActivationGrantV1,
    op: ProviderOperationV1,
  ): Promise<ActivationReceiptV1>;
  inspect(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<AdapterObservationV1>;
  expire(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<ExpireObservationV1>;
  destroy(
    ctx: DestroyContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<DestroyObservationV1>;
  lookupOperation(
    ctx: ReconcileContextV1,
    op: ProviderOperationV1,
    handle?: OwnedProviderHandleV1,
  ): Promise<ProviderOperationObservationV1>;
  listOwnedResources(ctx: ReconcileContextV1, cursor?: string): Promise<OwnedResourcePageV1>;
}

export class AmbiguousProviderEffectError extends Error {
  constructor() {
    super("Provider effect outcome is ambiguous");
    this.name = "AmbiguousProviderEffectError";
  }
}

/** Adapter may throw this only with durable proof that no provider effect was accepted. */
export class ProviderRejectedNoEffectError extends Error {
  constructor() {
    super("Provider rejected the operation before accepting any effect");
    this.name = "ProviderRejectedNoEffectError";
  }
}

export class ProviderIdentityMismatchError extends Error {
  constructor() {
    super("Provider resource no longer matches the sealed immutable incarnation");
    this.name = "ProviderIdentityMismatchError";
  }
}

abstract class PendingManagedRunnerV1 implements SandboxRunnerV1 {
  abstract readonly adapterId: "e2b" | "daytona_cloud";

  async descriptor(): Promise<AdapterDescriptorV1> {
    const facts = {
      adapter_id: this.adapterId,
      adapter_version: "pending",
      runtime_class: "strong_vm",
      network_modes: ["deny_all", "broker_only"],
      exact_operation_lookup: false,
      inert_create: false,
      whole_scope_cancel: false,
      native_bounded_files: false,
    } as const;
    return {
      schema_version: SCHEMA_VERSION,
      ...facts,
      build_sha256: sha256(`${this.adapterId}:pending`),
      descriptor_sha256: canonicalDigest(facts),
      status: "pending_conformance",
    };
  }

  async createInert(): Promise<never> { return this.#pending(); }
  async activate(): Promise<never> { return this.#pending(); }
  async inspect(): Promise<never> { return this.#pending(); }
  async expire(): Promise<never> { return this.#pending(); }
  async destroy(): Promise<never> { return this.#pending(); }
  async lookupOperation(): Promise<never> { return this.#pending(); }
  async listOwnedResources(): Promise<never> { return this.#pending(); }

  #pending(): never {
    throw new SandboxError(
      "unsupported_runtime_feature",
      `${this.adapterId} is disabled pending the live zero-skip conformance gate`,
    );
  }
}

export class E2BRunnerPendingV1 extends PendingManagedRunnerV1 {
  readonly adapterId = "e2b" as const;
}

export class DaytonaCloudRunnerPendingV1 extends PendingManagedRunnerV1 {
  readonly adapterId = "daytona_cloud" as const;
}
