import { sha256, type Digest } from "./canonical.js";
import { SandboxError } from "./errors.js";
import { adapterDescriptorDigest } from "./provider-identity.js";
import {
  SCHEMA_VERSION,
  type ActivationGrantV1,
  type ActivationReceiptV1,
  type AdapterDescriptorV1,
  type AdapterObservationV1,
  type AuthorizedBoundedCallContextV1,
  type BoundedOperationResultV1,
  type CheckpointExportHandoffV1,
  type CheckpointExportRequestV1,
  type DestroyObservationV1,
  type ExecCancelReceiptV1,
  type ExecCancelRequestV1,
  type ExecFramePageV1,
  type ExecFrameReadRequestV1,
  type ExecResultRequestV1,
  type ExecResultV1,
  type ExecStartReceiptV1,
  type ExecStartRequestV1,
  type ExpireObservationV1,
  type FileListPageV1,
  type FileListRequestV1,
  type FileReadReceiptV1,
  type FileReadRequestV1,
  type FileWriteReceiptV1,
  type FileWriteRequestV1,
  type FinalCurrentnessBarrierReceiptV1,
  type OwnedProviderHandleV1,
  type OwnedResourcePageV1,
  type ProviderOperationObservationV1,
  type ProviderNonAcceptanceProofV1,
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
  final_currentness_barrier_receipt_sha256: Digest;
  final_currentness_barrier?: FinalCurrentnessBarrierReceiptV1;
  adapter_descriptor_sha256: Digest;
  adapter_admission_receipt_sha256: Digest;
}

export interface DestroyContextV1 extends AdapterCallContextV1 {
  cleanup_grant_sha256: Digest;
  cleanup_basis_receipt_sha256: Digest;
}

export interface ReconcileContextV1 {
  installation_id: string;
  provider_scope_ref: string;
  resource_id: string;
  provider_creation_token_sha256: Digest;
  immutable_fingerprint_sha256: Digest;
  discovery_scope_receipt_sha256: Digest;
  complete_read_probe_envelope_sha256: Digest;
  read_probe_no_effect_receipt_sha256: Digest;
  max_pages: number;
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
  listOwnedResources(
    ctx: ReconcileContextV1,
    op: ProviderOperationV1,
    cursor?: string,
  ): Promise<OwnedResourcePageV1>;
  startExec(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: ExecStartRequestV1,
  ): Promise<ExecStartReceiptV1>;
  readExecFrames(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: ExecFrameReadRequestV1,
  ): Promise<ExecFramePageV1>;
  readExecResult(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: ExecResultRequestV1,
  ): Promise<ExecResultV1>;
  cancelExec(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: ExecCancelRequestV1,
  ): Promise<ExecCancelReceiptV1>;
  readFile(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileReadRequestV1,
  ): Promise<FileReadReceiptV1>;
  writeFile(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileWriteRequestV1,
  ): Promise<FileWriteReceiptV1>;
  listFiles(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileListRequestV1,
  ): Promise<FileListPageV1>;
  exportCheckpoint(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: CheckpointExportRequestV1,
  ): Promise<CheckpointExportHandoffV1>;
  reconcileBoundedOperation(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    operation: AuthorizedBoundedCallContextV1["operation"],
    request:
      | ExecStartRequestV1
      | ExecFrameReadRequestV1
      | ExecResultRequestV1
      | ExecCancelRequestV1
      | FileReadRequestV1
      | FileWriteRequestV1
      | FileListRequestV1
      | CheckpointExportRequestV1,
  ): Promise<BoundedOperationResultV1 | undefined>;
}

export class AmbiguousProviderEffectError extends Error {
  constructor() {
    super("Provider effect outcome is ambiguous");
    this.name = "AmbiguousProviderEffectError";
  }
}

/** Adapter may throw this only with durable proof that no provider effect was accepted. */
export class ProviderRejectedNoEffectError extends Error {
  readonly proof: ProviderNonAcceptanceProofV1 | undefined;

  constructor(proof?: ProviderNonAcceptanceProofV1) {
    super("Provider rejected the operation before accepting any effect");
    this.name = "ProviderRejectedNoEffectError";
    this.proof = proof === undefined ? undefined : structuredClone(proof);
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
      schema_version: SCHEMA_VERSION,
      adapter_id: this.adapterId,
      adapter_version: "pending",
      installation_id: `installation-${this.adapterId}-pending`,
      provider_scope_ref: `${this.adapterId}-pending-scope`,
      runtime_class: "strong_vm",
      supported_architectures: ["x86_64", "arm64"],
      isolation_evidence_sha256: sha256(`${this.adapterId}:pending:isolation`),
      guest_kernel_boundary_evidence_sha256: sha256(`${this.adapterId}:pending:kernel`),
      network_modes: ["deny_all", "broker_only"],
      network_enforcement_evidence_sha256: sha256(`${this.adapterId}:pending:network`),
      exact_operation_lookup: false,
      inert_create: false,
      whole_scope_cancel: false,
      native_bounded_files: false,
      read_only_workspace_enforcement: "external_read_only_mount",
      atomic_incarnation_bound_delete: false,
      ownership_reconciliation: "exact_token_and_incarnation",
      destructive_operation_semantics: "atomic_incarnation_bound_delete",
      provider_hard_ttl_semantics: "stop_only_no_delete",
      output_framing: "bounded_frames_v1",
      max_ttl_ms: 1,
      resource_limits: {
        max_processes: 1,
        max_memory_bytes: 1,
        max_disk_bytes: 1,
        max_output_bytes: 1,
        max_file_bytes: 1,
        max_page_entries: 1,
      },
    } as const;
    return {
      ...facts,
      build_sha256: sha256(`${this.adapterId}:pending`),
      status: "pending_conformance",
      descriptor_sha256: adapterDescriptorDigest({
        ...facts,
        build_sha256: sha256(`${this.adapterId}:pending`),
        status: "pending_conformance",
      }),
    };
  }

  async createInert(): Promise<never> { return this.#pending(); }
  async activate(): Promise<never> { return this.#pending(); }
  async inspect(): Promise<never> { return this.#pending(); }
  async expire(): Promise<never> { return this.#pending(); }
  async destroy(): Promise<never> { return this.#pending(); }
  async lookupOperation(): Promise<never> { return this.#pending(); }
  async listOwnedResources(): Promise<never> { return this.#pending(); }
  async startExec(): Promise<never> { return this.#pending(); }
  async readExecFrames(): Promise<never> { return this.#pending(); }
  async readExecResult(): Promise<never> { return this.#pending(); }
  async cancelExec(): Promise<never> { return this.#pending(); }
  async readFile(): Promise<never> { return this.#pending(); }
  async writeFile(): Promise<never> { return this.#pending(); }
  async listFiles(): Promise<never> { return this.#pending(); }
  async exportCheckpoint(): Promise<never> { return this.#pending(); }
  async reconcileBoundedOperation(): Promise<never> { return this.#pending(); }

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
