import { describe, expect, test } from "bun:test"
import {
  AdapterContractError,
  JournalIdentityLedgerV1,
  buildDaytonaCreateParams,
  buildE2bCreateOptions,
  canonicalSha256,
  DAYTONA_SDK_PIN,
  E2B_SDK_PIN,
  OFFICIAL_SDK_CONTRACT_GAPS,
  validateAdapterCallContext,
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
    expect(params).not.toHaveProperty("secrets")
    expect(params).not.toHaveProperty("linkedSandbox")
    expect(JSON.stringify(params)).not.toMatch(/api.?key|credential/i)
  })

  test("keeps both exact builds disabled for unresolved mandatory contract gaps", () => {
    for (const provider of ["e2b", "daytona_cloud"] as const) {
      expect(OFFICIAL_SDK_CONTRACT_GAPS[provider].admission).toBe("disabled")
      expect(OFFICIAL_SDK_CONTRACT_GAPS[provider].gaps).toEqual(
        expect.arrayContaining(["create_stopped", "atomic_creation_token", "typed_argv_exec", "conditional_destroy"]),
      )
    }
  })
})
