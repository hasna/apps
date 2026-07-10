import { describe, expect, test } from "bun:test"
import * as managedPublicApi from "../../src/adapters/managed/index"
import {
  AdapterContractError,
  JournalIdentityLedgerV1,
  buildDaytonaCreateParams,
  buildDaytonaExactOwnershipListQuery,
  buildE2bCreateOptions,
  buildE2bExactOwnershipListOptions,
  canonicalSha256,
  DAYTONA_SDK_PIN,
  DaytonaOfficialSdkControlBridgeV1,
  decodeGuestBrokerRequestFrame,
  E2B_SDK_PIN,
  E2bOfficialSdkControlBridgeV1,
  encodeGuestBrokerRequestFrame,
  managedProviderRequestSha256,
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  MANAGED_GUEST_BROKER_PROTOCOL_SHA256,
  OFFICIAL_SDK_CONTRACT_GAPS,
  validateAdapterCallContext,
  validateWorkspacePath,
  type FailedNoEffectAuthorizationV1,
  type DaytonaOfficialReadSdkV1,
  type E2bOfficialReadSdkV1,
  type ManagedResourceAttestationPortV1,
} from "../../src/adapters/managed/index"
import {
  DAYTONA_GUEST_BROKER_PTY_ID,
  createDaytonaDenyAllCandidate,
  createE2bDenyAllCandidate,
  withDaytonaGuestBrokerSdkSession,
  withE2bGuestBrokerSdkSession,
  type DaytonaOfficialBrokerProcessV1,
  type E2bOfficialBrokerCommandsV1,
} from "../../src/adapters/managed/sdk-broker-bridges"
import {
  FakeGuestBrokerAuthenticator,
  FakeJournal,
  digest,
  makeAnchorReceipt,
  makeContext,
  makeOperation,
} from "./fakes"

const brokerAuthenticator = new FakeGuestBrokerAuthenticator()

describe("managed package boundary", () => {
  test("exposes no core constructor or hermetic admission hook", async () => {
    expect((managedPublicApi as Record<string, unknown>).ManagedProviderAdapter).toBeUndefined()
    expect(
      (managedPublicApi as Record<string, unknown>).createProductionManagedProviderAdapter,
    ).toBeUndefined()
    expect(
      (managedPublicApi as Record<string, unknown>).__testOnlyCreateManagedProviderAdapterCore,
    ).toBeUndefined()

    const manifest = await Bun.file(new URL("../../package.json", import.meta.url)).json() as {
      exports?: unknown
      files?: unknown
      scripts?: Record<string, unknown>
      types?: unknown
      dependencies?: Record<string, unknown>
    }
    expect(manifest.types).toBe("./dist/types/index.d.ts")
    expect(manifest.exports).toEqual({
      ".": {
        types: "./dist/types/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      },
    })
    expect(manifest.files).toEqual(["dist/index.js", "dist/types"])
    expect(manifest.dependencies?.["@types/ws"]).toBe("8.18.1")
    expect(manifest.scripts?.prepack).toBe("bun run build")

    const build = await Bun.build({
      entrypoints: [new URL("../../src/adapters/managed/index.ts", import.meta.url).pathname],
      external: ["e2b", "@daytona/sdk"],
      format: "esm",
      target: "bun",
    })
    expect(build.success).toBe(true)
    const bundledSource = await build.outputs[0]!.text()
    const originalDefineProperty = Object.defineProperty
    let constructorMaskAttempted = false
    const bundleUrl = URL.createObjectURL(new Blob([bundledSource], { type: "text/javascript" }))
    Object.defineProperty = ((target: object, propertyKey: PropertyKey, attributes: PropertyDescriptor) => {
      if (propertyKey === "constructor") constructorMaskAttempted = true
      return originalDefineProperty(target, propertyKey, attributes)
    }) as typeof Object.defineProperty
    try {
      await import(bundleUrl)
    } finally {
      Object.defineProperty = originalDefineProperty
      URL.revokeObjectURL(bundleUrl)
    }
    expect(constructorMaskAttempted).toBe(false)
  })
})

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
  test("canonical bigint encoding cannot collide with a string", () => {
    expect(canonicalSha256({ value: 1n })).not.toBe(canonicalSha256({ value: "1" }))
  })

  test("canonical hashing rejects ambiguous JSON values", () => {
    expect(() => canonicalSha256({ value: Number.NaN })).toThrow("non_canonical_value")
    expect(() => canonicalSha256({ value: Number.POSITIVE_INFINITY })).toThrow("non_canonical_value")
    expect(() => canonicalSha256({ value: -0 })).toThrow("non_canonical_value")
    expect(() => canonicalSha256({ value: undefined })).toThrow("non_canonical_value")
    expect(() => canonicalSha256({ value: new Date(0) })).toThrow("non_canonical_value")
  })
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
      dispatch_attempt: {
        kind: "exact_duplicate" as const,
        operation_execution_epoch: initial.fence.operation_execution_epoch,
        prior_record_sha256: canonicalSha256(initial.invocation_anchor),
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

  test("dispatch variants and failed-no-effect proofs are closed, typed shapes", () => {
    const op = makeOperation("create_inert")
    const initial = makeContext(op, new FakeJournal())
    const nonEnumerableInitial = {
      kind: "initial",
      operation_execution_epoch: initial.fence.operation_execution_epoch,
    }
    Object.defineProperty(nonEnumerableInitial, "hidden", {
      enumerable: false,
      value: true,
    })
    const accessorKind: Record<string, unknown> = {
      operation_execution_epoch: initial.fence.operation_execution_epoch,
    }
    Object.defineProperty(accessorKind, "kind", {
      enumerable: true,
      get() {
        throw new Error("untrusted dispatch getter")
      },
    })
    const malformedAttempts = [
      { kind: "unrecognized" },
      { kind: "initial", operation_execution_epoch: 1n, extra: true },
      { kind: "initial", operation_execution_epoch: "1" },
      {
        kind: "initial",
        operation_execution_epoch: initial.fence.operation_execution_epoch,
        [Symbol("hidden")]: true,
      },
      nonEnumerableInitial,
      accessorKind,
      { kind: "exact_duplicate", operation_execution_epoch: 1n },
      {
        kind: "higher_epoch_after_failed_no_effect",
        previous_operation_execution_epoch: 0n,
        authorization: null,
      },
    ]

    for (const dispatchAttempt of malformedAttempts) {
      expect(() =>
        validateAdapterCallContext(
          { ...initial, dispatch_attempt: dispatchAttempt } as never,
          op,
        ),
      ).toThrowError(expect.objectContaining({ code: "dispatch_anchor_mismatch" }))
    }
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
      provider_creation_token_sha256: op.target.provider_creation_token_sha256,
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
      provider_creation_token_sha256: op.target.provider_creation_token_sha256,
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
      provider_creation_token_sha256: op.target.provider_creation_token_sha256,
      operation_digest: op.target.operation_digest,
      prior_outcome_anchor_sha256: digest("a3"),
      evidence_sha256: digest("a1"),
    }
    const ctx = makeContext(op, new FakeJournal(), { operationExecutionEpoch: 4n, failedNoEffect: proof })

    expect(() => validateAdapterCallContext(ctx, { ...op, fence: ctx.fence })).toThrowError(
      expect.objectContaining({ code: "operation_target_mismatch" }),
    )
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
      provider_creation_token_sha256: op.target.provider_creation_token_sha256,
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

    const symbolExtendedProof = {
      ...proof,
      [Symbol("hidden")]: true,
    }
    expect(() =>
      validateAdapterCallContext(
        {
          ...ctx,
          dispatch_attempt: {
            ...ctx.dispatch_attempt,
            authorization: symbolExtendedProof,
          },
        } as never,
        { ...op, fence: ctx.fence },
      ),
    ).toThrowError(expect.objectContaining({ code: "dispatch_anchor_mismatch" }))
  })

  test("anchor receipt digest must cover the exact record", () => {
    const op = makeOperation("create_inert")
    const ctx = makeContext(op, new FakeJournal())
    const tampered = {
      ...ctx,
      invocation_anchor: {
        ...makeAnchorReceipt(ctx.invocation_anchor.record),
        record_digest: digest("tampered"),
      },
    }
    expect(() => validateAdapterCallContext(tampered, op)).toThrowError(
      expect.objectContaining({ code: "dispatch_anchor_mismatch" }),
    )
  })

  test("the journal wire envelope rejects undeclared compatibility fields", () => {
    const op = makeOperation("create_inert")
    const ctx = makeContext(op, new FakeJournal())
    const expanded = {
      ...ctx,
      invocation_anchor: { ...ctx.invocation_anchor, duplicate: false },
    } as typeof ctx

    expect(() => validateAdapterCallContext(expanded, op)).toThrowError(
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
    op.external_anchor_receipt_sha256 = canonicalSha256(tampered.invocation_anchor)

    expect(() => validateAdapterCallContext(tampered, op)).toThrowError(
      expect.objectContaining({ code: "dispatch_anchor_mismatch" }),
    )
  })
})

describe("typed guest-broker framing", () => {
  test("rejects portable path confusables, drive syntax, and excessive depth", () => {
    expect(() => validateWorkspacePath("repo/\u2215escape")).toThrowError(AdapterContractError)
    expect(() => validateWorkspacePath("C:/workspace/file")).toThrowError(AdapterContractError)
    expect(() => validateWorkspacePath(Array.from({ length: 65 }, () => "a").join("/"))).toThrowError(
      AdapterContractError,
    )
  })

  test("binds payload bytes, operation, and immutable resource fingerprint", () => {
    const op = makeOperation("file_stat", { generation_transition: undefined })
    const request = { operation: "file_stat" as const, path: validateWorkspacePath("repo/file.txt") }
    op.request_sha256 = managedProviderRequestSha256(request)
    const frame = encodeGuestBrokerRequestFrame(
      request,
      op,
      brokerAttestation(op.target.immutable_fingerprint_sha256),
      brokerAuthenticator,
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
      brokerAuthenticator,
    )
  }

  test("E2B runs only the fixed command and sends framed bytes over stdin", async () => {
    const commandsSeen: string[] = []
    const stdin: Uint8Array[] = []
    let closeCalls = 0
    const commands = {
      async run(command: string, options: unknown) {
        commandsSeen.push(command)
        expect(options).toMatchObject({ background: true, cwd: "/workspace", envs: {}, stdin: true })
        return {
          async sendStdin(bytes: Uint8Array) { stdin.push(bytes) },
          async closeStdin() {
            closeCalls += 1
            if (closeCalls === 1) throw new Error("transient close failure")
          },
        }
      },
    } as unknown as E2bOfficialBrokerCommandsV1

    let closedSession: Parameters<Parameters<typeof withE2bGuestBrokerSdkSession>[1]>[0] | undefined
    await withE2bGuestBrokerSdkSession(commands, async (session) => {
      closedSession = session
      expect((session as unknown as Record<string, unknown>).handle).toBeUndefined()
      expect(Reflect.ownKeys(session)).not.toContain("handle")
      await session.sendFrame(brokerFrame())
      await expect(session.closeInput()).rejects.toThrow("transient close failure")
      ;(session as { closeInput: () => Promise<void> }).closeInput = async () => {}
    })

    expect(commandsSeen).toEqual([MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND])
    expect(JSON.stringify(commandsSeen)).not.toContain("not-a-shell")
    expect(stdin).toHaveLength(1)
    expect(closeCalls).toBe(2)
    expect(new DataView(stdin[0]!.buffer).getUint32(0, false)).toBe(stdin[0]!.byteLength - 4)
    await expect(closedSession!.sendFrame(brokerFrame())).rejects.toThrow("guest_broker_session_closed")
  })

  test("Daytona starts a fixed PTY and sends caller data only after the fixed bootstrap", async () => {
    const inputs: Array<string | Uint8Array> = []
    let disconnectCalls = 0
    const process = {
      async createPty(options: { id: string; cwd?: string; envs?: Record<string, string> }) {
        expect(options).toMatchObject({ id: DAYTONA_GUEST_BROKER_PTY_ID, cwd: "/workspace", envs: {} })
        return {
          async waitForConnection() {},
          async sendInput(input: string | Uint8Array) { inputs.push(input) },
          async disconnect() {
            disconnectCalls += 1
            if (disconnectCalls === 1) throw new Error("transient disconnect failure")
          },
        }
      },
    } as unknown as DaytonaOfficialBrokerProcessV1

    let closedSession: Parameters<Parameters<typeof withDaytonaGuestBrokerSdkSession>[2]>[0] | undefined
    await withDaytonaGuestBrokerSdkSession(process, () => {}, async (session) => {
      closedSession = session
      expect((session as unknown as Record<string, unknown>).handle).toBeUndefined()
      expect(Reflect.ownKeys(session)).not.toContain("handle")
      await session.sendFrame(brokerFrame())
      await expect(session.closeInput()).rejects.toThrow("transient disconnect failure")
      ;(session as { closeInput: () => Promise<void> }).closeInput = async () => {}
    })

    expect(inputs[0]).toBe(`${MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND}\n`)
    expect(typeof inputs[0] === "string" ? inputs[0] : "").not.toContain("not-a-shell")
    expect(inputs[1]).toBeInstanceOf(Uint8Array)
    expect(disconnectCalls).toBe(2)
    await expect(closedSession!.sendFrame(brokerFrame())).rejects.toThrow("guest_broker_session_closed")
  })

  test("captured finalizers retry an in-flight close rejected after the callback returns", async () => {
    let e2bCloseCalls = 0
    const commands = {
      async run() {
        return {
          async sendStdin() {},
          closeStdin() {
            e2bCloseCalls += 1
            if (e2bCloseCalls === 1) {
              return new Promise<void>((_resolve, reject) => {
                setTimeout(() => reject(new Error("deferred close failure")), 0)
              })
            }
            return Promise.resolve()
          },
        }
      },
    } as unknown as E2bOfficialBrokerCommandsV1
    let e2bSession: Parameters<Parameters<typeof withE2bGuestBrokerSdkSession>[1]>[0] | undefined
    await withE2bGuestBrokerSdkSession(commands, async (session) => {
      e2bSession = session
      void session.closeInput().catch(() => {})
    })
    expect(e2bCloseCalls).toBe(2)
    await expect(e2bSession!.sendFrame(brokerFrame())).rejects.toThrow("guest_broker_session_closed")

    let daytonaDisconnectCalls = 0
    const process = {
      async createPty() {
        return {
          async waitForConnection() {},
          async sendInput() {},
          disconnect() {
            daytonaDisconnectCalls += 1
            if (daytonaDisconnectCalls === 1) {
              return new Promise<void>((_resolve, reject) => {
                setTimeout(() => reject(new Error("deferred disconnect failure")), 0)
              })
            }
            return Promise.resolve()
          },
        }
      },
    } as unknown as DaytonaOfficialBrokerProcessV1
    let daytonaSession: Parameters<Parameters<typeof withDaytonaGuestBrokerSdkSession>[2]>[0] | undefined
    await withDaytonaGuestBrokerSdkSession(process, () => {}, async (session) => {
      daytonaSession = session
      void session.closeInput().catch(() => {})
    })
    expect(daytonaDisconnectCalls).toBe(2)
    await expect(daytonaSession!.sendFrame(brokerFrame())).rejects.toThrow("guest_broker_session_closed")
  })

  test("Daytona disconnects when connection or fixed-bootstrap setup fails", async () => {
    for (const failure of ["connection", "bootstrap"] as const) {
      let disconnectCalls = 0
      let useCalls = 0
      const process = {
        async createPty() {
          return {
            async waitForConnection() {
              if (failure === "connection") throw new Error("connection setup failed")
            },
            async sendInput() {
              if (failure === "bootstrap") throw new Error("bootstrap setup failed")
            },
            async disconnect() {
              disconnectCalls += 1
            },
          }
        },
      } as unknown as DaytonaOfficialBrokerProcessV1

      await expect(
        withDaytonaGuestBrokerSdkSession(process, () => {}, async () => {
          useCalls += 1
        }),
      ).rejects.toThrow(failure === "connection" ? "connection setup failed" : "bootstrap setup failed")
      expect(useCalls).toBe(0)
      expect(disconnectCalls).toBe(1)
    }
  })

  test("persistent finalization failure propagates while the retained session stays sealed", async () => {
    let closeCalls = 0
    let retainedSession: Parameters<Parameters<typeof withE2bGuestBrokerSdkSession>[1]>[0] | undefined
    const commands = {
      async run() {
        return {
          async sendStdin() {},
          async closeStdin() {
            closeCalls += 1
            throw new Error("persistent close failure")
          },
        }
      },
    } as unknown as E2bOfficialBrokerCommandsV1

    await expect(
      withE2bGuestBrokerSdkSession(commands, async (session) => {
        retainedSession = session
      }),
    ).rejects.toThrow("persistent close failure")
    expect(closeCalls).toBe(2)
    await expect(retainedSession!.sendFrame(brokerFrame())).rejects.toThrow("guest_broker_session_closed")
  })

  test("Daytona snapshots provider-owned output bytes before delivery", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    let delivered: Uint8Array | undefined
    const process = {
      async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
        sdkOnData = options.onData
        return {
          async waitForConnection() {},
          async sendInput() {},
          async disconnect() {},
        }
      },
    } as unknown as DaytonaOfficialBrokerProcessV1
    await withDaytonaGuestBrokerSdkSession(
      process,
      (data) => {
        delivered = data
      },
      async () => {
        const providerBytes = new Uint8Array([1])
        await sdkOnData!(providerBytes)
        providerBytes[0] = 2
      },
    )

    expect(delivered?.[0]).toBe(1)
  })

  test("Daytona drops provider callbacks before successful and failed scope finalization", async () => {
    for (const disconnectFailure of [false, true]) {
      let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
      const delivered: number[] = []
      let disconnectCalls = 0
      const process = {
        async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
          sdkOnData = options.onData
          return {
            async waitForConnection() {},
            async sendInput() {},
            async disconnect() {
              disconnectCalls += 1
              await sdkOnData!(new Uint8Array([disconnectCalls]))
              if (disconnectFailure) throw new Error("persistent disconnect failure")
            },
          }
        },
      } as unknown as DaytonaOfficialBrokerProcessV1

      const result = withDaytonaGuestBrokerSdkSession(
        process,
        (data) => {
          delivered.push(data[0]!)
        },
        async () => {
          await sdkOnData!(new Uint8Array([7]))
        },
      )
      if (disconnectFailure) {
        await expect(result).rejects.toThrow("persistent disconnect failure")
        expect(disconnectCalls).toBe(2)
      } else {
        await result
        expect(disconnectCalls).toBe(1)
      }

      await sdkOnData!(new Uint8Array([9]))
      expect(delivered).toEqual([7])
    }
  })

  test("Daytona converts hostile typed-array access and copy failures to integrity errors", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    const failures: unknown[] = []
    const process = {
      async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
        sdkOnData = options.onData
        return {
          async waitForConnection() {},
          async sendInput() {},
          async disconnect() {},
        }
      },
    } as unknown as DaytonaOfficialBrokerProcessV1

    await withDaytonaGuestBrokerSdkSession(process, () => {}, async () => {
      const bufferAccessFailure = new Proxy(new Uint8Array([1]), {})
      const lengthTarget = new Uint8Array([2])
      const lengthAccessFailure = new Proxy(lengthTarget, {
        get(target, key, receiver) {
          if (key === "buffer") return target.buffer
          return Reflect.get(target, key, receiver)
        },
      })
      const revokedBuffer = Proxy.revocable(new ArrayBuffer(1), {})
      revokedBuffer.revoke()
      const sharedBufferCheckTarget = new Uint8Array([3])
      const sharedBufferCheckFailure = new Proxy(sharedBufferCheckTarget, {
        get(target, key, receiver) {
          if (key === "buffer") return revokedBuffer.proxy
          return Reflect.get(target, key, receiver)
        },
      })
      const copyTarget = new Uint8Array([4])
      const copyFailure = new Proxy(copyTarget, {
        get(target, key, receiver) {
          if (key === "buffer") return target.buffer
          if (key === "byteLength") return target.byteLength
          return Reflect.get(target, key, receiver)
        },
      })
      const revokedInput = Proxy.revocable(new Uint8Array([5]), {})
      revokedInput.revoke()
      const detached = new Uint8Array([2])
      structuredClone(detached.buffer, { transfer: [detached.buffer] })
      const hostileInputs = [
        bufferAccessFailure,
        lengthAccessFailure,
        sharedBufferCheckFailure,
        copyFailure,
        revokedInput.proxy,
        detached,
      ]
      for (const hostile of hostileInputs) {
        try {
          await sdkOnData!(hostile)
        } catch (error) {
          failures.push(error)
        }
      }
    })

    expect(failures).toHaveLength(6)
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(AdapterContractError)
      expect(failure).toMatchObject({ code: "integrity_failed" })
    }
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
    await createE2bDenyAllCandidate(
      async (options) => {
        e2bOptions = options
        return {} as never
      },
      {
        template: "pinned-template-ref",
        metadata: labels,
        network_policy_sha256: digest("b6"),
        max_runtime_ms: 60_000,
      },
    )
    expect(e2bOptions).toMatchObject({ envs: {}, allowInternetAccess: false, secure: true })

    let daytonaOptions: unknown
    await createDaytonaDenyAllCandidate(
      async (options) => {
        daytonaOptions = options
        return {} as never
      },
      {
        image: "pinned-strong-vm-image-ref",
        labels,
        network_policy_sha256: digest("b6"),
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

  test("E2B candidate create requests empty inputs, deny-all, private, and pause-not-kill on timeout", () => {
    const op = makeOperation("create_inert")
    const options = buildE2bCreateOptions({
      template: "pinned-template-ref",
      metadata: {
        installation_sha256: digest("b1"),
        provider_scope_ref_sha256: digest("b2"),
        ownership_nonce_sha256: digest("b3"),
        creation_token_sha256: op.target.provider_creation_token_sha256,
        immutable_fingerprint_sha256: op.target.immutable_fingerprint_sha256,
      },
      network_policy_sha256: digest("b6"),
      max_runtime_ms: 60_000,
    })

    expect(options.envs).toEqual({})
    expect(options.allowInternetAccess).toBe(false)
    expect(options.network).toMatchObject({ denyOut: ["0.0.0.0/0"], allowPublicTraffic: false })
    expect(options.lifecycle).toEqual({ onTimeout: { action: "pause", keepMemory: false }, autoResume: false })
    expect(options.metadata).toMatchObject({
      "hasna.creation_token_sha256": op.target.provider_creation_token_sha256,
      "hasna.immutable_fingerprint_sha256": op.target.immutable_fingerprint_sha256,
      "hasna.network_policy_sha256": digest("b6"),
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
        creation_token_sha256: op.target.provider_creation_token_sha256,
        immutable_fingerprint_sha256: op.target.immutable_fingerprint_sha256,
      },
      network_policy_sha256: digest("b6"),
      resources: { cpu: 2, memory: 4, disk: 20 },
    })

    expect(params.envVars).toEqual({})
    expect(params.public).toBe(false)
    expect(params.ephemeral).toBe(false)
    expect(params.autoDeleteInterval).toBe(-1)
    expect(params.networkBlockAll).toBe(true)
    expect(params.resources).toEqual({ cpu: 2, memory: 4, disk: 20 })
    expect(params.labels).toMatchObject({
      "hasna.creation_token_sha256": op.target.provider_creation_token_sha256,
      "hasna.immutable_fingerprint_sha256": op.target.immutable_fingerprint_sha256,
      "hasna.network_policy_sha256": digest("b6"),
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
      expect(Object.isFrozen(OFFICIAL_SDK_CONTRACT_GAPS[provider])).toBe(true)
      expect(Object.isFrozen(OFFICIAL_SDK_CONTRACT_GAPS[provider].gaps)).toBe(true)
      expect(OFFICIAL_SDK_CONTRACT_GAPS[provider].gaps).toEqual(
        expect.arrayContaining([
          "create_stopped_unavailable_in_pinned_sdk",
          "creation_metadata_filter_consistency_live_evidence",
          "fixed_broker_bootstrap_and_transport_live_evidence",
          "delete_absence_consistency_live_evidence",
          "conditional_destroy_unavailable_in_pinned_sdk",
          "authenticated_broker_attestation_and_replay_evidence",
          "strong_vm_live_evidence",
        ]),
      )
      expect(OFFICIAL_SDK_CONTRACT_GAPS[provider].compensated_in_adapter).toEqual(
        expect.arrayContaining([
          "creation_token_metadata_plus_exact_lookup_plus_lifecycle_lock",
          "fixed_bootstrap_plus_typed_guest_broker_frames",
        ]),
      )
      expect(OFFICIAL_SDK_CONTRACT_GAPS[provider].official_api_evidence.length).toBeGreaterThan(0)
    }
  })
})

describe("official SDK read-only control bridges", () => {
  const installationSha256 = digest("c1")
  const providerScopeRefSha256 = digest("c2")
  const creationTokenSha256 = digest("c3")
  const immutableFingerprintSha256 = digest("c4")
  const networkPolicySha256 = digest("c5")
  const observedAt = "2026-07-10T10:00:04.000Z"

  function labels() {
    return {
      "hasna.installation_sha256": installationSha256,
      "hasna.provider_scope_ref_sha256": providerScopeRefSha256,
      "hasna.ownership_nonce_sha256": digest("c6"),
      "hasna.creation_token_sha256": creationTokenSha256,
      "hasna.immutable_fingerprint_sha256": immutableFingerprintSha256,
      "hasna.network_policy_sha256": networkPolicySha256,
    }
  }

  function attestation(): ManagedResourceAttestationPortV1 {
    return {
      async attest() {
        return {
          source_free: true,
          credential_free: true,
          strong_vm: true,
          architecture: "amd64",
          evidence_sha256: digest("c7"),
        }
      },
    }
  }

  test("E2B maps exact metadata-filtered paused resources without enabling mutations", async () => {
    let listOptions: Parameters<E2bOfficialReadSdkV1["list"]>[0] | undefined
    const info = {
      sandboxId: "opaque-e2b-1",
      templateId: "template-1",
      metadata: labels(),
      startedAt: new Date("2026-07-10T09:00:00.000Z"),
      endAt: new Date("2026-07-10T11:00:00.000Z"),
      state: "paused",
      cpuCount: 2,
      memoryMB: 4096,
      envdVersion: "pinned",
      allowInternetAccess: false,
      network: { denyOut: ["0.0.0.0/0"], allowPublicTraffic: false },
      lifecycle: { onTimeout: "pause", autoResume: false },
      volumeMounts: [],
    } as const
    const sdk: E2bOfficialReadSdkV1 = {
      list(options) {
        listOptions = options
        return {
          hasNext: true,
          nextToken: "next-e2b-page",
          async nextItems() {
            return [info as never]
          },
        }
      },
      async getInfo() {
        return info as never
      },
    }
    const bridge = new E2bOfficialSdkControlBridgeV1(
      sdk,
      attestation(),
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    expect((bridge as unknown as Record<string, unknown>).sdk).toBeUndefined()
    expect((bridge as unknown as Record<string, unknown>).attestation).toBeUndefined()
    expect(Reflect.ownKeys(bridge)).not.toContain("sdk")

    const page = await bridge.findByCreationToken(creationTokenSha256, "cursor-1")

    expect(listOptions).toEqual({
      query: {
        metadata: {
          "hasna.installation_sha256": installationSha256,
          "hasna.provider_scope_ref_sha256": providerScopeRefSha256,
          "hasna.creation_token_sha256": creationTokenSha256,
        },
      },
      limit: 100,
      nextToken: "cursor-1",
    })
    expect(page.next_cursor).toBe("next-e2b-page")
    expect(page.items[0]).toMatchObject({
      opaque_resource_id: "opaque-e2b-1",
      provider_creation_token_sha256: creationTokenSha256,
      immutable_fingerprint_sha256: immutableFingerprintSha256,
      state: "inert",
      provider_runtime_state: "paused",
      auto_delete_disabled: true,
      ephemeral: false,
      owned: true,
      source_attached: false,
      credential_attached: false,
      network_policy: {
        mode: "deny_all",
        policy_sha256: networkPolicySha256,
        enforced_outside_guest: true,
        public_ingress: false,
        dns_denied: true,
        observed_at: observedAt,
      },
    })
    expect(bridge.capabilities).toMatchObject({
      exact_creation_token_lookup: true,
      ownership_inventory: true,
      create_stopped: false,
      conditional_destroy: false,
    })
    await expect(bridge.createInert({} as never)).rejects.toMatchObject({
      code: "unsupported_runtime_feature",
    })
  })

  test("Daytona maps exact label-filtered stopped resources and bounds inventory", async () => {
    let listQuery: Parameters<DaytonaOfficialReadSdkV1["list"]>[0] | undefined
    let refreshCalls = 0
    const sandbox = {
      id: "opaque-daytona-1",
      organizationId: "organization-1",
      labels: labels(),
      state: "stopped",
      public: false,
      networkBlockAll: true,
      autoDeleteInterval: -1,
      volumes: [],
      env: {},
      createdAt: "2026-07-10T09:00:00.000Z",
      async refreshData() {
        refreshCalls += 1
      },
    }
    const sdk: DaytonaOfficialReadSdkV1 = {
      list(query) {
        listQuery = query
        return (async function* () {
          yield sandbox as never
        })()
      },
      async get() {
        return sandbox as never
      },
    }
    const bridge = new DaytonaOfficialSdkControlBridgeV1(
      sdk,
      attestation(),
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    expect((bridge as unknown as Record<string, unknown>).sdk).toBeUndefined()
    expect((bridge as unknown as Record<string, unknown>).attestation).toBeUndefined()
    expect(Reflect.ownKeys(bridge)).not.toContain("sdk")

    const page = await bridge.findByCreationToken(creationTokenSha256)

    expect(listQuery).toEqual({
      labels: {
        "hasna.installation_sha256": installationSha256,
        "hasna.provider_scope_ref_sha256": providerScopeRefSha256,
        "hasna.creation_token_sha256": creationTokenSha256,
      },
      limit: 100,
    })
    expect(refreshCalls).toBe(1)
    expect(page.items[0]).toMatchObject({
      opaque_resource_id: "opaque-daytona-1",
      state: "inert",
      provider_runtime_state: "stopped",
      auto_delete_disabled: true,
      ephemeral: false,
      owned: true,
      source_attached: false,
      credential_attached: false,
      network_policy: { policy_sha256: networkPolicySha256, observed_at: observedAt },
    })
    await expect(bridge.listOwnedResources("unresumable-cursor")).rejects.toMatchObject({
      code: "unsupported_runtime_feature",
    })
    await expect(bridge.destroyResource("opaque-daytona-1", "version-1", {} as never)).rejects.toMatchObject({
      code: "unsupported_runtime_feature",
    })
  })

  test("untrusted strong-VM attestation cannot produce an adoptable owned resource", async () => {
    const info = {
      sandboxId: "opaque-e2b-unsafe",
      templateId: "template-1",
      metadata: labels(),
      startedAt: new Date("2026-07-10T09:00:00.000Z"),
      endAt: new Date("2026-07-10T11:00:00.000Z"),
      state: "paused",
      cpuCount: 2,
      memoryMB: 4096,
      envdVersion: "pinned",
      allowInternetAccess: false,
      network: { denyOut: ["0.0.0.0/0"], allowPublicTraffic: false },
      lifecycle: { onTimeout: "pause", autoResume: false },
      volumeMounts: [],
    } as const
    const sdk: E2bOfficialReadSdkV1 = {
      list() {
        return {
          hasNext: true,
          nextToken: undefined,
          async nextItems() {
            return [info as never]
          },
        }
      },
      async getInfo() {
        return info as never
      },
    }
    const unsafeAttestation: ManagedResourceAttestationPortV1 = {
      async attest() {
        return {
          source_free: true,
          credential_free: true,
          strong_vm: false,
          architecture: "amd64",
          evidence_sha256: digest("c8"),
        }
      },
    }
    const bridge = new E2bOfficialSdkControlBridgeV1(
      sdk,
      unsafeAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )

    expect((await bridge.findByCreationToken(creationTokenSha256)).items[0]?.owned).toBe(false)
  })

  test("malformed attestation evidence is rejected instead of becoming ownership", async () => {
    const info = {
      sandboxId: "opaque-e2b-malformed-attestation",
      templateId: "template-1",
      metadata: labels(),
      startedAt: new Date("2026-07-10T09:00:00.000Z"),
      endAt: new Date("2026-07-10T11:00:00.000Z"),
      state: "paused",
      cpuCount: 2,
      memoryMB: 4096,
      envdVersion: "pinned",
      allowInternetAccess: false,
      network: { denyOut: ["0.0.0.0/0"], allowPublicTraffic: false },
      lifecycle: { onTimeout: "pause", autoResume: false },
      volumeMounts: [],
    } as const
    const sdk: E2bOfficialReadSdkV1 = {
      list() {
        return {
          hasNext: true,
          nextToken: undefined,
          async nextItems() {
            return [info as never]
          },
        }
      },
      async getInfo() {
        return info as never
      },
    }
    const malformed: ManagedResourceAttestationPortV1 = {
      async attest() {
        return {
          source_free: "yes",
          credential_free: true,
          strong_vm: "yes",
          architecture: "amd64",
          evidence_sha256: digest("c9"),
        } as never
      },
    }
    const bridge = new E2bOfficialSdkControlBridgeV1(
      sdk,
      malformed,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )

    await expect(bridge.findByCreationToken(creationTokenSha256)).rejects.toMatchObject({
      code: "integrity_failed",
    })
  })
})
