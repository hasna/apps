import { assertDigest, canonicalDigest, nowRfc3339, sha256, type Digest } from "./canonical.js";
import { SandboxError } from "./errors.js";
import { HERMETIC_TEST_RUNNER } from "./hermetic-test-brand.js";
import {
  AmbiguousProviderEffectError,
  ProviderIdentityMismatchError,
  ProviderRejectedNoEffectError,
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
  type AuthorizedBoundedCallContextV1,
  type BoundedOperationResultV1,
  type CheckpointExportHandoffV1,
  type CheckpointExportRequestV1,
  type DestroyObservationV1,
  type ExecCancelReceiptV1,
  type ExecCancelRequestV1,
  type ExecFramePageV1,
  type ExecFrameReadRequestV1,
  type ExecFrameV1,
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
  type OwnedProviderHandleV1,
  type OwnedResourcePageV1,
  type ProviderOperationObservationV1,
  type ProviderOperationV1,
  type ProviderNonAcceptanceProofV1,
  type SandboxSpecV1,
} from "./types.js";
import {
  adapterConstraintsDigest,
  adapterDescriptorDigest,
  adapterTraceId,
  providerHandleIdentityDigest,
  providerNonAcceptanceProofDigest,
} from "./provider-identity.js";

interface FakeResource {
  handle: OwnedProviderHandleV1;
  state: "inert" | "active" | "absent";
}

interface FakeFile {
  bytes: Uint8Array;
  content_sha256: Digest;
  file_revision_sha256: Digest;
}

interface FakeWorkspace {
  revision: bigint;
  files: Map<string, FakeFile>;
}

interface FakeExec {
  resource_id: string;
  exec_id: string;
  state: ExecResultV1["state"];
  initial_cursor: string;
  next_cursor: string;
  adapter_exec_fingerprint_sha256: Digest;
  stdout: Uint8Array;
  frames_delivered: boolean;
  started_at: string;
  terminal_at: string | null;
  stream_root_sha256: Digest;
  last_frame_sha256: Digest;
}

export interface FakeRunnerOptionsV1 {
  ambiguous_create?: "none" | "adoptable" | "unknown" | "delayed";
  destroy_result?: "absent" | "still_present" | "unknown";
  creation_token_mismatch?: boolean;
  activation_fingerprint_mismatch?: boolean;
  activation_policy_mismatch?: boolean;
  reject_create_no_effect_attempts?: number;
  verified_reject_create_no_effect_attempts?: number;
  atomic_delete_unsupported?: boolean;
  resource_kind_override?: string;
  clock?: () => Date;
}

/** Hermetic-test-only runner; excluded from the production bundle and declarations. */
export class DeterministicFakeRunnerV1 implements SandboxRunnerV1 {
  readonly [HERMETIC_TEST_RUNNER] = true as const;
  readonly #resources = new Map<string, FakeResource>();
  readonly #operations = new Map<string, OwnedProviderHandleV1>();
  readonly #clock: () => Date;
  readonly #ambiguousCreate: "none" | "adoptable" | "unknown" | "delayed";
  readonly #delayedOperations = new Map<string, OwnedProviderHandleV1>();
  readonly #workspaces = new Map<string, FakeWorkspace>();
  readonly #execs = new Map<string, FakeExec>();
  readonly #boundedOutcomes = new Map<string, BoundedOperationResultV1>();
  readonly #destroyResult: "absent" | "still_present" | "unknown";
  readonly #creationTokenMismatch: boolean;
  readonly #activationFingerprintMismatch: boolean;
  readonly #activationPolicyMismatch: boolean;
  readonly #atomicDeleteUnsupported: boolean;
  readonly #resourceKindOverride: string | undefined;
  #remainingCreateNoEffectRejections: number;
  #remainingVerifiedCreateNoEffectRejections: number;
  #lastDescriptorSha256: Digest | undefined;
  readonly calls = {
    create_inert: 0,
    activate: 0,
    inspect: 0,
    expire: 0,
    destroy: 0,
    lookup: 0,
    start_exec: 0,
    read_exec_frames: 0,
    read_exec_result: 0,
    cancel_exec: 0,
    read_file: 0,
    write_file: 0,
    list_files: 0,
    export_checkpoint: 0,
  };
  readonly observed_generations: bigint[] = [];
  readonly observed_authorization_receipts: Digest[] = [];
  readonly observed_final_barrier_receipts: Digest[] = [];
  readonly observed_adapter_descriptor_receipts: Digest[] = [];
  readonly observed_adapter_admission_receipts: Digest[] = [];
  readonly observed_read_probe_no_effect_receipts: Digest[] = [];

  constructor(options: FakeRunnerOptionsV1 = {}) {
    this.#ambiguousCreate = options.ambiguous_create ?? "none";
    this.#destroyResult = options.destroy_result ?? "absent";
    this.#creationTokenMismatch = options.creation_token_mismatch === true;
    this.#activationFingerprintMismatch = options.activation_fingerprint_mismatch === true;
    this.#activationPolicyMismatch = options.activation_policy_mismatch === true;
    this.#atomicDeleteUnsupported = options.atomic_delete_unsupported === true;
    this.#resourceKindOverride = options.resource_kind_override;
    this.#remainingCreateNoEffectRejections = options.reject_create_no_effect_attempts ?? 0;
    this.#remainingVerifiedCreateNoEffectRejections =
      options.verified_reject_create_no_effect_attempts ?? 0;
    this.#clock = options.clock ?? (() => new Date());
  }

  async descriptor(): Promise<AdapterDescriptorV1> {
    const facts = {
      schema_version: SCHEMA_VERSION,
      adapter_id: "fake",
      adapter_version: "1.0.0-test",
      installation_id: "installation_00000000000000000000000000000001",
      provider_scope_ref: "fake-test-scope",
      runtime_class: "strong_vm",
      supported_architectures: ["x86_64", "arm64"],
      isolation_evidence_sha256: sha256("fake:isolation-evidence"),
      guest_kernel_boundary_evidence_sha256: sha256("fake:guest-kernel-boundary"),
      network_modes: ["deny_all", "broker_only"],
      network_enforcement_evidence_sha256: sha256("fake:network-enforcement"),
      exact_operation_lookup: true,
      inert_create: true,
      whole_scope_cancel: true,
      native_bounded_files: true,
      read_only_workspace_enforcement: "external_read_only_mount",
      atomic_incarnation_bound_delete: !this.#atomicDeleteUnsupported,
      ownership_reconciliation: "exact_token_and_incarnation",
      destructive_operation_semantics: "atomic_incarnation_bound_delete",
      provider_hard_ttl_semantics: "stop_only_no_delete",
      output_framing: "bounded_frames_v1",
      max_ttl_ms: 3_600_000,
      resource_limits: {
        max_processes: 512,
        max_memory_bytes: 8 * 1024 * 1024 * 1024,
        max_disk_bytes: 64 * 1024 * 1024 * 1024,
        max_output_bytes: 64 * 1024 * 1024,
        max_file_bytes: 64 * 1024 * 1024,
        max_page_entries: 1_000,
      },
    } as const;
    const protectedDescriptor = {
      ...facts,
      build_sha256: sha256("deterministic-fake-runner-v1"),
      status: "test_only" as const,
    };
    const descriptor: AdapterDescriptorV1 = {
      ...protectedDescriptor,
      descriptor_sha256: adapterDescriptorDigest(protectedDescriptor),
    };
    this.#lastDescriptorSha256 = descriptor.descriptor_sha256;
    return descriptor;
  }

  async createInert(
    _ctx: AdapterCallContextV1,
    spec: SandboxSpecV1,
    op: ProviderOperationV1,
    allocationKey: Digest,
  ): Promise<OwnedProviderHandleV1> {
    this.#assertSink(_ctx, op);
    const actualRequest = canonicalDigest({
      schema_version: SCHEMA_VERSION,
      resource_id: op.target.resource_id,
      allocation_key_sha256: allocationKey,
      spec,
    });
    const expectedCreationToken = canonicalDigest({
      schema_version: "sandboxes.provider-creation-token/v1",
      resource_id: op.target.resource_id,
      resource_lease_id: op.fence.resource_lease_id,
      allocation_key_sha256: allocationKey,
      spec_sha256: canonicalDigest(spec),
    });
    if (
      op.request_sha256 !== actualRequest ||
      op.target.operation_digest !== actualRequest ||
      op.target.provider_creation_token_sha256 !== expectedCreationToken
    ) {
      throw new SandboxError("request_digest_mismatch", "Fake create sink rejected unbound request, spec, or allocation bytes");
    }
    this.calls.create_inert += 1;
    this.observed_generations.push(op.fence.resource_lifecycle_generation);
    if (op.operation !== "create_inert") throw new SandboxError("validation_failed", "Wrong fake operation");
    if (this.#remainingCreateNoEffectRejections > 0) {
      this.#remainingCreateNoEffectRejections -= 1;
      throw new ProviderRejectedNoEffectError();
    }
    if (this.#remainingVerifiedCreateNoEffectRejections > 0) {
      this.#remainingVerifiedCreateNoEffectRejections -= 1;
      const proofBytes: Omit<ProviderNonAcceptanceProofV1, "proof_sha256" | "signature"> = {
        schema_version: "sandboxes.provider-no-effect-proof/v1",
        target: op.target,
        operation_execution_epoch: op.fence.operation_execution_epoch,
        request_sha256: op.request_sha256,
        provider_receipt_sha256: sha256(`provider-non-acceptance:${op.target.operation_id}`),
        proof_kind: "token_not_accepted",
        observed_at: nowRfc3339(this.#clock()),
        expires_at: op.deadline,
        issuer_principal: "principal_00000000000000000000000000000066",
        signing_key_id: "key_00000000000000000000000000000066",
      };
      throw new ProviderRejectedNoEffectError({
        ...proofBytes,
        proof_sha256: providerNonAcceptanceProofDigest(proofBytes),
        signature: "N".repeat(86),
      });
    }
    const existing = this.#operations.get(op.fence.operation_id);
    if (existing !== undefined) return existing;
    const seed = sha256(`${allocationKey}:${op.fence.operation_id}`).slice(7, 39);
    const handleWithoutIdentity: Omit<OwnedProviderHandleV1, "provider_identity_sha256"> = {
      schema_version: SCHEMA_VERSION,
      adapter_id: "fake",
      adapter_version: "1.0.0-test",
      installation_id: "installation_00000000000000000000000000000001",
      provider_scope_ref: "fake-test-scope",
      resource_kind: this.#resourceKindOverride ?? "strong_vm",
      opaque_resource_id: `native-${seed}`,
      ownership_nonce: `nonce-${sha256(op.fence.resource_id).slice(7, 39)}`,
      create_inert_operation_id: op.fence.operation_id,
      provider_creation_token_sha256: this.#creationTokenMismatch
        ? sha256(`mismatched-token:${op.fence.operation_id}`)
        : op.target.provider_creation_token_sha256,
      creation_receipt_sha256: sha256(`creation:${op.fence.operation_id}`),
      provider_created_at: nowRfc3339(this.#clock()),
      provider_resource_version: "1",
      immutable_fingerprint_sha256: op.target.immutable_fingerprint_sha256,
      resource_lease_id: op.fence.resource_lease_id,
      resource_id: op.fence.resource_id,
      resource_lifecycle_generation: op.fence.resource_lifecycle_generation,
      spec_sha256: canonicalDigest(spec),
    };
    const handle: OwnedProviderHandleV1 = {
      ...handleWithoutIdentity,
      provider_identity_sha256: providerHandleIdentityDigest(handleWithoutIdentity),
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
    if (
      op.request_sha256 !== canonicalDigest({
        schema_version: SCHEMA_VERSION,
        operation: "begin_activate",
        resource_id: handle.resource_id,
        network_policy_sha256: grant.network_policy_sha256,
      })
    ) {
      throw new SandboxError("request_digest_mismatch", "Fake activation sink rejected unbound grant bytes");
    }
    this.calls.activate += 1;
    this.observed_generations.push(op.fence.resource_lifecycle_generation);
    const resource = this.#exact(handle);
    if (resource.state !== "inert" || op.operation !== "activate") {
      throw new SandboxError("provider_state_unknown", "Fake resource is not provably inert");
    }
    resource.state = "active";
    resource.handle = handle;
    this.#operations.set(op.fence.operation_id, structuredClone(handle));
    return {
      schema_version: SCHEMA_VERSION,
      receipt_sha256: sha256(`activate:${op.fence.operation_id}`),
      immutable_fingerprint_sha256: this.#activationFingerprintMismatch
        ? sha256(`mismatched-activation-fingerprint:${handle.resource_id}`)
        : handle.immutable_fingerprint_sha256,
      network_policy_sha256: this.#activationPolicyMismatch
        ? sha256(`mismatched-activation-policy:${handle.resource_id}`)
        : grant.network_policy_sha256,
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
    this.#exact(handle);
    return {
      state: resource.state,
      handle: structuredClone(handle),
      immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
      provider_resource_version: handle.provider_resource_version,
    };
  }

  async expire(
    _ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<ExpireObservationV1> {
    this.#assertSink(_ctx, op);
    if (
      op.request_sha256 !== canonicalDigest({
        schema_version: SCHEMA_VERSION,
        operation: "expire",
        resource_id: handle.resource_id,
      })
    ) {
      throw new SandboxError("request_digest_mismatch", "Fake expiry sink rejected unbound request bytes");
    }
    this.calls.expire += 1;
    this.observed_generations.push(op.fence.resource_lifecycle_generation);
    const resource = this.#exact(handle);
    if (op.operation !== "expire") throw new SandboxError("validation_failed", "Wrong fake expire operation");
    resource.state = "inert";
    resource.handle = handle;
    this.#operations.set(op.fence.operation_id, structuredClone(handle));
    return { state: "quarantined", receipt_sha256: sha256(`expire:${op.fence.operation_id}`) };
  }

  async destroy(
    _ctx: DestroyContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<DestroyObservationV1> {
    this.#assertSink(_ctx, op);
    if (
      op.request_sha256 !== canonicalDigest({
        schema_version: SCHEMA_VERSION,
        operation: "begin_destroy",
        resource_id: handle.resource_id,
        basis_receipt_sha256: _ctx.cleanup_basis_receipt_sha256,
      })
    ) {
      throw new SandboxError("request_digest_mismatch", "Fake cleanup sink rejected unbound cleanup request bytes");
    }
    const resource = this.#exact(handle);
    this.calls.destroy += 1;
    this.observed_generations.push(op.fence.resource_lifecycle_generation);
    if (op.operation !== "destroy") throw new SandboxError("validation_failed", "Wrong fake destroy operation");
    if (this.#destroyResult === "absent") resource.state = "absent";
    if (this.#destroyResult !== "unknown") {
      this.#operations.set(op.fence.operation_id, structuredClone(handle));
    }
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
    this.#assertDiscoveryScope(_ctx, op);
    if (op.external_anchor_kind !== "READ_PROBE" || op.operation !== "inspect") {
      throw new SandboxError("integrity_failed", "Fake reconciliation read requires a READ_PROBE anchor");
    }
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

  async listOwnedResources(
    _ctx: ReconcileContextV1,
    op: ProviderOperationV1,
    cursor?: string,
  ): Promise<OwnedResourcePageV1> {
    this.#assertDiscoveryScope(_ctx, op);
    if (op.external_anchor_kind !== "READ_PROBE" || op.operation !== "inspect") {
      throw new SandboxError("integrity_failed", "Fake ownership enumeration requires a READ_PROBE anchor");
    }
    const resources = [...this.#resources.values()]
      .filter((resource) => resource.state !== "absent")
      .sort((a, b) => a.handle.resource_id.localeCompare(b.handle.resource_id))
      .map((resource) => ({
        resource_id: resource.handle.resource_id,
        installation_id: resource.handle.installation_id,
        provider_scope_ref: resource.handle.provider_scope_ref,
        opaque_resource_id: resource.handle.opaque_resource_id,
        ownership_nonce: resource.handle.ownership_nonce,
        provider_creation_token_sha256: resource.handle.provider_creation_token_sha256,
        immutable_fingerprint_sha256: resource.handle.immutable_fingerprint_sha256,
        state: resource.state,
      }));
    if (cursor === undefined) return { resources };
    const position = resources.findIndex((resource) => resource.resource_id === cursor);
    return { resources: position < 0 ? [] : resources.slice(position + 1) };
  }

  async startExec(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: ExecStartRequestV1,
  ): Promise<ExecStartReceiptV1> {
    this.#assertBoundedSink(ctx, handle, request, "exec.start");
    this.calls.start_exec += 1;
    if (this.#execs.has(request.exec_id)) {
      throw new SandboxError("idempotency_key_reused", "Fake exec ID is already allocated");
    }
    if ([...this.#execs.values()].some(
      (exec) => exec.resource_id === handle.resource_id && exec.state === "running",
    )) {
      throw new SandboxError("capacity_unavailable", "Fake sandbox already has its one running exec");
    }
    const adapterExecFingerprint = canonicalDigest({
      schema_version: "sandboxes.fake-exec-fingerprint/v1",
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      exec_id: request.exec_id,
      request_sha256: ctx.request_sha256,
    });
    const initialCursor = `cursor_${sha256(`initial:${request.exec_id}`).slice(7)}`;
    const nextCursor = `cursor_${sha256(`terminal:${request.exec_id}`).slice(7)}`;
    const initialCursorSha256 = sha256(initialCursor);
    const streamRootSha256 = canonicalDigest({
      exec_id: request.exec_id,
      cursor_sha256: initialCursorSha256,
    });
    const startedAt = nowRfc3339(this.#clock());
    const stdout = Buffer.from(request.argv.at(-1) ?? "", "utf8");
    this.#execs.set(request.exec_id, {
      resource_id: handle.resource_id,
      exec_id: request.exec_id,
      state: "running",
      initial_cursor: initialCursor,
      next_cursor: nextCursor,
      adapter_exec_fingerprint_sha256: adapterExecFingerprint,
      stdout,
      frames_delivered: false,
      started_at: startedAt,
      terminal_at: null,
      stream_root_sha256: streamRootSha256,
      last_frame_sha256: streamRootSha256,
    });
    const facts = {
      schema_version: "sandboxes.exec-start-receipt/v1" as const,
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      exec_id: request.exec_id,
      request_sha256: ctx.request_sha256,
      state: "running" as const,
      initial_cursor: initialCursor,
      initial_cursor_sha256: initialCursorSha256,
      stream_root_sha256: streamRootSha256,
      adapter_exec_fingerprint_sha256: adapterExecFingerprint,
      started_at: startedAt,
    };
    return this.#rememberBounded(ctx, { ...facts, receipt_sha256: canonicalDigest(facts) });
  }

  async readExecFrames(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: ExecFrameReadRequestV1,
  ): Promise<ExecFramePageV1> {
    this.#assertBoundedSink(ctx, handle, request, "exec.frames.read");
    this.calls.read_exec_frames += 1;
    const exec = this.#mustExec(handle, request.exec_id);
    if (request.cursor !== exec.initial_cursor || exec.frames_delivered) {
      throw new SandboxError("integrity_failed", "Fake frame cursor is stale, guessed, or replayed");
    }
    const terminalAt = nowRfc3339(this.#clock());
    const priorStreamRootSha256 = canonicalDigest({
      exec_id: request.exec_id,
      cursor_sha256: sha256(request.cursor),
    });
    const frames: ExecFrameV1[] = [];
    let priorFrameSha256 = priorStreamRootSha256;
    if (exec.stdout.byteLength > 0) {
      const frame = this.#frame(exec, 1n, priorFrameSha256, "stdout", exec.stdout, terminalAt);
      frames.push(frame);
      priorFrameSha256 = frame.frame_sha256;
    }
    const terminalFrame = this.#frame(
      exec,
      BigInt(frames.length + 1),
      priorFrameSha256,
      "terminal",
      new Uint8Array(),
      terminalAt,
    );
    frames.push(terminalFrame);
    const returnedBytes = frames.reduce((total, frame) => total + frame.payload_length, 0);
    if (frames.length > request.max_frames || returnedBytes > request.max_bytes) {
      throw new SandboxError("resource_limit_exceeded", "Fake frame page exceeds the caller bound");
    }
    exec.frames_delivered = true;
    exec.state = "succeeded";
    exec.terminal_at = terminalAt;
    exec.last_frame_sha256 = terminalFrame.frame_sha256;
    const pageFramesRootSha256 = canonicalDigest(frames.map((frame) => frame.frame_sha256));
    const nextCursorSha256 = sha256(exec.next_cursor);
    const resumeTokenSha256 = canonicalDigest({
      exec_id: exec.exec_id,
      prior_stream_root_sha256: priorStreamRootSha256,
      page_frames_root_sha256: pageFramesRootSha256,
      next_cursor_sha256: nextCursorSha256,
    });
    const nextStreamRootSha256 = canonicalDigest({
      prior_stream_root_sha256: priorStreamRootSha256,
      page_frames_root_sha256: pageFramesRootSha256,
      resume_token_sha256: resumeTokenSha256,
    });
    exec.stream_root_sha256 = nextStreamRootSha256;
    const facts = {
      schema_version: "sandboxes.exec-frame-page/v1" as const,
      exec_id: exec.exec_id,
      from_cursor_sha256: sha256(request.cursor),
      prior_stream_root_sha256: priorStreamRootSha256,
      frames,
      page_frames_root_sha256: pageFramesRootSha256,
      next_cursor: exec.next_cursor,
      next_cursor_sha256: nextCursorSha256,
      resume_token_sha256: resumeTokenSha256,
      next_stream_root_sha256: nextStreamRootSha256,
      has_more: false,
      terminal: true,
      gap_detected: false as const,
      gap_proof_sha256: canonicalDigest({
        gap_detected: false,
        prior_stream_root_sha256: priorStreamRootSha256,
        next_stream_root_sha256: nextStreamRootSha256,
      }),
      returned_frames: frames.length,
      returned_bytes: returnedBytes,
    };
    return this.#rememberBounded(ctx, { ...facts, receipt_sha256: canonicalDigest(facts) });
  }

  async readExecResult(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: ExecResultRequestV1,
  ): Promise<ExecResultV1> {
    this.#assertBoundedSink(ctx, handle, request, "exec.result.read");
    this.calls.read_exec_result += 1;
    const exec = this.#mustExec(handle, request.exec_id);
    const facts = {
      schema_version: "sandboxes.exec-result/v1" as const,
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      exec_id: exec.exec_id,
      state: exec.state,
      exit_code: exec.state === "succeeded" ? 0 : exec.state === "failed" ? 1 : null,
      stdout_sha256: sha256(exec.stdout),
      stderr_sha256: sha256(new Uint8Array()),
      output_bytes: exec.stdout.byteLength,
      final_stream_root_sha256: exec.stream_root_sha256,
      terminal_at: exec.terminal_at,
    };
    return this.#rememberBounded(ctx, { ...facts, receipt_sha256: canonicalDigest(facts) });
  }

  async cancelExec(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: ExecCancelRequestV1,
  ): Promise<ExecCancelReceiptV1> {
    this.#assertBoundedSink(ctx, handle, request, "exec.cancel");
    this.calls.cancel_exec += 1;
    const exec = this.#mustExec(handle, request.exec_id);
    const wasRunning = exec.state === "running";
    const observedAt = nowRfc3339(this.#clock());
    if (wasRunning) {
      exec.state = "canceled";
      exec.terminal_at = observedAt;
    }
    const facts = {
      schema_version: "sandboxes.exec-cancel-receipt/v1" as const,
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      exec_id: exec.exec_id,
      state: wasRunning ? "canceled" as const : "already_terminal" as const,
      whole_scope_terminated: wasRunning,
      process_stop_evidence_sha256: sha256(`cancel:${exec.exec_id}:${wasRunning}`),
      observed_at: observedAt,
    };
    return this.#rememberBounded(ctx, { ...facts, receipt_sha256: canonicalDigest(facts) });
  }

  async readFile(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileReadRequestV1,
  ): Promise<FileReadReceiptV1> {
    this.#assertBoundedSink(ctx, handle, request, "file.read");
    this.calls.read_file += 1;
    const workspace = this.#workspace(handle);
    const file = workspace.files.get(request.path);
    if (file === undefined) throw new SandboxError("not_found", "Fake workspace file does not exist");
    if (file.content_sha256 !== request.expected_file_sha256) {
      throw new SandboxError("stale_file_digest", "Fake workspace file digest changed");
    }
    const bytes = file.bytes.slice(request.offset_bytes, request.offset_bytes + request.length_bytes);
    const facts = {
      schema_version: "sandboxes.file-read-receipt/v1" as const,
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      workspace_revision: workspace.revision,
      path: request.path,
      offset_bytes: request.offset_bytes,
      content_base64url: Buffer.from(bytes).toString("base64url"),
      returned_bytes: bytes.byteLength,
      content_sha256: sha256(bytes),
      total_file_sha256: file.content_sha256,
      range_proof_sha256: canonicalDigest({
        total_file_sha256: file.content_sha256,
        offset_bytes: request.offset_bytes,
        content_sha256: sha256(bytes),
        returned_bytes: bytes.byteLength,
      }),
      file_revision_sha256: file.file_revision_sha256,
    };
    return this.#rememberBounded(ctx, { ...facts, receipt_sha256: canonicalDigest(facts) });
  }

  async writeFile(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileWriteRequestV1,
  ): Promise<FileWriteReceiptV1> {
    this.#assertBoundedSink(ctx, handle, request, "file.write");
    this.calls.write_file += 1;
    const workspace = this.#workspace(handle);
    const prior = workspace.files.get(request.path);
    if ((prior?.content_sha256 ?? null) !== request.expected_prior_sha256) {
      throw new SandboxError("stale_file_digest", "Fake workspace write precondition failed");
    }
    const bytes = Buffer.from(request.content_base64url, "base64url");
    if (bytes.byteLength > request.max_bytes || sha256(bytes) !== request.content_sha256) {
      throw new SandboxError("integrity_failed", "Fake workspace write bytes failed their bound or digest");
    }
    const before = workspace.revision;
    const after = before + 1n;
    const fileRevision = canonicalDigest({
      schema_version: "sandboxes.fake-file-revision/v1",
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      workspace_revision: after,
      path: request.path,
      content_sha256: request.content_sha256,
    });
    workspace.files.set(request.path, {
      bytes,
      content_sha256: request.content_sha256,
      file_revision_sha256: fileRevision,
    });
    workspace.revision = after;
    const facts = {
      schema_version: "sandboxes.file-write-receipt/v1" as const,
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      workspace_revision_before: before,
      workspace_revision_after: after,
      path: request.path,
      prior_sha256: prior?.content_sha256 ?? null,
      content_sha256: request.content_sha256,
      byte_length: bytes.byteLength,
      file_revision_sha256: fileRevision,
    };
    return this.#rememberBounded(ctx, { ...facts, receipt_sha256: canonicalDigest(facts) });
  }

  async listFiles(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileListRequestV1,
  ): Promise<FileListPageV1> {
    this.#assertBoundedSink(ctx, handle, request, "file.list");
    this.calls.list_files += 1;
    const workspace = this.#workspace(handle);
    if (request.cursor !== null) {
      throw new SandboxError("validation_failed", "Fake workspace accepts only its initial null list cursor");
    }
    const prefix = request.root === "" ? "" : `${request.root}/`;
    const entries = [...workspace.files.entries()]
      .filter(([entryPath]) => entryPath === request.root || entryPath.startsWith(prefix))
      .filter(([entryPath]) => request.recursive || !entryPath.slice(prefix.length).includes("/"))
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, request.limit)
      .map(([entryPath, file]) => ({
        path: entryPath,
        type: "file" as const,
        size_bytes: file.bytes.byteLength,
        content_sha256: file.content_sha256,
        file_revision_sha256: file.file_revision_sha256,
      }));
    const facts = {
      schema_version: "sandboxes.file-list-page/v1" as const,
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      workspace_revision: workspace.revision,
      snapshot_sha256: canonicalDigest({ workspace_revision: workspace.revision, entries }),
      entries,
      next_cursor: null,
    };
    return this.#rememberBounded(ctx, { ...facts, receipt_sha256: canonicalDigest(facts) });
  }

  async exportCheckpoint(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: CheckpointExportRequestV1,
  ): Promise<CheckpointExportHandoffV1> {
    this.#assertBoundedSink(ctx, handle, request, "checkpoint.export_bundle");
    this.calls.export_checkpoint += 1;
    const workspace = this.#workspace(handle);
    if (request.expected_workspace_revision !== workspace.revision) {
      throw new SandboxError("stale_revision", "Fake checkpoint workspace revision changed");
    }
    const manifest = request.allowed_paths.map((entryPath) => {
      const file = workspace.files.get(entryPath);
      if (file === undefined) throw new SandboxError("not_found", "Checkpoint path does not exist");
      return {
        path: entryPath,
        size_bytes: file.bytes.byteLength,
        content_sha256: file.content_sha256,
        file_revision_sha256: file.file_revision_sha256,
      };
    });
    const totalBytes = manifest.reduce((total, entry) => total + entry.size_bytes, 0);
    if (totalBytes > request.maximum_bundle_bytes) {
      throw new SandboxError("resource_limit_exceeded", "Checkpoint candidate exceeds its bundle bound");
    }
    const manifestSha256 = canonicalDigest({
      schema_version: "sandboxes.fake-checkpoint-manifest/v1",
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      workspace_revision: workspace.revision,
      entries: manifest,
    });
    const workspaceRootSha256 = canonicalDigest(manifest.map((entry) => entry.content_sha256));
    const checkpointRootSha256 = canonicalDigest({
      checkpoint_id: request.checkpoint_id,
      manifest_sha256: manifestSha256,
      workspace_root_sha256: workspaceRootSha256,
      sink_descriptor_sha256: request.sink_descriptor_sha256,
    });
    const exportedAt = nowRfc3339(this.#clock());
    if (
      request.capture_grant.operation_id !== ctx.operation_id ||
      request.capture_mode !== "quiesced"
    ) {
      throw new SandboxError("capability_denied", "Fake checkpoint capture grant does not bind the operation");
    }
    const bundleSha256 = canonicalDigest(manifest);
    const quiescenceFacts = {
      schema_version: "sandboxes.checkpoint-quiescence-receipt/v1" as const,
      checkpoint_id: request.checkpoint_id,
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      workspace_revision: workspace.revision,
      active_exec_count: 0 as const,
      capture_grant_sha256: request.capture_grant.grant_sha256,
      final_authorization_receipt_sha256: ctx.authorization_consumption_set_sha256,
      quiesced_at: exportedAt,
    };
    const quiescenceReceipt = {
      ...quiescenceFacts,
      receipt_sha256: canonicalDigest(quiescenceFacts),
    };
    const sinkCommitFacts = {
      schema_version: "sandboxes.checkpoint-sink-commit-receipt/v1" as const,
      checkpoint_id: request.checkpoint_id,
      sink_descriptor_sha256: request.sink_descriptor_sha256,
      manifest_blob_sha256: manifestSha256,
      bundle_sha256: bundleSha256,
      bundle_byte_length: totalBytes,
      storage_version: `fake-object-${checkpointRootSha256.slice(7, 23)}`,
      committed_at: exportedAt,
      issuer_principal: `principal_${"7000".padStart(32, "0")}`,
      signing_key_id: `key_${"7000".padStart(32, "0")}`,
    };
    const sinkCommitReceipt = {
      ...sinkCommitFacts,
      receipt_sha256: canonicalDigest(sinkCommitFacts),
      signature: "A".repeat(86),
    };
    const facts = {
      schema_version: "sandboxes.checkpoint-export-handoff/v1" as const,
      handoff_id: `handoff_${checkpointRootSha256.slice(7, 39)}`,
      checkpoint_id: request.checkpoint_id,
      resource_id: handle.resource_id,
      resource_lifecycle_generation: handle.resource_lifecycle_generation,
      workspace_revision: workspace.revision,
      manifest_sha256: manifestSha256,
      workspace_root_sha256: workspaceRootSha256,
      checkpoint_root_sha256: checkpointRootSha256,
      bundle_sha256: bundleSha256,
      bundle_byte_length: totalBytes,
      file_count: manifest.length,
      fence_sha256: canonicalDigest(ctx.fence),
      final_authorization_receipt_sha256: ctx.authorization_consumption_set_sha256,
      capture_grant_sha256: request.capture_grant.grant_sha256,
      quiescence_receipt: quiescenceReceipt,
      quiescence_receipt_sha256: quiescenceReceipt.receipt_sha256,
      manifest_blob_sha256: manifestSha256,
      sink_descriptor_sha256: request.sink_descriptor_sha256,
      sink_commit_receipt: sinkCommitReceipt,
      sink_commit_receipt_sha256: sinkCommitReceipt.receipt_sha256,
      durability_state: "durable" as const,
      exported_at: exportedAt,
    };
    return this.#rememberBounded(ctx, { ...facts, handoff_sha256: canonicalDigest(facts) });
  }

  async reconcileBoundedOperation(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    operation: AuthorizedBoundedCallContextV1["operation"],
    request: Parameters<SandboxRunnerV1["reconcileBoundedOperation"]>[3],
  ): Promise<BoundedOperationResultV1 | undefined> {
    this.#assertBoundedSink(ctx, handle, request, operation);
    const result = this.#boundedOutcomes.get(ctx.operation_id);
    return result === undefined ? undefined : structuredClone(result);
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

  #workspace(handle: OwnedProviderHandleV1): FakeWorkspace {
    const resource = this.#exact(handle);
    if (resource.state !== "active") {
      throw new SandboxError("sandbox_not_active", "Fake workspace requires an active sandbox");
    }
    let workspace = this.#workspaces.get(handle.resource_id);
    if (workspace === undefined) {
      workspace = { revision: 1n, files: new Map() };
      this.#workspaces.set(handle.resource_id, workspace);
    }
    return workspace;
  }

  #mustExec(handle: OwnedProviderHandleV1, execId: string): FakeExec {
    const resource = this.#exact(handle);
    if (resource.state !== "active") {
      throw new SandboxError("sandbox_not_active", "Fake exec requires an active sandbox");
    }
    const exec = this.#execs.get(execId);
    if (exec === undefined || exec.resource_id !== handle.resource_id) {
      throw new SandboxError("not_found", "Fake exec does not exist for this sandbox");
    }
    return exec;
  }

  #frame(
    exec: FakeExec,
    sequence: bigint,
    priorFrameSha256: Digest,
    kind: ExecFrameV1["kind"],
    payload: Uint8Array,
    observedAt: string,
  ): ExecFrameV1 {
    const facts = {
      schema_version: "sandboxes.exec-frame/v1" as const,
      exec_id: exec.exec_id,
      sequence,
      prior_frame_sha256: priorFrameSha256,
      kind,
      payload_base64url: Buffer.from(payload).toString("base64url"),
      payload_length: payload.byteLength,
      payload_sha256: sha256(payload),
      observed_at: observedAt,
    };
    return { ...facts, frame_sha256: canonicalDigest(facts) };
  }

  #rememberBounded<T extends BoundedOperationResultV1>(
    ctx: AuthorizedBoundedCallContextV1,
    result: T,
  ): T {
    this.#boundedOutcomes.set(ctx.operation_id, structuredClone(result));
    return result;
  }

  #assertBoundedSink(
    ctx: AuthorizedBoundedCallContextV1,
    handle: OwnedProviderHandleV1,
    request: { handle: import("./types.js").SandboxHandleRefV1 },
    operation: AuthorizedBoundedCallContextV1["operation"],
  ): void {
    const keys = new Set([
      "schema_version", "operation", "operation_id", "request_sha256",
      "authorization_consumption_set_sha256", "handle", "fence", "deadline",
    ]);
    if (
      Object.keys(ctx).length !== keys.size ||
      Object.keys(ctx).some((key) => !keys.has(key)) ||
      ctx.schema_version !== "sandboxes.authorized-bounded-call/v1" ||
      ctx.operation !== operation ||
      ctx.operation_id !== ctx.fence.operation_id ||
      ctx.request_sha256 !== ctx.fence.operation_digest ||
      ctx.request_sha256 !== canonicalDigest(request) ||
      ctx.deadline !== ctx.fence.operation_execution_expires_at ||
      canonicalDigest(ctx.handle) !== canonicalDigest(request.handle) ||
      ctx.handle.resource_id !== handle.resource_id ||
      ctx.handle.resource_lease_id !== handle.resource_lease_id ||
      ctx.handle.resource_lifecycle_generation !== handle.resource_lifecycle_generation ||
      ctx.handle.provider_identity_sha256 !== handle.provider_identity_sha256 ||
      ctx.handle.immutable_fingerprint_sha256 !== handle.immutable_fingerprint_sha256
    ) {
      throw new SandboxError("integrity_failed", "Fake bounded sink rejected a mismatched closed call context");
    }
    assertDigest(
      ctx.authorization_consumption_set_sha256,
      "bounded.authorization_consumption_set_sha256",
    );
    this.#exact(handle);
  }

  #exact(handle: OwnedProviderHandleV1): FakeResource {
    const resource = this.#resources.get(handle.resource_id);
    if (
      resource === undefined ||
      resource.handle.provider_identity_sha256 !== handle.provider_identity_sha256 ||
      providerHandleIdentityDigest(resource.handle) !== handle.provider_identity_sha256 ||
      resource.handle.immutable_fingerprint_sha256 !== handle.immutable_fingerprint_sha256 ||
      resource.handle.provider_creation_token_sha256 !== handle.provider_creation_token_sha256
    ) {
      throw new ProviderIdentityMismatchError();
    }
    return resource;
  }

  #assertSink(ctx: AdapterCallContextV1, op: ProviderOperationV1): void {
    const contextKeys = new Set([
      "trace_id",
      "deadline",
      "constraints_sha256",
      "fence",
      "target",
      "external_anchor_receipt_sha256",
      "final_currentness_barrier_receipt_sha256",
      "adapter_descriptor_sha256",
      "adapter_admission_receipt_sha256",
      ...(op.external_anchor_kind === "DISPATCHED"
        ? ["final_currentness_barrier"]
        : []),
      ...(op.operation === "destroy"
        ? ["cleanup_grant_sha256", "cleanup_basis_receipt_sha256"]
        : []),
    ]);
    const finalBarrier = ctx.final_currentness_barrier;
    const finalBarrierKeys = new Set([
      "schema_version",
      "trace_id",
      "deadline",
      "constraints_sha256",
      "fence_sha256",
      "target_sha256",
      "operation_id",
      "operation_step_id",
      "operation_execution_epoch",
      "request_sha256",
      "idempotency_key_sha256",
      "resource_id",
      "resource_lifecycle_generation",
      "dispatch_anchor_sha256",
      "physical_safety_assertion_sha256",
      "current_authorization_receipt_sha256",
      "adapter_descriptor_sha256",
      "adapter_admission_receipt_sha256",
      "adapter_admission_expires_at",
      "provider_handle_sha256",
      "grant_expires_at",
      "database_observed_at",
      "receipt_sha256",
    ]);
    const finalBarrierFacts = finalBarrier === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(finalBarrier).filter(([key]) => key !== "receipt_sha256"),
        );
    const mismatches: string[] = [];
    if (Object.keys(ctx).length !== contextKeys.size ||
        Object.keys(ctx).some((key) => !contextKeys.has(key))) {
      mismatches.push("closed_context");
    }
    if (ctx.trace_id !== adapterTraceId(op.fence.operation_id)) mismatches.push("trace_id");
    if (ctx.deadline !== op.deadline ||
        ctx.deadline !== op.fence.operation_execution_expires_at) {
      mismatches.push("deadline");
    }
    if (ctx.constraints_sha256 !== adapterConstraintsDigest(op.fence)) {
      mismatches.push("constraints_sha256");
    }
    if (
      canonicalDigest(ctx.fence) !== canonicalDigest(op.fence) ||
      canonicalDigest(ctx.target) !== canonicalDigest(op.target) ||
      ctx.external_anchor_receipt_sha256 !== op.external_anchor_receipt_sha256 ||
      ctx.adapter_descriptor_sha256 !== this.#lastDescriptorSha256 ||
      ctx.adapter_admission_receipt_sha256 !== canonicalDigest({
        schema_version: "sandboxes.hermetic-adapter-admission/v1",
        descriptor_sha256: this.#lastDescriptorSha256,
      }) ||
      op.target.resource_lifecycle_generation !== op.fence.resource_lifecycle_generation ||
      op.target.operation_id !== op.fence.operation_id ||
      op.target.operation_digest !== op.fence.operation_digest ||
      op.target.provider_idempotency_token_sha256 !== canonicalDigest({
        schema_version: "sandboxes.provider-effect-token/v1",
        operation_id: op.target.operation_id,
        operation_step_id: op.target.operation_step_id,
        operation_digest: op.target.operation_digest,
        resource_id: op.target.resource_id,
        provider_creation_token_sha256: op.target.provider_creation_token_sha256,
      })
    ) {
      mismatches.push("effect_identity");
    }
    if (op.external_anchor_kind === "DISPATCHED") {
      if (
        finalBarrier === undefined ||
        Object.keys(finalBarrier).length !== finalBarrierKeys.size ||
        Object.keys(finalBarrier).some((key) => !finalBarrierKeys.has(key)) ||
        finalBarrier.schema_version !== "sandboxes.final-currentness-barrier-receipt/v1"
      ) {
        mismatches.push("final_barrier_schema");
      } else {
        if (finalBarrier.receipt_sha256 !== canonicalDigest(finalBarrierFacts) ||
            ctx.final_currentness_barrier_receipt_sha256 !== finalBarrier.receipt_sha256) {
          mismatches.push("final_barrier_digest");
        }
        if (
          finalBarrier.operation_id !== op.fence.operation_id ||
          finalBarrier.trace_id !== ctx.trace_id ||
          finalBarrier.deadline !== ctx.deadline ||
          finalBarrier.constraints_sha256 !== ctx.constraints_sha256 ||
          finalBarrier.fence_sha256 !== canonicalDigest(op.fence) ||
          finalBarrier.target_sha256 !== canonicalDigest(op.target) ||
          finalBarrier.operation_step_id !== op.target.operation_step_id ||
          finalBarrier.operation_execution_epoch !== op.fence.operation_execution_epoch ||
          finalBarrier.request_sha256 !== op.request_sha256 ||
          finalBarrier.idempotency_key_sha256 !== op.idempotency_key_sha256 ||
          finalBarrier.resource_id !== op.fence.resource_id ||
          finalBarrier.resource_lifecycle_generation !==
            op.fence.resource_lifecycle_generation ||
          finalBarrier.dispatch_anchor_sha256 !== op.external_anchor_receipt_sha256 ||
          finalBarrier.physical_safety_assertion_sha256 !== canonicalDigest({
            schema_version: "sandboxes.physical-safety-assertion/v1",
            assertion: {
              resource_id: op.fence.resource_id,
              operation: op.operation === "create_inert"
                ? "begin_create_inert"
                : op.operation === "activate"
                  ? "begin_activate"
                  : op.operation === "destroy"
                    ? "begin_destroy"
                    : op.operation,
              fence: op.fence,
              dispatch_anchor_sha256: op.external_anchor_receipt_sha256,
            },
          }) ||
          finalBarrier.adapter_descriptor_sha256 !== ctx.adapter_descriptor_sha256 ||
          finalBarrier.adapter_admission_receipt_sha256 !==
            ctx.adapter_admission_receipt_sha256
        ) {
          mismatches.push("final_barrier_identity");
        }
      }
    } else if (finalBarrier !== undefined) {
      mismatches.push("read_probe_final_barrier");
    }
    if (mismatches.length > 0) {
      throw new SandboxError(
        "integrity_failed",
        `Fake adapter sink rejected mismatched protected fields: ${mismatches.join(",")}`,
      );
    }
    assertDigest(
      ctx.final_currentness_barrier_receipt_sha256,
      "fake.final_currentness_barrier_receipt_sha256",
    );
    this.observed_final_barrier_receipts.push(
      ctx.final_currentness_barrier_receipt_sha256,
    );
    this.observed_adapter_descriptor_receipts.push(ctx.adapter_descriptor_sha256);
    this.observed_adapter_admission_receipts.push(
      ctx.adapter_admission_receipt_sha256,
    );
    this.observed_authorization_receipts.push(op.target.authorization_consumption_receipt_sha256);
  }

  #assertDiscoveryScope(ctx: ReconcileContextV1, op: ProviderOperationV1): void {
    if (
      ctx.installation_id !== "installation_00000000000000000000000000000001" ||
      ctx.provider_scope_ref !== "fake-test-scope" ||
      ctx.resource_id !== op.target.resource_id ||
      ctx.provider_creation_token_sha256 !== op.target.provider_creation_token_sha256 ||
      ctx.immutable_fingerprint_sha256 !== op.target.immutable_fingerprint_sha256 ||
      ctx.discovery_scope_receipt_sha256 !== op.external_anchor_receipt_sha256 ||
      ctx.complete_read_probe_envelope_sha256 !== op.external_anchor_receipt_sha256 ||
      ctx.read_probe_no_effect_receipt_sha256 !==
        op.read_probe_no_effect_receipt_sha256 ||
      ctx.max_pages !== 1_000 ||
      op.external_anchor_kind !== "READ_PROBE"
    ) {
      throw new SandboxError("capability_denied", "Fake provider rejected a mismatched signed discovery scope");
    }
    this.observed_read_probe_no_effect_receipts.push(
      ctx.read_probe_no_effect_receipt_sha256,
    );
  }
}
