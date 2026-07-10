import { describe, expect, test } from "bun:test"
import {
  AdapterContractError,
  JournalIdentityLedgerV1,
  buildDaytonaCreateParams,
  buildE2bCreateOptions,
  canonicalSha256,
  DAYTONA_SDK_PIN,
  decodeGuestBrokerRequestFrame,
  E2B_SDK_PIN,
  encodeGuestBrokerRequestFrame,
  OFFICIAL_SDK_CONTRACT_GAPS,
  validateAdapterCallContext,
  validateWorkspacePath,
  type FailedNoEffectAuthorizationV1,
} from "../../src/adapters/managed/index"
import { FakeJournal, digest, makeAnchorReceipt, makeContext, makeOperation } from "./fakes"

describe("immutable journal identity", () => {
  test("accepts exact duplicate bytes for the full record identity", () => {
    const op = makeOperation("create_inert")
    const ctx = makeContext(op, new FakeJournal())
    const ledger = new JournalIdentityLedgerV1()

    expect(ledger.append(ctx.invocation_anchor.record)).toEqual({ duplicate: false })
    expect(ledger.append(ctx.invocation_anchor.record)).toEqual({ duplicate: true })
  })

  test("rejects changed bytes at the same (operation, step, epoch, kind) identity", () => {
    const op = makeOperation("create_inert")
    const ctx = makeContext(op, new FakeJournal())
    const ledger = new JournalIdentityLedgerV1()
    ledger.append(ctx.invocation_anchor.record)

    expect(() =>
      ledger.append({ ...ctx.invocation_anchor.record, payload_sha256: digest("different") }),
    ).toThrowError(AdapterContractError)
  })

  test("adapter reachability accepts only a receipt-proven exact duplicate dispatch", () => {
    const op = makeOperation("create_inert")
    const initial = makeContext(op, new FakeJournal())
    const duplicate = {
      ...initial,
      invocation_anchor: { ...initial.invocation_anchor, duplicate: true },
      dispatch_attempt: {
        kind: "exact_duplicate" as const,
        operation_execution_epoch: initial.fence.operation_execution_epoch,
        prior_record_sha256: initial.invocation_anchor.record_sha256,
      },
    }
    expect(() => validateAdapterCallContext(duplicate, op)).not.toThrow()
    expect(() =>
      validateAdapterCallContext(
        {
          ...duplicate,
          dispatch_attempt: { ...duplicate.dispatch_attempt, prior_record_sha256: digest("changed") },
        },
        op,
      ),
    ).toThrowError(expect.objectContaining({ code: "dispatch_anchor_mismatch" }))
  })

  test("higher executor epoch requires authoritative failed_no_effect for unchanged target", () => {
    const op = makeOperation("create_inert")
    const journal = new FakeJournal()
    const higher = makeContext(op, journal, { operationExecutionEpoch: 4n })

    expect(() => validateAdapterCallContext(higher, { ...op, fence: higher.fence })).toThrowError(
      expect.objectContaining({ code: "stale_operation_execution_epoch" }),
    )

    const proof: FailedNoEffectAuthorizationV1 = {
      schema_version: "sandboxes.failed-no-effect/v1",
      previous_operation_execution_epoch: 3n,
      successor_operation_execution_epoch: 4n,
      target_sha256: canonicalSha256(op.target),
      resource_id: op.target.resource_id,
      provider_idempotency_token_sha256: op.target.provider_idempotency_token_sha256,
      operation_digest: op.target.operation_digest,
      evidence_sha256: digest("a1"),
    }
    const allowed = makeContext(op, journal, { operationExecutionEpoch: 4n, failedNoEffect: proof })
    expect(() => validateAdapterCallContext(allowed, { ...op, fence: allowed.fence })).not.toThrow()
  })

  test("higher epoch proof cannot change token, resource, target, or operation digest", () => {
    const op = makeOperation("create_inert")
    const proof: FailedNoEffectAuthorizationV1 = {
      schema_version: "sandboxes.failed-no-effect/v1",
      previous_operation_execution_epoch: 3n,
      successor_operation_execution_epoch: 4n,
      target_sha256: canonicalSha256(op.target),
      resource_id: op.target.resource_id,
      provider_idempotency_token_sha256: digest("bad"),
      operation_digest: op.target.operation_digest,
      evidence_sha256: digest("a1"),
    }
    const ctx = makeContext(op, new FakeJournal(), { operationExecutionEpoch: 4n, failedNoEffect: proof })

    expect(() => validateAdapterCallContext(ctx, { ...op, fence: ctx.fence })).toThrowError(
      expect.objectContaining({ code: "operation_target_mismatch" }),
    )
  })

  test("a duplicate higher-epoch dispatch anchor cannot repeat a provider mutation", () => {
    const op = makeOperation("create_inert")
    const proof: FailedNoEffectAuthorizationV1 = {
      schema_version: "sandboxes.failed-no-effect/v1",
      previous_operation_execution_epoch: 3n,
      successor_operation_execution_epoch: 4n,
      target_sha256: canonicalSha256(op.target),
      resource_id: op.target.resource_id,
      provider_idempotency_token_sha256: op.target.provider_idempotency_token_sha256,
      operation_digest: op.target.operation_digest,
      evidence_sha256: digest("a1"),
    }
    const ctx = makeContext(op, new FakeJournal(), { operationExecutionEpoch: 4n, failedNoEffect: proof })

    expect(() =>
      validateAdapterCallContext(
        { ...ctx, invocation_anchor: { ...ctx.invocation_anchor, duplicate: true } },
        { ...op, fence: ctx.fence },
      ),
    ).toThrowError(expect.objectContaining({ code: "dispatch_anchor_mismatch" }))
  })

  test("the signed higher-epoch dispatch anchor binds the exact failed-no-effect proof bytes", () => {
    const op = makeOperation("create_inert")
    const proof: FailedNoEffectAuthorizationV1 = {
      schema_version: "sandboxes.failed-no-effect/v1",
      previous_operation_execution_epoch: 3n,
      successor_operation_execution_epoch: 4n,
      target_sha256: canonicalSha256(op.target),
      resource_id: op.target.resource_id,
      provider_idempotency_token_sha256: op.target.provider_idempotency_token_sha256,
      operation_digest: op.target.operation_digest,
      evidence_sha256: digest("a1"),
    }
    const ctx = makeContext(op, new FakeJournal(), { operationExecutionEpoch: 4n, failedNoEffect: proof })
    const changed = {
      ...ctx,
      dispatch_attempt: {
        ...ctx.dispatch_attempt,
        authorization: { ...proof, evidence_sha256: digest("a2") },
      },
    } as typeof ctx

    expect(() => validateAdapterCallContext(changed, { ...op, fence: ctx.fence })).toThrowError(
      expect.objectContaining({ code: "dispatch_anchor_mismatch" }),
    )
  })

  test("anchor receipt digest must cover the exact record", () => {
    const op = makeOperation("create_inert")
    const ctx = makeContext(op, new FakeJournal())
    const tampered = {
      ...ctx,
      invocation_anchor: {
        ...makeAnchorReceipt(ctx.invocation_anchor.record),
        record_sha256: digest("tampered"),
      },
    }
    expect(() => validateAdapterCallContext(tampered, op)).toThrowError(
      expect.objectContaining({ code: "dispatch_anchor_mismatch" }),
    )
  })

  test("generation-changing journal records bind the exact predecessor and successor pair", () => {
    const op = makeOperation("create_inert")
    const ctx = makeContext(op, new FakeJournal())
    const record = {
      ...ctx.invocation_anchor.record,
      generation_transition_sha256: digest("wrong-generation-pair"),
    }
    const tampered = {
      ...ctx,
      invocation_anchor: makeAnchorReceipt(record),
    }
    op.external_anchor_receipt_sha256 = tampered.invocation_anchor.record_sha256

    expect(() => validateAdapterCallContext(tampered, op)).toThrowError(
      expect.objectContaining({ code: "dispatch_anchor_mismatch" }),
    )
  })
})

describe("typed guest-broker framing", () => {
  test("binds payload bytes, operation, and immutable resource fingerprint", () => {
    const frame = encodeGuestBrokerRequestFrame(
      { operation: "file_stat", path: validateWorkspacePath("repo/file.txt") },
      digest("b1"),
    )
    expect(decodeGuestBrokerRequestFrame(frame)).toEqual({
      operation: "file_stat",
      path: validateWorkspacePath("repo/file.txt"),
    })

    const changed = { ...frame, payload_bytes: frame.payload_bytes.slice() }
    const lastByte = changed.payload_bytes.at(-1)
    if (lastByte === undefined) throw new Error("fixture frame is empty")
    changed.payload_bytes[changed.payload_bytes.length - 1] = lastByte ^ 1
    expect(() => decodeGuestBrokerRequestFrame(changed)).toThrowError(
      expect.objectContaining({ code: "integrity_failed" }),
    )
  })
})
describe("official SDK pin mappings", () => {
  test("pins exact supply-chain-eligible provider SDK builds", () => {
    expect(E2B_SDK_PIN).toEqual({ package: "e2b", version: "2.31.0" })
    expect(DAYTONA_SDK_PIN).toEqual({ package: "@daytona/sdk", version: "0.193.0" })
  })

  test("E2B create is source-free, credential-free, deny-all, private, and pause-not-kill on timeout", () => {
    const op = makeOperation("create_inert")
    const options = buildE2bCreateOptions({
      template: "pinned-template-ref",
      metadata: {
        installation_sha256: digest("b1"),
        creation_token_sha256: op.target.provider_idempotency_token_sha256,
        immutable_fingerprint_sha256: op.target.immutable_fingerprint_sha256,
      },
      max_runtime_ms: 60_000,
    })

    expect(options.envs).toEqual({})
    expect(options.allowInternetAccess).toBe(false)
    expect(options.network).toMatchObject({ denyOut: ["0.0.0.0/0"], allowPublicTraffic: false })
    expect(options.lifecycle).toEqual({ onTimeout: { action: "pause", keepMemory: false }, autoResume: false })
    expect(options.metadata).toMatchObject({
      "hasna.creation_token_sha256": op.target.provider_idempotency_token_sha256,
      "hasna.immutable_fingerprint_sha256": op.target.immutable_fingerprint_sha256,
    })
    expect(JSON.stringify(options)).not.toMatch(/api.?key|secret|credential/i)
  })

  test("Daytona create disables public access, secrets, linking, ephemeral and auto-delete", () => {
    const op = makeOperation("create_inert")
    const params = buildDaytonaCreateParams({
      snapshot: "pinned-strong-vm-snapshot-ref",
      labels: {
        installation_sha256: digest("b1"),
        creation_token_sha256: op.target.provider_idempotency_token_sha256,
        immutable_fingerprint_sha256: op.target.immutable_fingerprint_sha256,
      },
      resources: { cpu: 2, memory: 4, disk: 20 },
    })

    expect(params.envVars).toEqual({})
    expect(params.public).toBe(false)
    expect(params.ephemeral).toBe(false)
    expect(params.autoDeleteInterval).toBe(-1)
    expect(params.networkBlockAll).toBe(true)
    expect(params.labels).toMatchObject({
      "hasna.creation_token_sha256": op.target.provider_idempotency_token_sha256,
      "hasna.immutable_fingerprint_sha256": op.target.immutable_fingerprint_sha256,
    })
    expect(params).not.toHaveProperty("secrets")
    expect(params).not.toHaveProperty("linkedSandbox")
    expect(JSON.stringify(params)).not.toMatch(/api.?key|credential/i)
  })

  test("keeps both builds disabled pending live proof while recording adapter compensations", () => {
    for (const provider of ["e2b", "daytona_cloud"] as const) {
      expect(OFFICIAL_SDK_CONTRACT_GAPS[provider].admission).toBe("disabled")
      expect(OFFICIAL_SDK_CONTRACT_GAPS[provider].gaps).toEqual(
        expect.arrayContaining([
          "creation_metadata_filter_consistency_live_evidence",
          "fixed_broker_bootstrap_and_transport_live_evidence",
          "delete_absence_consistency_live_evidence",
          "strong_vm_live_evidence",
        ]),
      )
      expect(OFFICIAL_SDK_CONTRACT_GAPS[provider].compensated_in_adapter).toEqual(
        expect.arrayContaining([
          "creation_token_metadata_plus_exact_lookup_plus_lifecycle_lock",
          "provider_started_default_deny_source_free_infinity_inert",
          "fixed_bootstrap_plus_typed_guest_broker_frames",
          "exact_incarnation_readback_plus_locked_delete_plus_absence_proof",
        ]),
      )
      expect(OFFICIAL_SDK_CONTRACT_GAPS[provider].official_api_evidence.length).toBeGreaterThan(0)
    }
  })
})
