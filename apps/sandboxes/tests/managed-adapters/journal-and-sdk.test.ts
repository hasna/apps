import { describe, expect, test } from "bun:test"
import {
  AdapterContractError,
  JournalIdentityLedgerV1,
  buildDaytonaCreateParams,
  buildDaytonaExactOwnershipListQuery,
  buildE2bCreateOptions,
  buildE2bExactOwnershipListOptions,
  canonicalSha256,
  DAYTONA_SDK_PIN,
  DAYTONA_GUEST_BROKER_PTY_ID,
  createDaytonaSourceFreeInert,
  createE2bSourceFreeInert,
  decodeGuestBrokerRequestFrame,
  E2B_SDK_PIN,
  encodeGuestBrokerRequestFrame,
  managedProviderRequestSha256,
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  MANAGED_GUEST_BROKER_PROTOCOL_SHA256,
  openDaytonaGuestBrokerSdkSession,
  openE2bGuestBrokerSdkSession,
  OFFICIAL_SDK_CONTRACT_GAPS,
  validateAdapterCallContext,
  validateWorkspacePath,
  type FailedNoEffectAuthorizationV1,
  type DaytonaOfficialBrokerProcessV1,
  type E2bOfficialBrokerCommandsV1,
} from "../../src/adapters/managed/index"
import { FakeJournal, digest, makeAnchorReceipt, makeContext, makeOperation } from "./fakes"

function brokerAttestation(immutableFingerprintSha256: ReturnType<typeof digest>) {
  return {
    schema_version: "sandboxes.guest-broker-attestation/v1" as const,
    immutable_fingerprint_sha256: immutableFingerprintSha256,
    bootstrap_command_sha256: canonicalSha256(MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND),
    protocol_sha256: MANAGED_GUEST_BROKER_PROTOCOL_SHA256,
    provider_session_binding_sha256: digest("b0"),
    attested_at: "2026-07-10T10:00:03.500Z",
  }
}

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

  test("journal identity encoding is not delimiter-collidable", () => {
    const op = makeOperation("create_inert")
    const ctx = makeContext(op, new FakeJournal())
    const ledger = new JournalIdentityLedgerV1()
    const left = { ...ctx.invocation_anchor.record, operation_id: "a\u001fb", operation_step_id: "c" }
    const right = { ...ctx.invocation_anchor.record, operation_id: "a", operation_step_id: "b\u001fc" }

    expect(ledger.append(left)).toEqual({ duplicate: false })
    expect(ledger.append(right)).toEqual({ duplicate: false })
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
      outcome_kind: "failed_no_effect",
      previous_operation_execution_epoch: 3n,
      successor_operation_execution_epoch: 4n,
      target_sha256: canonicalSha256(op.target),
      request_sha256: op.request_sha256,
      resource_id: op.target.resource_id,
      provider_idempotency_token_sha256: op.target.provider_idempotency_token_sha256,
      operation_digest: op.target.operation_digest,
      prior_outcome_anchor_sha256: digest("a3"),
      evidence_sha256: digest("a1"),
    }
    const allowed = makeContext(op, journal, { operationExecutionEpoch: 4n, failedNoEffect: proof })
    expect(() => validateAdapterCallContext(allowed, { ...op, fence: allowed.fence })).not.toThrow()
  })

  test("failed-no-effect retry advances the executor epoch by exactly one", () => {
    const op = makeOperation("create_inert")
    const proof: FailedNoEffectAuthorizationV1 = {
      schema_version: "sandboxes.failed-no-effect/v1",
      outcome_kind: "failed_no_effect",
      previous_operation_execution_epoch: 3n,
      successor_operation_execution_epoch: 5n,
      target_sha256: canonicalSha256(op.target),
      request_sha256: op.request_sha256,
      resource_id: op.target.resource_id,
      provider_idempotency_token_sha256: op.target.provider_idempotency_token_sha256,
      operation_digest: op.target.operation_digest,
      prior_outcome_anchor_sha256: digest("a3"),
      evidence_sha256: digest("a1"),
    }
    const skipped = makeContext(op, new FakeJournal(), {
      operationExecutionEpoch: 5n,
      failedNoEffect: proof,
    })

    expect(() => validateAdapterCallContext(skipped, { ...op, fence: skipped.fence })).toThrowError(
      expect.objectContaining({ code: "stale_operation_execution_epoch" }),
    )
  })

  test("higher epoch proof cannot change token, resource, target, or operation digest", () => {
    const op = makeOperation("create_inert")
    const proof: FailedNoEffectAuthorizationV1 = {
      schema_version: "sandboxes.failed-no-effect/v1",
      outcome_kind: "failed_no_effect",
      previous_operation_execution_epoch: 3n,
      successor_operation_execution_epoch: 4n,
      target_sha256: canonicalSha256(op.target),
      request_sha256: op.request_sha256,
      resource_id: op.target.resource_id,
      provider_idempotency_token_sha256: digest("bad"),
      operation_digest: op.target.operation_digest,
      prior_outcome_anchor_sha256: digest("a3"),
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
      outcome_kind: "failed_no_effect",
      previous_operation_execution_epoch: 3n,
      successor_operation_execution_epoch: 4n,
      target_sha256: canonicalSha256(op.target),
      request_sha256: op.request_sha256,
      resource_id: op.target.resource_id,
      provider_idempotency_token_sha256: op.target.provider_idempotency_token_sha256,
      operation_digest: op.target.operation_digest,
      prior_outcome_anchor_sha256: digest("a3"),
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
      outcome_kind: "failed_no_effect",
      previous_operation_execution_epoch: 3n,
      successor_operation_execution_epoch: 4n,
      target_sha256: canonicalSha256(op.target),
      request_sha256: op.request_sha256,
      resource_id: op.target.resource_id,
      provider_idempotency_token_sha256: op.target.provider_idempotency_token_sha256,
      operation_digest: op.target.operation_digest,
      prior_outcome_anchor_sha256: digest("a3"),
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
    const op = makeOperation("file_stat", { generation_transition: undefined })
    const request = { operation: "file_stat" as const, path: validateWorkspacePath("repo/file.txt") }
    op.request_sha256 = managedProviderRequestSha256(request)
    const frame = encodeGuestBrokerRequestFrame(
      request,
      op,
      brokerAttestation(op.target.immutable_fingerprint_sha256),
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

describe("official SDK guest-broker compensation bridges", () => {
  function brokerFrame() {
    const op = makeOperation("file_stat", { generation_transition: undefined })
    const request = {
      operation: "file_stat" as const,
      path: validateWorkspacePath("repo/literal;$(not-a-shell)"),
    }
    op.request_sha256 = managedProviderRequestSha256(request)
    return encodeGuestBrokerRequestFrame(
      request,
      op,
      brokerAttestation(op.target.immutable_fingerprint_sha256),
    )
  }

  test("E2B runs only the fixed command and sends framed bytes over stdin", async () => {
    const commandsSeen: string[] = []
    const stdin: Uint8Array[] = []
    const commands = {
      async run(command: string, options: unknown) {
        commandsSeen.push(command)
        expect(options).toMatchObject({ background: true, cwd: "/workspace", envs: {}, stdin: true })
        return {
          async sendStdin(bytes: Uint8Array) { stdin.push(bytes) },
          async closeStdin() {},
        }
      },
    } as unknown as E2bOfficialBrokerCommandsV1

    const session = await openE2bGuestBrokerSdkSession(commands)
    await session.sendFrame(brokerFrame())

    expect(commandsSeen).toEqual([MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND])
    expect(JSON.stringify(commandsSeen)).not.toContain("not-a-shell")
    expect(stdin).toHaveLength(1)
    expect(new DataView(stdin[0]!.buffer).getUint32(0, false)).toBe(stdin[0]!.byteLength - 4)
  })

  test("Daytona starts a fixed PTY and sends caller data only after the fixed bootstrap", async () => {
    const inputs: Array<string | Uint8Array> = []
    const process = {
      async createPty(options: { id: string; cwd?: string; envs?: Record<string, string> }) {
        expect(options).toMatchObject({ id: DAYTONA_GUEST_BROKER_PTY_ID, cwd: "/workspace", envs: {} })
        return {
          async waitForConnection() {},
          async sendInput(input: string | Uint8Array) { inputs.push(input) },
          async disconnect() {},
        }
      },
    } as unknown as DaytonaOfficialBrokerProcessV1

    const session = await openDaytonaGuestBrokerSdkSession(process, () => {})
    await session.sendFrame(brokerFrame())

    expect(inputs[0]).toBe(`${MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND}\n`)
    expect(typeof inputs[0] === "string" ? inputs[0] : "").not.toContain("not-a-shell")
    expect(inputs[1]).toBeInstanceOf(Uint8Array)
  })

  test("credential-bound create bridges pass only hardened provider options", async () => {
    const labels = {
      installation_sha256: digest("b1"),
      provider_scope_ref_sha256: digest("b2"),
      ownership_nonce_sha256: digest("b3"),
      creation_token_sha256: digest("b4"),
      immutable_fingerprint_sha256: digest("b5"),
    }
    let e2bOptions: unknown
    await createE2bSourceFreeInert(
      async (options) => {
        e2bOptions = options
        return {} as never
      },
      { template: "pinned-template-ref", metadata: labels, max_runtime_ms: 60_000 },
    )
    expect(e2bOptions).toMatchObject({ envs: {}, allowInternetAccess: false, secure: true })

    let daytonaOptions: unknown
    await createDaytonaSourceFreeInert(
      {
        async create(options: unknown) {
          daytonaOptions = options
          return {} as never
        },
      } as never,
      {
        image: "pinned-strong-vm-image-ref",
        labels,
        resources: { cpu: 2, memory: 4, disk: 20 },
      },
    )
    expect(daytonaOptions).toMatchObject({
      envVars: {},
      public: false,
      networkBlockAll: true,
      resources: { cpu: 2, memory: 4, disk: 20 },
    })
  })
})
describe("official SDK pin mappings", () => {
  test("pins exact supply-chain-eligible provider SDK builds", () => {
    expect(E2B_SDK_PIN).toEqual({ package: "e2b", version: "2.31.0" })
    expect(DAYTONA_SDK_PIN).toEqual({ package: "@daytona/sdk", version: "0.193.0" })
  })

  test("maps every immutable ownership field into exact provider list filters", () => {
    const metadata = {
      installation_sha256: digest("b1"),
      provider_scope_ref_sha256: digest("b2"),
      ownership_nonce_sha256: digest("b3"),
      creation_token_sha256: digest("b4"),
      immutable_fingerprint_sha256: digest("b5"),
    }
    const expected = {
      "hasna.installation_sha256": digest("b1"),
      "hasna.provider_scope_ref_sha256": digest("b2"),
      "hasna.ownership_nonce_sha256": digest("b3"),
      "hasna.creation_token_sha256": digest("b4"),
      "hasna.immutable_fingerprint_sha256": digest("b5"),
    }

    expect(buildE2bExactOwnershipListOptions(metadata).query?.metadata).toEqual(expected)
    expect(buildDaytonaExactOwnershipListQuery(metadata).labels).toEqual(expected)
  })

  test("E2B create is source-free, credential-free, deny-all, private, and pause-not-kill on timeout", () => {
    const op = makeOperation("create_inert")
    const options = buildE2bCreateOptions({
      template: "pinned-template-ref",
      metadata: {
        installation_sha256: digest("b1"),
        provider_scope_ref_sha256: digest("b2"),
        ownership_nonce_sha256: digest("b3"),
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
      "hasna.provider_scope_ref_sha256": digest("b2"),
      "hasna.ownership_nonce_sha256": digest("b3"),
    })
    expect(JSON.stringify(options)).not.toMatch(/api.?key|secret|credential/i)
  })

  test("Daytona create disables public access, secrets, linking, ephemeral and auto-delete", () => {
    const op = makeOperation("create_inert")
    const params = buildDaytonaCreateParams({
      image: "pinned-strong-vm-image-ref",
      labels: {
        installation_sha256: digest("b1"),
        provider_scope_ref_sha256: digest("b2"),
        ownership_nonce_sha256: digest("b3"),
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
    expect(params.resources).toEqual({ cpu: 2, memory: 4, disk: 20 })
    expect(params.labels).toMatchObject({
      "hasna.creation_token_sha256": op.target.provider_idempotency_token_sha256,
      "hasna.immutable_fingerprint_sha256": op.target.immutable_fingerprint_sha256,
      "hasna.provider_scope_ref_sha256": digest("b2"),
      "hasna.ownership_nonce_sha256": digest("b3"),
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
