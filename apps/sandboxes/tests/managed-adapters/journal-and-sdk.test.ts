import { describe, expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import * as managedPublicApi from "../../src/adapters/managed/index"
import { parseCanonicalJson } from "../../src/adapters/managed/canonical"
import {
  AdapterContractError,
  JournalIdentityLedgerV1,
  buildDaytonaCreateParams,
  buildDaytonaExactOwnershipListQuery,
  buildE2bCreateOptions,
  buildE2bExactOwnershipListOptions,
  canonicalJson,
  canonicalSha256,
  DAYTONA_GUEST_BROKER_MAX_IN_FLIGHT_BYTES,
  DAYTONA_GUEST_BROKER_MAX_IN_FLIGHT_DELIVERIES,
  DAYTONA_SDK_PIN,
  daytonaImageMappingSha256,
  DaytonaOfficialSdkControlBridgeV1,
  decodeGuestBrokerRequestFrame,
  E2B_SDK_PIN,
  E2bOfficialSdkControlBridgeV1,
  encodeGuestBrokerRequestFrame,
  managedProviderRequestSha256,
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  MANAGED_GUEST_BROKER_MAX_FRAME_BYTES,
  MANAGED_GUEST_BROKER_PROTOCOL_SHA256,
  OFFICIAL_SDK_CONTRACT_GAPS,
  validateAdapterCallContext,
  validateWorkspacePath,
  type FailedNoEffectAuthorizationV1,
  type DaytonaOfficialReadSdkV1,
  type DaytonaOfficialLifecycleSdkV1,
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
    expect(manifest.types).toBe("./dist/index.d.ts")
    // R1 iapp migration: the published surface is the SDK (`.`) + MCP (`./mcp`).
    // The domain repository + managed adapters are now SERVER-INTERNAL (used by
    // sandboxes-serve) and are intentionally not client package exports.
    expect(manifest.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      },
      "./mcp": {
        types: "./dist/mcp.d.ts",
        import: "./dist/mcp.js",
        default: "./dist/mcp.js",
      },
    })
    expect(manifest.files).toEqual(["dist", "migrations", "schemas", "README.md", "LICENSE"])
    expect(manifest.dependencies?.["@types/ws"]).toBe("8.18.1")
    expect(manifest.scripts?.prepack).toBe("bun run build")
    expect(managedPublicApi.DAYTONA_GUEST_BROKER_PTY_ID).toBe("hasna-sandboxes-broker-v1")
    expect(MANAGED_GUEST_BROKER_MAX_FRAME_BYTES).toBe(16 * 1024 * 1024)
    expect(DAYTONA_GUEST_BROKER_MAX_IN_FLIGHT_DELIVERIES).toBe(8)
    expect(DAYTONA_GUEST_BROKER_MAX_IN_FLIGHT_BYTES).toBe(
      MANAGED_GUEST_BROKER_MAX_FRAME_BYTES,
    )
    expect(managedPublicApi.createDaytonaDenyAllCandidate).toBe(createDaytonaDenyAllCandidate)
    expect(managedPublicApi.createE2bDenyAllCandidate).toBe(createE2bDenyAllCandidate)
    expect(managedPublicApi.withDaytonaGuestBrokerSdkSession).toBe(
      withDaytonaGuestBrokerSdkSession,
    )
    expect(
      (managedPublicApi as Record<string, unknown>).withE2bGuestBrokerSdkSession,
    ).toBeUndefined()
    expect(
      (managedPublicApi as Record<string, unknown>).withE2bGuestBrokerDuplexSdkSession,
    ).toBeUndefined()

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

  test("canonical domains are injective across scalars, bytes, arrays, and records", () => {
    const collisionCorpus: unknown[] = [
      null,
      false,
      0,
      1,
      "1",
      1n,
      new Uint8Array([1]),
      [],
      ["record"],
      {},
      { $bigint: "1" },
      { $bytes_hex: "01" },
      { 0: "record" },
    ]
    expect(new Set(collisionCorpus.map(canonicalSha256)).size).toBe(collisionCorpus.length)
    expect(canonicalSha256(1n)).not.toBe(canonicalSha256({ $bigint: "1" }))
    expect(canonicalSha256(new Uint8Array([1]))).not.toBe(
      canonicalSha256({ $bytes_hex: "01" }),
    )
    expect(canonicalSha256(new TextEncoder().encode(canonicalJson({ value: 1 })))).not.toBe(
      canonicalSha256({ value: 1 }),
    )
    expect(canonicalSha256(["record"])).not.toBe(canonicalSha256({ 0: "record" }))
  })

  test("canonical hashing rejects ambiguous JSON values", () => {
    expect(() => canonicalSha256({ value: Number.NaN })).toThrow("non_canonical_value")
    expect(() => canonicalSha256({ value: Number.POSITIVE_INFINITY })).toThrow("non_canonical_value")
    expect(() => canonicalSha256({ value: -0 })).toThrow("non_canonical_value")
    expect(() => canonicalSha256({ value: undefined })).toThrow("non_canonical_value")
    expect(() => canonicalSha256({ value: new Date(0) })).toThrow("non_canonical_value")
  })

  test("canonical records preserve special own keys and reject hidden behavior", () => {
    const special = JSON.parse(
      '{"__proto__":"proto-entry","constructor":"constructor-entry","prototype":"prototype-entry"}',
    )
    expect(canonicalJson(special)).toBe(
      '["record",[["__proto__",["string","proto-entry"]],["constructor",["string","constructor-entry"]],["prototype",["string","prototype-entry"]]]]',
    )
    expect(Object.getPrototypeOf(special)).toBe(Object.prototype)
    const decodedSpecial = parseCanonicalJson(canonicalJson(special)) as Record<string, unknown>
    expect(Object.getPrototypeOf(decodedSpecial)).toBeNull()
    expect(decodedSpecial).toEqual(special)
    expect(Object.hasOwn(decodedSpecial, "__proto__")).toBe(true)

    let getterCalls = 0
    const accessor = {}
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get() {
        getterCalls += 1
        return "hostile"
      },
    })
    expect(() => canonicalJson(accessor)).toThrow("non_canonical_value")
    expect(getterCalls).toBe(0)

    const symbolRecord = { value: "safe" }
    Object.defineProperty(symbolRecord, Symbol("hostile"), {
      enumerable: true,
      value: "hidden",
    })
    expect(() => canonicalJson(symbolRecord)).toThrow("non_canonical_value")

    const nonEnumerable = { value: "safe" }
    Object.defineProperty(nonEnumerable, "hidden", { value: "hidden" })
    expect(() => canonicalJson(nonEnumerable)).toThrow("non_canonical_value")
  })

  test("canonical arrays require dense own data indexes without invoking accessors", () => {
    expect(canonicalJson(runInNewContext('["safe"]'))).toBe(canonicalJson(["safe"]))

    const sparse = ["safe"]
    sparse.length = 2
    expect(() => canonicalJson(sparse)).toThrow("non_canonical_value")

    let getterCalls = 0
    const accessor: string[] = []
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        getterCalls += 1
        return "hostile"
      },
    })
    expect(() => canonicalJson(accessor)).toThrow("non_canonical_value")
    expect(getterCalls).toBe(0)

    const nonEnumerable = ["safe"]
    Object.defineProperty(nonEnumerable, "0", { enumerable: false, value: "hidden" })
    expect(() => canonicalJson(nonEnumerable)).toThrow("non_canonical_value")

    const extraStringKey = ["safe"]
    Object.defineProperty(extraStringKey, "extra", { enumerable: true, value: "hidden" })
    expect(() => canonicalJson(extraStringKey)).toThrow("non_canonical_value")

    const extraSymbolKey = ["safe"]
    Object.defineProperty(extraSymbolKey, Symbol("extra"), { enumerable: true, value: "hidden" })
    expect(() => canonicalJson(extraSymbolKey)).toThrow("non_canonical_value")
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
  type BrokerSession = Parameters<Parameters<typeof withE2bGuestBrokerSdkSession>[1]>[0]
  type Settled<T> =
    | { status: "fulfilled"; value: T }
    | { status: "rejected"; reason: unknown }

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

  async function settle<T>(operation: () => Promise<T>): Promise<Settled<T>> {
    try {
      return { status: "fulfilled", value: await operation() }
    } catch (reason) {
      return { status: "rejected", reason }
    }
  }

  function runBrokerSession(
    provider: "e2b" | "daytona",
    close: () => Promise<void>,
    use: (session: BrokerSession) => Promise<void>,
    send: (bytes: Uint8Array) => Promise<void> = async () => {},
  ): Promise<void> {
    if (provider === "e2b") {
      const commands = {
        async run() {
          return {
            sendStdin: send,
            closeStdin: close,
          }
        },
      } as unknown as E2bOfficialBrokerCommandsV1
      return withE2bGuestBrokerSdkSession(commands, use)
    }

    const process = {
      async createPty() {
        return {
          async waitForConnection() {},
          sendInput: send,
          disconnect: close,
        }
      },
    } as unknown as DaytonaOfficialBrokerProcessV1
    return withDaytonaGuestBrokerSdkSession(process, () => {}, use)
  }

  function replacePromiseMethods(): {
    replacementRawRejection: string
    replacementResult: { readonly kind: "replacement_result" }
    restore: () => void
  } {
    const promiseConstructor = Promise
    const originalApply = Reflect.apply
    const originalThen = promiseConstructor.prototype.then
    const originalResolve = promiseConstructor.resolve
    const originalReject = promiseConstructor.reject
    const replacementRawRejection = "replacement_raw_rejection"
    const replacementResult = { kind: "replacement_result" } as const

    promiseConstructor.prototype.then = (function replacementThen() {
      return originalApply(originalResolve, promiseConstructor, [replacementResult])
    }) as typeof originalThen
    promiseConstructor.resolve = (function replacementResolve() {
      return originalApply(originalReject, promiseConstructor, [replacementRawRejection])
    }) as typeof originalResolve
    promiseConstructor.reject = (function replacementReject() {
      return originalApply(originalResolve, promiseConstructor, [replacementResult])
    }) as typeof originalReject

    return {
      replacementRawRejection,
      replacementResult,
      restore() {
        promiseConstructor.prototype.then = originalThen
        promiseConstructor.resolve = originalResolve
        promiseConstructor.reject = originalReject
      },
    }
  }

  function replacePromiseSpecies(
    mode: "invalid_species" | "substitute_species",
  ): { restore: () => void } {
    const promiseConstructor = Promise
    const speciesDescriptor = Object.getOwnPropertyDescriptor(
      promiseConstructor,
      Symbol.species,
    )!

    if (mode === "invalid_species") {
      Object.defineProperty(promiseConstructor, Symbol.species, {
        configurable: true,
        value: {},
      })
    } else {
      const replacementSpecies = function ReplacementPromiseSpecies() {
        throw new Error("replacement Promise species invoked")
      }
      Object.defineProperty(promiseConstructor, Symbol.species, {
        configurable: true,
        value: replacementSpecies,
      })
    }

    return {
      restore() {
        Object.defineProperty(promiseConstructor, Symbol.species, speciesDescriptor)
      },
    }
  }

  function replaceGlobalPromiseConstructor(): { restore: () => void } {
    const intrinsicPromise = globalThis.Promise
    const replacement = function ReplacementPromiseConstructor() {
      throw new Error("replacement Promise constructor invoked")
    } as unknown as PromiseConstructor
    replacement.resolve = (() => {
      throw new Error("replacement Promise.resolve invoked")
    }) as PromiseConstructor["resolve"]
    replacement.reject = (() => {
      throw new Error("replacement Promise.reject invoked")
    }) as PromiseConstructor["reject"]
    replacement.all = (() => {
      throw new Error("replacement Promise.all invoked")
    }) as PromiseConstructor["all"]
    replacement.allSettled = (() => {
      throw new Error("replacement Promise.allSettled invoked")
    }) as PromiseConstructor["allSettled"]
    replacement.any = (() => {
      throw new Error("replacement Promise.any invoked")
    }) as PromiseConstructor["any"]
    replacement.race = (() => {
      throw new Error("replacement Promise.race invoked")
    }) as PromiseConstructor["race"]
    replacement.withResolvers = (() => {
      throw new Error("replacement Promise.withResolvers invoked")
    }) as PromiseConstructor["withResolvers"]
    Object.defineProperty(replacement, Symbol.species, {
      configurable: true,
      value: replacement,
    })
    globalThis.Promise = replacement
    return {
      restore() {
        globalThis.Promise = intrinsicPromise
      },
    }
  }

  type PromisePrototypeAttackMode =
    | "throwing_constructor"
    | "substitute_constructor"
    | "constructor_then_species"

  function replacePromisePrototype(
    mode: PromisePrototypeAttackMode,
  ): { restore: () => void; thenCalls: () => number } {
    const promiseConstructor = Promise
    const promisePrototype = promiseConstructor.prototype
    const constructorDescriptor = Object.getOwnPropertyDescriptor(
      promisePrototype,
      "constructor",
    )!
    const thenDescriptor = Object.getOwnPropertyDescriptor(promisePrototype, "then")!
    const speciesDescriptor = Object.getOwnPropertyDescriptor(
      promiseConstructor,
      Symbol.species,
    )!
    const originalApply = Reflect.apply
    const originalResolve = promiseConstructor.resolve
    let replacementThenCalls = 0

    if (mode === "throwing_constructor") {
      Object.defineProperty(promisePrototype, "constructor", {
        configurable: true,
        get() {
          throw new Error("replacement Promise constructor getter invoked")
        },
      })
    } else {
      const substituteConstructor = function SubstitutePromiseConstructor() {
        throw new Error("substitute Promise constructor invoked")
      } as unknown as PromiseConstructor
      const substituteSpecies = function SubstitutePromiseSpecies() {
        throw new Error("substitute Promise species invoked")
      }
      Object.defineProperty(substituteConstructor, Symbol.species, {
        configurable: true,
        value: substituteSpecies,
      })
      Object.defineProperty(promisePrototype, "constructor", {
        configurable: true,
        value: substituteConstructor,
        writable: true,
      })
    }

    if (mode === "constructor_then_species") {
      promisePrototype.then = (function replacementThen() {
        replacementThenCalls += 1
        return originalApply(originalResolve, promiseConstructor, [undefined])
      }) as typeof promisePrototype.then
      Object.defineProperty(promiseConstructor, Symbol.species, {
        configurable: true,
        value: {},
      })
    }

    return {
      restore() {
        Object.defineProperty(promiseConstructor, Symbol.species, speciesDescriptor)
        Object.defineProperty(promisePrototype, "then", thenDescriptor)
        Object.defineProperty(promisePrototype, "constructor", constructorDescriptor)
      },
      thenCalls() {
        return replacementThenCalls
      },
    }
  }

  type ProviderPromiseShape =
    | "cross_realm"
    | "frozen"
    | "non_extensible"
    | "own_nonconfig"

  function shapeProviderPromise<T>(
    shape: ProviderPromiseShape,
    outcome: { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown },
    preobserveRejection = true,
  ): Promise<T> {
    const promise = shape === "cross_realm"
      ? runInNewContext(
          outcome.status === "fulfilled"
            ? "Promise.resolve(value)"
            : "Promise.reject(reason)",
          outcome.status === "fulfilled" ? { value: outcome.value } : { reason: outcome.reason },
        ) as Promise<T>
      : outcome.status === "fulfilled"
        ? Promise.resolve(outcome.value)
        : Promise.reject(outcome.reason)

    if (outcome.status === "rejected" && preobserveRejection) {
      void promise.then(undefined, () => undefined)
    }
    if (shape === "frozen") Object.freeze(promise)
    if (shape === "non_extensible") Object.preventExtensions(promise)
    if (shape === "own_nonconfig") {
      Object.defineProperty(promise, "constructor", {
        configurable: false,
        value: promise.constructor,
        writable: false,
      })
      Object.defineProperty(promise, "then", {
        configurable: false,
        value: promise.then,
        writable: false,
      })
    }
    return promise
  }

  function promiseSurface(promise: Promise<unknown>): object {
    return {
      constructor: Object.getOwnPropertyDescriptor(promise, "constructor"),
      extensible: Object.isExtensible(promise),
      frozen: Object.isFrozen(promise),
      keys: Reflect.ownKeys(promise),
      then: Object.getOwnPropertyDescriptor(promise, "then"),
    }
  }

  function expectNativeOwnedPromise(promise: Promise<unknown>): void {
    expect(Object.hasOwn(promise, "constructor")).toBe(false)
    expect(Object.hasOwn(promise, "then")).toBe(false)
    expect(promise.constructor).toBe(Promise)
    expect(Promise.resolve(promise)).toBe(promise)
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

  test("captured Promise methods preserve transient close joining and retry", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      let closeCalls = 0
      let joined = false
      let firstClose: Settled<void> | undefined
      let joinedClose: Settled<void> | undefined
      let retryClose: Settled<void> | undefined
      let wrapper: Settled<void> | undefined
      const replacements = replacePromiseMethods()
      try {
        wrapper = await settle(() =>
          runBrokerSession(
            provider,
            async () => {
              closeCalls += 1
              if (closeCalls === 1) throw new Error("transient close failure")
            },
            async (session) => {
              const first = session.closeInput()
              const concurrent = session.closeInput()
              joined = first === concurrent
              firstClose = await settle(() => first)
              joinedClose = await settle(() => concurrent)
              retryClose = await settle(() => session.closeInput())
            },
          ),
        )
      } finally {
        replacements.restore()
      }

      expect(closeCalls).toBe(2)
      expect(joined).toBe(true)
      expect(firstClose).toMatchObject({ status: "rejected" })
      expect(joinedClose).toMatchObject({ status: "rejected" })
      expect(retryClose).toEqual({ status: "fulfilled", value: undefined })
      expect(wrapper).toEqual({ status: "fulfilled", value: undefined })
    }
  })

  test("captured Promise methods preserve closed send and successful finalization", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      let closeCalls = 0
      let closedSend: Settled<void> | undefined
      let wrapper: Settled<void> | undefined
      const replacements = replacePromiseMethods()
      try {
        wrapper = await settle(() =>
          runBrokerSession(
            provider,
            async () => {
              closeCalls += 1
            },
            async (session) => {
              await session.closeInput()
              closedSend = await settle(() => session.sendFrame(brokerFrame()))
            },
          ),
        )
      } finally {
        replacements.restore()
      }

      expect(closeCalls).toBe(1)
      expect(closedSend?.status).toBe("rejected")
      if (closedSend?.status === "rejected") {
        expect(closedSend.reason).toBeInstanceOf(Error)
        expect((closedSend.reason as Error).message).toBe("guest_broker_session_closed")
      }
      expect(wrapper).toEqual({ status: "fulfilled", value: undefined })
    }
  })

  test("captured Promise methods preserve persistent finalizer failure and sealing", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      let closeCalls = 0
      let retainedSession: BrokerSession | undefined
      let wrapper: Settled<void> | undefined
      let closedSend: Settled<void> | undefined
      const replacements = replacePromiseMethods()
      try {
        wrapper = await settle(() =>
          runBrokerSession(
            provider,
            async () => {
              closeCalls += 1
              throw new Error("persistent close failure")
            },
            async (session) => {
              retainedSession = session
            },
          ),
        )
        closedSend = await settle(() => retainedSession!.sendFrame(brokerFrame()))
      } finally {
        replacements.restore()
      }

      expect(closeCalls).toBe(2)
      expect(wrapper?.status).toBe("rejected")
      if (wrapper?.status === "rejected") {
        expect(wrapper.reason).toBeInstanceOf(Error)
        expect((wrapper.reason as Error).message).toBe("persistent close failure")
      }
      expect(closedSend?.status).toBe("rejected")
      if (closedSend?.status === "rejected") {
        expect(closedSend.reason).toBeInstanceOf(Error)
        expect((closedSend.reason as Error).message).toBe("guest_broker_session_closed")
      }
    }
  })

  test("Promise species replacements do not interrupt transient close observation", async () => {
    const results: Array<{
      closeCalls: number
      closeReturned: boolean
      provider: "e2b" | "daytona"
      mode: "invalid_species" | "substitute_species"
      synchronousFailure: unknown
      wrapper: Settled<void> | undefined
    }> = []

    for (const provider of ["e2b", "daytona"] as const) {
      for (const mode of ["invalid_species", "substitute_species"] as const) {
        let closeCalls = 0
        let closeReturned = false
        let synchronousFailure: unknown
        let wrapper: Settled<void> | undefined
        const replacement = replacePromiseSpecies(mode)
        try {
          wrapper = await settle(() =>
            runBrokerSession(
              provider,
              async () => {
                closeCalls += 1
                if (closeCalls === 1) {
                  await new Promise<void>((_resolve, reject) => {
                    setTimeout(() => reject(new Error("transient close failure")), 0)
                  })
                }
              },
              async (session) => {
                try {
                  session.closeInput()
                  closeReturned = true
                } catch (error) {
                  synchronousFailure = error
                }
              },
            ),
          )
        } finally {
          replacement.restore()
        }
        results.push({ closeCalls, closeReturned, provider, mode, synchronousFailure, wrapper })
      }
    }

    for (const result of results) {
      expect(result.closeCalls).toBe(2)
      expect(result.closeReturned).toBe(true)
      expect(result.synchronousFailure).toBeUndefined()
      expect(result.wrapper).toEqual({ status: "fulfilled", value: undefined })
    }
  })

  test("Promise species replacements preserve persistent failure and sealing", async () => {
    const results: Array<{
      closeCalls: number
      closedSend: Settled<void> | undefined
      provider: "e2b" | "daytona"
      mode: "invalid_species" | "substitute_species"
      wrapper: Settled<void> | undefined
    }> = []

    for (const provider of ["e2b", "daytona"] as const) {
      for (const mode of ["invalid_species", "substitute_species"] as const) {
        let closeCalls = 0
        let retainedSession: BrokerSession | undefined
        let wrapper: Settled<void> | undefined
        let closedSend: Settled<void> | undefined
        const replacement = replacePromiseSpecies(mode)
        try {
          wrapper = await settle(() =>
            runBrokerSession(
              provider,
              async () => {
                closeCalls += 1
                throw new Error("persistent close failure")
              },
              async (session) => {
                retainedSession = session
              },
            ),
          )
          closedSend = await settle(() => retainedSession!.sendFrame(brokerFrame()))
        } finally {
          replacement.restore()
        }
        results.push({ closeCalls, closedSend, provider, mode, wrapper })
      }
    }

    for (const result of results) {
      expect(result.closeCalls).toBe(2)
      expect(result.wrapper?.status).toBe("rejected")
      if (result.wrapper?.status === "rejected") {
        expect(result.wrapper.reason).toBeInstanceOf(Error)
        expect((result.wrapper.reason as Error).message).toBe("persistent close failure")
      }
      expect(result.closedSend?.status).toBe("rejected")
      if (result.closedSend?.status === "rejected") {
        expect(result.closedSend.reason).toBeInstanceOf(Error)
        expect((result.closedSend.reason as Error).message).toBe("guest_broker_session_closed")
      }
    }
  })

  test("Promise species replacements preserve send, joined close, retry, and finalization", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      for (const mode of ["invalid_species", "substitute_species"] as const) {
        let closeCalls = 0
        let sendCalls = 0
        let joined = false
        let firstClose: Settled<void> | undefined
        let joinedClose: Settled<void> | undefined
        let resumedSend: Settled<void> | undefined
        let retryClose: Settled<void> | undefined
        let closedSend: Settled<void> | undefined
        let wrapper: Settled<void> | undefined
        const replacement = replacePromiseSpecies(mode)
        try {
          wrapper = await settle(() =>
            runBrokerSession(
              provider,
              async () => {
                closeCalls += 1
                if (closeCalls === 1) throw new Error("transient close failure")
              },
              async (session) => {
                await session.sendFrame(brokerFrame())
                const first = session.closeInput()
                const concurrent = session.closeInput()
                joined = first === concurrent
                firstClose = await settle(() => first)
                joinedClose = await settle(() => concurrent)
                resumedSend = await settle(() => session.sendFrame(brokerFrame()))
                retryClose = await settle(() => session.closeInput())
                closedSend = await settle(() => session.sendFrame(brokerFrame()))
              },
              async () => {
                sendCalls += 1
              },
            ),
          )
        } finally {
          replacement.restore()
        }

        expect(sendCalls).toBe(provider === "daytona" ? 3 : 2)
        expect(closeCalls).toBe(2)
        expect(joined).toBe(true)
        expect(firstClose?.status).toBe("rejected")
        expect(joinedClose?.status).toBe("rejected")
        expect(resumedSend).toEqual({ status: "fulfilled", value: undefined })
        expect(retryClose).toEqual({ status: "fulfilled", value: undefined })
        expect(closedSend?.status).toBe("rejected")
        expect(wrapper).toEqual({ status: "fulfilled", value: undefined })
      }
    }
  })

  test("post-import Promise constructor replacement cannot redirect broker promises", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      let closeCalls = 0
      let closedSend: Settled<void> | undefined
      let wrapper: Settled<void> | undefined
      const replacement = replaceGlobalPromiseConstructor()
      try {
        wrapper = await settle(() =>
          runBrokerSession(
            provider,
            async () => {
              closeCalls += 1
            },
            async (session) => {
              await session.sendFrame(brokerFrame())
              await session.closeInput()
              closedSend = await settle(() => session.sendFrame(brokerFrame()))
            },
          ),
        )
      } finally {
        replacement.restore()
      }

      expect(closeCalls).toBe(1)
      expect(closedSend?.status).toBe("rejected")
      if (closedSend?.status === "rejected") {
        expect(closedSend.reason).toBeInstanceOf(Error)
        expect((closedSend.reason as Error).message).toBe("guest_broker_session_closed")
      }
      expect(wrapper).toEqual({ status: "fulfilled", value: undefined })
    }
  })

  test("owned scope wrappers never mutate supported frozen, non-extensible, or own-nonconfig setup promises", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      for (const shape of ["frozen", "non_extensible", "own_nonconfig"] as const) {
        const handle = provider === "e2b"
          ? {
              async sendStdin() {},
              async closeStdin() {},
            }
          : {
              async waitForConnection() {},
              async sendInput() {},
              async disconnect() {},
            }
        const rawSetup = shapeProviderPromise(shape, { status: "fulfilled", value: handle })
        const before = promiseSurface(rawSetup)
        const wrapper = provider === "e2b"
          ? withE2bGuestBrokerSdkSession(
              { run: () => rawSetup } as unknown as E2bOfficialBrokerCommandsV1,
              async () => {},
            )
          : withDaytonaGuestBrokerSdkSession(
              { createPty: () => rawSetup } as unknown as DaytonaOfficialBrokerProcessV1,
              () => {},
              async () => {},
            )
        const result = await settle(() => wrapper)

        expect(result).toEqual({ status: "fulfilled", value: undefined })
        expect(promiseSurface(rawSetup)).toEqual(before)
        expectNativeOwnedPromise(wrapper)
      }
    }
  })

  test("scope wrappers reject cross-realm setup promises without observing hostile own fields", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      let thenGetterCalls = 0
      let thenCalls = 0
      const handle = provider === "e2b"
        ? {
            async sendStdin() {},
            async closeStdin() {},
          }
        : {
            async waitForConnection() {},
            async sendInput() {},
            async disconnect() {},
          }
      const rawSetup = shapeProviderPromise("cross_realm", {
        status: "fulfilled",
        value: handle,
      })
      let constructorGetterCalls = 0
      Object.defineProperty(rawSetup, "constructor", {
        configurable: false,
        get() {
          constructorGetterCalls += 1
          return Promise
        },
      })
      Object.defineProperty(rawSetup, "then", {
        configurable: false,
        get() {
          thenGetterCalls += 1
          return (resolve: (value: unknown) => void) => {
            thenCalls += 1
            resolve(handle)
          }
        },
      })
      const before = promiseSurface(rawSetup)
      const wrapper = provider === "e2b"
        ? withE2bGuestBrokerSdkSession(
            { run: () => rawSetup } as unknown as E2bOfficialBrokerCommandsV1,
            async () => {},
          )
        : withDaytonaGuestBrokerSdkSession(
            { createPty: () => rawSetup } as unknown as DaytonaOfficialBrokerProcessV1,
            () => {},
            async () => {},
          )
      const result = await settle(() => wrapper)

      expect(result.status).toBe("rejected")
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(AdapterContractError)
        expect(result.reason).toMatchObject({ code: "integrity_failed" })
      }
      expect(constructorGetterCalls).toBe(0)
      expect(thenGetterCalls).toBe(0)
      expect(thenCalls).toBe(0)
      expect(promiseSurface(rawSetup)).toEqual(before)
      expectNativeOwnedPromise(wrapper)
    }
  })

  test("owned scope wrappers preserve frozen rejected use promises and exact errors", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      const useFailure = new Error(`${provider} use failure`)
      const rawUse = shapeProviderPromise<void>("frozen", {
        status: "rejected",
        reason: useFailure,
      })
      const before = promiseSurface(rawUse)
      const use = () => rawUse
      const wrapper = provider === "e2b"
        ? withE2bGuestBrokerSdkSession(
            {
              async run() {
                return { async sendStdin() {}, async closeStdin() {} }
              },
            } as unknown as E2bOfficialBrokerCommandsV1,
            use,
          )
        : withDaytonaGuestBrokerSdkSession(
            {
              async createPty() {
                return {
                  async waitForConnection() {},
                  async sendInput() {},
                  async disconnect() {},
                }
              },
            } as unknown as DaytonaOfficialBrokerProcessV1,
            () => {},
            use,
          )
      const result = await settle(() => wrapper)

      expect(result).toEqual({ status: "rejected", reason: useFailure })
      expect(promiseSurface(rawUse)).toEqual(before)
      expectNativeOwnedPromise(wrapper)
    }
  })

  test("send and close use fresh native wrappers without mutating frozen rejected provider promises", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      const sendFailure = new Error(`${provider} frozen send failure`)
      const closeFailure = new Error(`${provider} frozen close failure`)
      const rawSend = shapeProviderPromise<void>("frozen", {
        status: "rejected",
        reason: sendFailure,
      })
      const rawClose = shapeProviderPromise<void>("frozen", {
        status: "rejected",
        reason: closeFailure,
      })
      const sendBefore = promiseSurface(rawSend)
      const closeBefore = promiseSurface(rawClose)
      let sendCalls = 0
      let closeCalls = 0
      let sendSynchronousFailure: unknown
      let sendWrapper: Promise<void> | undefined
      let closeWrapper: Promise<void> | undefined
      let joinedClose: Promise<void> | undefined
      let sendResult: Settled<void> | undefined
      let closeResult: Settled<void> | undefined

      const send = () => {
        sendCalls += 1
        return rawSend
      }
      const close = () => {
        closeCalls += 1
        return closeCalls === 1 ? rawClose : Promise.resolve()
      }
      const use = async (session: BrokerSession) => {
        try {
          sendWrapper = session.sendFrame(brokerFrame())
        } catch (reason) {
          sendSynchronousFailure = reason
        }
        if (sendWrapper !== undefined) sendResult = await settle(() => sendWrapper!)
        closeWrapper = session.closeInput()
        joinedClose = session.closeInput()
        closeResult = await settle(() => closeWrapper!)
        await session.closeInput()
      }
      const wrapper = provider === "e2b"
        ? withE2bGuestBrokerSdkSession(
            {
              async run() {
                return { sendStdin: send, closeStdin: close }
              },
            } as unknown as E2bOfficialBrokerCommandsV1,
            use,
          )
        : withDaytonaGuestBrokerSdkSession(
            {
              async createPty() {
                return {
                  async waitForConnection() {},
                  sendInput(input: string | Uint8Array) {
                    return typeof input === "string" ? Promise.resolve() : send()
                  },
                  disconnect: close,
                }
              },
            } as unknown as DaytonaOfficialBrokerProcessV1,
            () => {},
            use,
          )
      const wrapperResult = await settle(() => wrapper)

      expect(wrapperResult).toEqual({ status: "fulfilled", value: undefined })
      expect(sendSynchronousFailure).toBeUndefined()
      expect(sendResult).toEqual({ status: "rejected", reason: sendFailure })
      expect(closeResult).toEqual({ status: "rejected", reason: closeFailure })
      expect(joinedClose).toBe(closeWrapper)
      expect(sendCalls).toBe(1)
      expect(closeCalls).toBe(2)
      expect(promiseSurface(rawSend)).toEqual(sendBefore)
      expect(promiseSurface(rawClose)).toEqual(closeBefore)
      expect(sendWrapper).toBeDefined()
      expect(closeWrapper).toBeDefined()
      expectNativeOwnedPromise(sendWrapper!)
      expectNativeOwnedPromise(closeWrapper!)
      expectNativeOwnedPromise(wrapper)
    }
  })

  test("observes a frozen rejected SDK promise before it can become unhandled", async () => {
    const providerFailure = new Error("frozen setup rejection")
    const rawSetup = shapeProviderPromise<never>(
      "frozen",
      { status: "rejected", reason: providerFailure },
      false,
    )
    const before = promiseSurface(rawSetup)
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      const commands = {
        run() {
          return rawSetup
        },
      } as unknown as E2bOfficialBrokerCommandsV1
      const wrapper = withE2bGuestBrokerSdkSession(commands, async () => {})
      const result = await settle(() => wrapper)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      expect(result).toEqual({ status: "rejected", reason: providerFailure })
      expect(unhandled).toEqual([])
      expect(promiseSurface(rawSetup)).toEqual(before)
      expectNativeOwnedPromise(wrapper)
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  test("rejects out-of-contract PromiseLike setup without invoking or rewriting it", async () => {
    let thenCalls = 0
    const thenable = {
      then() {
        thenCalls += 1
      },
    }
    const before = Reflect.ownKeys(thenable)
    const commands = {
      run() {
        return thenable
      },
    } as unknown as E2bOfficialBrokerCommandsV1

    const result = await settle(() => withE2bGuestBrokerSdkSession(commands, async () => {}))
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") {
      expect(result.reason).toBeInstanceOf(AdapterContractError)
      expect(result.reason).toMatchObject({ code: "integrity_failed" })
    }
    expect(thenCalls).toBe(0)
    expect(Reflect.ownKeys(thenable)).toEqual(before)
  })

  test("does not retry an out-of-contract PromiseLike close after provider reachability", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      let closeCalls = 0
      let thenCalls = 0
      const thenable = {
        then() {
          thenCalls += 1
        },
      }
      const close = () => {
        closeCalls += 1
        return thenable
      }
      let firstClose: Promise<void> | undefined
      let joinedClose: Promise<void> | undefined
      const use = async (session: BrokerSession) => {
        firstClose = session.closeInput()
        joinedClose = session.closeInput()
        await settle(() => firstClose!)
      }
      const wrapper = provider === "e2b"
        ? withE2bGuestBrokerSdkSession(
            {
              async run() {
                return { async sendStdin() {}, closeStdin: close }
              },
            } as unknown as E2bOfficialBrokerCommandsV1,
            use,
          )
        : withDaytonaGuestBrokerSdkSession(
            {
              async createPty() {
                return {
                  async waitForConnection() {},
                  async sendInput() {},
                  disconnect: close,
                }
              },
            } as unknown as DaytonaOfficialBrokerProcessV1,
            () => {},
            use,
          )
      const result = await settle(() => wrapper)

      expect(result.status).toBe("rejected")
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(AdapterContractError)
        expect(result.reason).toMatchObject({ code: "integrity_failed" })
      }
      expect(closeCalls).toBe(1)
      expect(joinedClose).toBe(firstClose)
      expect(thenCalls).toBe(0)
      expect(Reflect.ownKeys(thenable)).toEqual(["then"])
    }
  })

  test("seals outbound after an out-of-contract PromiseLike send", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      let sendCalls = 0
      let thenCalls = 0
      let firstSend: Settled<void> | undefined
      let secondSend: Settled<void> | undefined
      const thenable = {
        then() {
          thenCalls += 1
        },
      }
      const send = () => {
        sendCalls += 1
        return thenable
      }
      const use = async (session: BrokerSession) => {
        firstSend = await settle(() => session.sendFrame(brokerFrame()))
        secondSend = await settle(() => session.sendFrame(brokerFrame()))
      }
      const wrapper = provider === "e2b"
        ? withE2bGuestBrokerSdkSession(
            {
              async run() {
                return { sendStdin: send, async closeStdin() {} }
              },
            } as unknown as E2bOfficialBrokerCommandsV1,
            use,
          )
        : withDaytonaGuestBrokerSdkSession(
            {
              async createPty() {
                return {
                  async waitForConnection() {},
                  sendInput(input: string | Uint8Array) {
                    return typeof input === "string" ? Promise.resolve() : send()
                  },
                  async disconnect() {},
                }
              },
            } as unknown as DaytonaOfficialBrokerProcessV1,
            () => {},
            use,
          )
      await wrapper

      expect(firstSend?.status).toBe("rejected")
      if (firstSend?.status === "rejected") {
        expect(firstSend.reason).toBeInstanceOf(AdapterContractError)
        expect(firstSend.reason).toMatchObject({ code: "integrity_failed" })
      }
      expect(secondSend?.status).toBe("rejected")
      if (secondSend?.status === "rejected") {
        expect(secondSend.reason).toBeInstanceOf(Error)
        expect((secondSend.reason as Error).message).toBe("guest_broker_session_closed")
      }
      expect(sendCalls).toBe(1)
      expect(thenCalls).toBe(0)
    }
  })

  test("Daytona SDK-facing callbacks fulfill while the scope preserves handler rejection", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    let deliveryWrapper: void | Promise<void> = undefined
    let deliveryResult: Settled<void> | undefined
    const handlerFailure = new Error("frozen Daytona handler failure")
    const rawHandler = shapeProviderPromise<void>("frozen", {
      status: "rejected",
      reason: handlerFailure,
    })
    const before = promiseSurface(rawHandler)
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

    const wrapper = withDaytonaGuestBrokerSdkSession(
      process,
      () => rawHandler,
      async () => {
        deliveryWrapper = sdkOnData!(new Uint8Array([1]))
        if (deliveryWrapper !== undefined) {
          deliveryResult = await settle(() => deliveryWrapper as Promise<void>)
        }
      },
    )
    const wrapperResult = await settle(() => wrapper)

    expect(deliveryWrapper).toBeDefined()
    expect(deliveryResult).toEqual({ status: "fulfilled", value: undefined })
    expect(wrapperResult).toEqual({ status: "rejected", reason: handlerFailure })
    expect(promiseSurface(rawHandler)).toEqual(before)
    if (deliveryWrapper === undefined) throw new Error("missing Daytona delivery wrapper")
    expectNativeOwnedPromise(deliveryWrapper)
    expectNativeOwnedPromise(wrapper)
  })

  test("Daytona scope drains an accepted callback even when the SDK ignores its promise", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    let releaseDelivery!: () => void
    const rawDelivery = new Promise<void>((resolve) => {
      releaseDelivery = resolve
    })
    const before = promiseSurface(rawDelivery)
    let deliveryWrapper: void | Promise<void> = undefined
    let wrapperSettled = false
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
    const wrapper = withDaytonaGuestBrokerSdkSession(
      process,
      () => rawDelivery,
      async () => {
        deliveryWrapper = sdkOnData!(new Uint8Array([1]))
      },
    )
    void wrapper.then(
      () => {
        wrapperSettled = true
      },
      () => {
        wrapperSettled = true
      },
    )
    await Promise.resolve()
    await Promise.resolve()
    const settledBeforeRelease = wrapperSettled
    releaseDelivery()
    const result = await settle(() => wrapper)

    expect(settledBeforeRelease).toBe(false)
    expect(result).toEqual({ status: "fulfilled", value: undefined })
    expect(deliveryWrapper).toBeDefined()
    expect(promiseSurface(rawDelivery)).toEqual(before)
    if (deliveryWrapper === undefined) throw new Error("missing Daytona delivery wrapper")
    expectNativeOwnedPromise(deliveryWrapper)
    expectNativeOwnedPromise(wrapper)
  })

  test("Daytona reports handler failures in callback acceptance order", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    let rejectFirst!: (reason: unknown) => void
    const firstFailure = new Error("first accepted handler failure")
    const secondFailure = new Error("second accepted handler failure")
    const firstDelivery = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
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
    const wrapper = withDaytonaGuestBrokerSdkSession(
      process,
      (data) => data[0] === 1 ? firstDelivery : Promise.reject(secondFailure),
      async () => {
        void sdkOnData!(new Uint8Array([1]))
        void sdkOnData!(new Uint8Array([2]))
        await Promise.resolve()
        rejectFirst(firstFailure)
      },
    )

    expect(await settle(() => wrapper)).toEqual({ status: "rejected", reason: firstFailure })
  })

  test("Daytona enforces frame, in-flight count, and in-flight byte bounds before delivery", async () => {
    const maxFrameBytes = MANAGED_GUEST_BROKER_MAX_FRAME_BYTES

    {
      let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
      let deliveries = 0
      let callbackResult: Settled<void> | undefined
      const wrapper = withDaytonaGuestBrokerSdkSession(
        {
          async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
            sdkOnData = options.onData
            return {
              async waitForConnection() {},
              async sendInput() {},
              async disconnect() {},
            }
          },
        } as unknown as DaytonaOfficialBrokerProcessV1,
        () => {
          deliveries += 1
        },
        async () => {
          callbackResult = await settle(async () => {
            await sdkOnData!(new Uint8Array(maxFrameBytes + 1))
          })
        },
      )
      const result = await settle(() => wrapper)

      expect(callbackResult).toEqual({ status: "fulfilled", value: undefined })
      expect(result.status).toBe("rejected")
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "output_limit_exceeded" })
      }
      expect(deliveries).toBe(0)
    }

    {
      let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
      const releases: Array<() => void> = []
      let deliveries = 0
      const callbackResults: Settled<void>[] = []
      const wrapper = withDaytonaGuestBrokerSdkSession(
        {
          async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
            sdkOnData = options.onData
            return {
              async waitForConnection() {},
              async sendInput() {},
              async disconnect() {},
            }
          },
        } as unknown as DaytonaOfficialBrokerProcessV1,
        () => {
          deliveries += 1
          return new Promise<void>((resolve) => releases.push(resolve))
        },
        async () => {
          const callbacks = Array.from({ length: 9 }, () =>
            sdkOnData!(new Uint8Array([1])) as Promise<void>,
          )
          for (const release of releases) release()
          for (const callback of callbacks) {
            callbackResults.push(await settle(() => callback))
          }
        },
      )
      const result = await settle(() => wrapper)

      expect(deliveries).toBe(8)
      expect(callbackResults).toHaveLength(9)
      expect(callbackResults.every((entry) => entry.status === "fulfilled")).toBe(true)
      expect(result.status).toBe("rejected")
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "output_limit_exceeded" })
      }
    }

    {
      let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
      let release!: () => void
      let deliveries = 0
      const frameBytes = Math.floor(maxFrameBytes / 2) + 1
      const wrapper = withDaytonaGuestBrokerSdkSession(
        {
          async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
            sdkOnData = options.onData
            return {
              async waitForConnection() {},
              async sendInput() {},
              async disconnect() {},
            }
          },
        } as unknown as DaytonaOfficialBrokerProcessV1,
        () => {
          deliveries += 1
          return new Promise<void>((resolve) => {
            release = resolve
          })
        },
        async () => {
          const first = sdkOnData!(new Uint8Array(frameBytes)) as Promise<void>
          const second = sdkOnData!(new Uint8Array(frameBytes)) as Promise<void>
          release()
          expect(await settle(() => first)).toEqual({ status: "fulfilled", value: undefined })
          expect(await settle(() => second)).toEqual({ status: "fulfilled", value: undefined })
        },
      )
      const result = await settle(() => wrapper)

      expect(deliveries).toBe(1)
      expect(result.status).toBe("rejected")
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "output_limit_exceeded" })
      }
    }
  })

  test("Daytona releases successful delivery capacity across the session lifetime", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    let deliveries = 0
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
      async () => {
        deliveries += 1
      },
      async () => {
        for (let index = 0; index < 32; index += 1) {
          await sdkOnData!(new Uint8Array([index]))
        }
      },
    )

    expect(deliveries).toBe(32)
  })

  test("Daytona late callbacks return harmlessly before Promise or byte validation", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    let deliveries = 0
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
      () => {
        deliveries += 1
      },
      async () => {},
    )

    let lateResult: void | Promise<void> = undefined
    const attack = replacePromisePrototype("throwing_constructor")
    try {
      lateResult = sdkOnData!({} as Uint8Array)
    } finally {
      attack.restore()
    }
    if (lateResult !== undefined) await settle(() => lateResult as Promise<void>)

    expect(lateResult).toBeUndefined()
    expect(deliveries).toBe(0)
  })

  test("Daytona tracks active callback validation failures ignored by the SDK", async () => {
    for (const mode of ["promise_integrity", "byte_snapshot"] as const) {
      let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
      let deliveries = 0
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason)
      }
      const providerProcess = {
        async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
          sdkOnData = options.onData
          return {
            async waitForConnection() {},
            async sendInput() {},
            async disconnect() {},
          }
        },
      } as unknown as DaytonaOfficialBrokerProcessV1
      process.on("unhandledRejection", onUnhandled)
      try {
        const wrapper = withDaytonaGuestBrokerSdkSession(
          providerProcess,
          () => {
            deliveries += 1
          },
          async () => {
            if (mode === "promise_integrity") {
              const attack = replacePromisePrototype("throwing_constructor")
              try {
                void sdkOnData!(new Uint8Array([1]))
              } finally {
                attack.restore()
              }
            } else {
              void sdkOnData!({} as Uint8Array)
            }
          },
        )
        const result = await settle(() => wrapper)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))

        expect(result.status).toBe("rejected")
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(AdapterContractError)
          expect(result.reason).toMatchObject({ code: "integrity_failed" })
        }
        expect(deliveries).toBe(0)
        expect(unhandled).toEqual([])
      } finally {
        process.off("unhandledRejection", onUnhandled)
      }
    }
  })

  test("Promise prototype attacks fail closed before provider reachability and always restore", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      for (const mode of [
        "throwing_constructor",
        "substitute_constructor",
        "constructor_then_species",
      ] as const) {
        let providerCalls = 0
        let wrapper: Promise<void> | undefined
        const attack = replacePromisePrototype(mode)
        try {
          if (provider === "e2b") {
            const commands = {
              async run() {
                providerCalls += 1
                throw new Error("provider must remain unreachable")
              },
            } as unknown as E2bOfficialBrokerCommandsV1
            wrapper = withE2bGuestBrokerSdkSession(commands, async () => {})
          } else {
            const process = {
              async createPty() {
                providerCalls += 1
                throw new Error("provider must remain unreachable")
              },
            } as unknown as DaytonaOfficialBrokerProcessV1
            wrapper = withDaytonaGuestBrokerSdkSession(process, () => {}, async () => {})
          }
        } finally {
          attack.restore()
        }

        expect(wrapper).toBeDefined()
        const result = await settle(() => wrapper!)
        expect(result.status).toBe("rejected")
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(AdapterContractError)
          expect(result.reason).toMatchObject({ code: "integrity_failed" })
        }
        expect(providerCalls).toBe(0)
      }
    }
  })

  test("session and Daytona callback boundaries restore globals before observing fail-closed results", async () => {
    for (const provider of ["e2b", "daytona"] as const) {
      let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
      let sendCalls = 0
      let closeCalls = 0
      let onDataCalls = 0
      let explicitCloseCalls = -1
      let sendResult: Settled<void> | undefined
      let closeResult: Settled<void> | undefined
      let deliveryResult: Settled<void> | undefined
      const use = async (session: BrokerSession) => {
        let sendPromise: Promise<void> | undefined
        let closePromise: Promise<void> | undefined
        let deliveryPromise: void | Promise<void> = undefined
        const attack = replacePromisePrototype("throwing_constructor")
        try {
          if (provider === "daytona") deliveryPromise = sdkOnData!(new Uint8Array([1]))
          sendPromise = session.sendFrame(brokerFrame())
          closePromise = session.closeInput()
        } finally {
          attack.restore()
        }
        if (provider === "daytona") {
          deliveryResult = await settle(async () => {
            await deliveryPromise
          })
        }
        sendResult = await settle(() => sendPromise!)
        closeResult = await settle(() => closePromise!)
        explicitCloseCalls = closeCalls
      }
      const wrapper = provider === "e2b"
        ? withE2bGuestBrokerSdkSession(
            {
              async run() {
                return {
                  async sendStdin() {
                    sendCalls += 1
                  },
                  async closeStdin() {
                    closeCalls += 1
                  },
                }
              },
            } as unknown as E2bOfficialBrokerCommandsV1,
            use,
          )
        : withDaytonaGuestBrokerSdkSession(
            {
              async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
                sdkOnData = options.onData
                return {
                  async waitForConnection() {},
                  async sendInput(input: string | Uint8Array) {
                    if (typeof input !== "string") sendCalls += 1
                  },
                  async disconnect() {
                    closeCalls += 1
                  },
                }
              },
            } as unknown as DaytonaOfficialBrokerProcessV1,
            () => {
              onDataCalls += 1
            },
            use,
          )
      const wrapperResult = await settle(() => wrapper)

      for (const result of [sendResult, closeResult]) {
        expect(result?.status).toBe("rejected")
        if (result?.status === "rejected") {
          expect(result.reason).toBeInstanceOf(AdapterContractError)
          expect(result.reason).toMatchObject({ code: "integrity_failed" })
        }
      }
      if (provider === "daytona") {
        expect(wrapperResult.status).toBe("rejected")
        if (wrapperResult.status === "rejected") {
          expect(wrapperResult.reason).toBeInstanceOf(AdapterContractError)
          expect(wrapperResult.reason).toMatchObject({ code: "integrity_failed" })
        }
        expect(deliveryResult).toEqual({ status: "fulfilled", value: undefined })
      } else {
        expect(wrapperResult).toEqual({ status: "fulfilled", value: undefined })
      }
      expect(sendCalls).toBe(0)
      expect(explicitCloseCalls).toBe(0)
      expect(closeCalls).toBe(1)
      expect(onDataCalls).toBe(0)
    }
  })

  test("Daytona disconnects and keeps inbound closed when setup fails", async () => {
    for (const failure of ["connection", "bootstrap"] as const) {
      let disconnectCalls = 0
      let useCalls = 0
      let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
      const delivered: number[] = []
      const process = {
        async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
          sdkOnData = options.onData
          await sdkOnData(new Uint8Array([1]))
          return {
            async waitForConnection() {
              await sdkOnData!(new Uint8Array([2]))
              if (failure === "connection") throw new Error("connection setup failed")
            },
            async sendInput() {
              await sdkOnData!(new Uint8Array([3]))
              if (failure === "bootstrap") throw new Error("bootstrap setup failed")
            },
            async disconnect() {
              disconnectCalls += 1
              await sdkOnData!(new Uint8Array([4]))
            },
          }
        },
      } as unknown as DaytonaOfficialBrokerProcessV1

      await expect(
        withDaytonaGuestBrokerSdkSession(
          process,
          (data) => {
            delivered.push(data[0]!)
          },
          async () => {
            useCalls += 1
          },
        ),
      ).rejects.toThrow(failure === "connection" ? "connection setup failed" : "bootstrap setup failed")
      await sdkOnData!(new Uint8Array([5]))
      expect(useCalls).toBe(0)
      expect(disconnectCalls).toBe(1)
      expect(delivered).toEqual([])
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

  test("Daytona copies foreign-realm bytes and rejects shared or detached active input", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    const delivered: Uint8Array[] = []
    const callbackResults: Settled<void>[] = []
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

    const wrapperResult = await settle(() =>
      withDaytonaGuestBrokerSdkSession(
        process,
        (data) => {
          delivered.push(data)
        },
        async () => {
          const foreignBytes = runInNewContext("new Uint8Array([11, 12])") as Uint8Array
          await sdkOnData!(foreignBytes)
          foreignBytes[0] = 99

          const sharedBytes = new Uint8Array(new SharedArrayBuffer(1))
          const foreignSharedBytes = runInNewContext(
            "new Uint8Array(new SharedArrayBuffer(1))",
          ) as Uint8Array
          const detachedBytes = new Uint8Array([13])
          structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] })
          for (const input of [sharedBytes, foreignSharedBytes, detachedBytes]) {
            callbackResults.push(await settle(async () => {
              await sdkOnData!(input)
            }))
          }
        },
      ),
    )

    expect(wrapperResult.status).toBe("rejected")
    if (wrapperResult.status === "rejected") {
      expect(wrapperResult.reason).toBeInstanceOf(AdapterContractError)
      expect(wrapperResult.reason).toMatchObject({ code: "integrity_failed" })
    }
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toBeInstanceOf(Uint8Array)
    expect(Array.from(delivered[0]!)).toEqual([11, 12])
    expect(callbackResults).toHaveLength(3)
    expect(callbackResults.every((entry) => entry.status === "fulfilled")).toBe(true)
  })

  test("Daytona ignores invalid late callbacks without inspecting provider bytes", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    let deliveries = 0
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
      () => {
        deliveries += 1
      },
      async () => {},
    )

    const sharedBytes = new Uint8Array(new SharedArrayBuffer(1))
    const detachedBytes = new Uint8Array([1])
    structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] })
    await sdkOnData!(sharedBytes)
    await sdkOnData!(detachedBytes)
    await sdkOnData!(runInNewContext("new Uint8Array(new SharedArrayBuffer(1))") as Uint8Array)
    expect(deliveries).toBe(0)
  })

  test("Daytona opens inbound only after broker bootstrap succeeds", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    const delivered: number[] = []
    const process = {
      async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
        sdkOnData = options.onData
        await sdkOnData(new Uint8Array([1]))
        return {
          async waitForConnection() {
            await sdkOnData!(new Uint8Array([2]))
          },
          async sendInput() {
            await sdkOnData!(new Uint8Array([3]))
          },
          async disconnect() {
            await sdkOnData!(new Uint8Array([5]))
          },
        }
      },
    } as unknown as DaytonaOfficialBrokerProcessV1

    await withDaytonaGuestBrokerSdkSession(
      process,
      (data) => {
        delivered.push(data[0]!)
      },
      async () => {
        await sdkOnData!(new Uint8Array([4]))
      },
    )
    await sdkOnData!(new Uint8Array([6]))

    expect(delivered).toEqual([4])
  })

  test("Daytona explicit close seals inbound before disconnect and keeps it sealed", async () => {
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
            await sdkOnData!(new Uint8Array([8]))
          },
        }
      },
    } as unknown as DaytonaOfficialBrokerProcessV1

    let retainedSession: Parameters<Parameters<typeof withDaytonaGuestBrokerSdkSession>[2]>[0] | undefined
    await withDaytonaGuestBrokerSdkSession(
      process,
      (data) => {
        delivered.push(data[0]!)
      },
      async (session) => {
        retainedSession = session
        await sdkOnData!(new Uint8Array([7]))
        await session.closeInput()
        await sdkOnData!(new Uint8Array([9]))
        await expect(session.sendFrame(brokerFrame())).rejects.toThrow("guest_broker_session_closed")
      },
    )
    await sdkOnData!(new Uint8Array([10]))

    expect(disconnectCalls).toBe(1)
    expect(delivered).toEqual([7])
    await expect(retainedSession!.sendFrame(brokerFrame())).rejects.toThrow("guest_broker_session_closed")
  })

  test("Daytona failed explicit close coalesces, retries, and keeps inbound sealed", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    const delivered: number[] = []
    let disconnectCalls = 0
    let sendCalls = 0
    const process = {
      async createPty(options: { onData: (data: Uint8Array) => void | Promise<void> }) {
        sdkOnData = options.onData
        return {
          async waitForConnection() {},
          async sendInput() {
            sendCalls += 1
          },
          async disconnect() {
            disconnectCalls += 1
            await sdkOnData!(new Uint8Array([disconnectCalls]))
            throw new Error("persistent disconnect failure")
          },
        }
      },
    } as unknown as DaytonaOfficialBrokerProcessV1

    let retainedSession: Parameters<Parameters<typeof withDaytonaGuestBrokerSdkSession>[2]>[0] | undefined
    await expect(
      withDaytonaGuestBrokerSdkSession(
        process,
        (data) => {
          delivered.push(data[0]!)
        },
        async (session) => {
          retainedSession = session
          await sdkOnData!(new Uint8Array([7]))
          const firstClose = session.closeInput()
          const concurrentClose = session.closeInput()
          expect(concurrentClose).toBe(firstClose)
          const settled = await Promise.allSettled([firstClose, concurrentClose])
          expect(settled.map((result) => result.status)).toEqual(["rejected", "rejected"])
          expect(disconnectCalls).toBe(1)

          await sdkOnData!(new Uint8Array([8]))
          await session.sendFrame(brokerFrame())
          await expect(session.closeInput()).rejects.toThrow("persistent disconnect failure")
          await sdkOnData!(new Uint8Array([9]))
        },
      ),
    ).rejects.toThrow("persistent disconnect failure")
    await sdkOnData!(new Uint8Array([10]))

    expect(disconnectCalls).toBe(4)
    expect(sendCalls).toBe(2)
    expect(delivered).toEqual([7])
    await expect(retainedSession!.sendFrame(brokerFrame())).rejects.toThrow("guest_broker_session_closed")
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
    const callbackResults: Settled<void>[] = []
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

    const wrapperResult = await settle(() =>
      withDaytonaGuestBrokerSdkSession(process, () => {}, async () => {
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
          callbackResults.push(await settle(async () => {
            await sdkOnData!(hostile)
          }))
        }
      }),
    )

    expect(wrapperResult.status).toBe("rejected")
    if (wrapperResult.status === "rejected") {
      expect(wrapperResult.reason).toBeInstanceOf(AdapterContractError)
      expect(wrapperResult.reason).toMatchObject({ code: "integrity_failed" })
    }
    expect(callbackResults).toHaveLength(6)
    expect(callbackResults.every((entry) => entry.status === "fulfilled")).toBe(true)
  })

  test("Daytona authenticates backing buffers despite typed-array shadows", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    const delivered: number[] = []
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

    const wrapperResult = await settle(() =>
      withDaytonaGuestBrokerSdkSession(
        process,
        (data) => {
          delivered.push(data[0]!)
        },
        async () => {
          const ownShadowed = new Uint8Array(new SharedArrayBuffer(1))
          ownShadowed[0] = 7
          Object.defineProperty(ownShadowed, "buffer", { value: new ArrayBuffer(1) })

          const proxyTarget = new Uint8Array(new SharedArrayBuffer(1))
          proxyTarget[0] = 8
          const iteratorSpoof = new Proxy(proxyTarget, {
            get(target, key, receiver) {
              if (key === "buffer") return new ArrayBuffer(target.byteLength)
              if (key === "byteLength") return target.byteLength
              if (key === Symbol.iterator) return target[Symbol.iterator].bind(target)
              return Reflect.get(target, key, receiver)
            },
          })

          const callbackResults: Settled<void>[] = []
          for (const hostile of [ownShadowed, iteratorSpoof]) {
            callbackResults.push(await settle(async () => {
              await sdkOnData!(hostile)
            }))
          }
          expect(callbackResults).toHaveLength(2)
          expect(callbackResults.every((entry) => entry.status === "fulfilled")).toBe(true)
        },
      ),
    )

    expect(wrapperResult.status).toBe("rejected")
    if (wrapperResult.status === "rejected") {
      expect(wrapperResult.reason).toBeInstanceOf(AdapterContractError)
      expect(wrapperResult.reason).toMatchObject({ code: "integrity_failed" })
    }
    expect(delivered).toEqual([])
  })

  test("Daytona ignores post-import Reflect.apply replacement", async () => {
    let sdkOnData: ((data: Uint8Array) => void | Promise<void>) | undefined
    const delivered: number[] = []
    let callbackResult: Settled<void> | undefined
    let replacementApplyCalls = 0
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

    const wrapperResult = await settle(() =>
      withDaytonaGuestBrokerSdkSession(
        process,
        (data) => {
          delivered.push(data[0]!)
        },
        async () => {
          const originalApply = Reflect.apply
          const forgedBuffer = new ArrayBuffer(1)
          const replacementApply = ((_target: Function, thisArgument: unknown) => {
            replacementApplyCalls += 1
            switch (replacementApplyCalls) {
              case 1:
                return "Uint8Array"
              case 2:
                return forgedBuffer
              case 3:
                return 1
              case 4:
                return 0
              case 5:
                return 1
              case 6:
                ;(thisArgument as Uint8Array)[0] = 42
                return undefined
              default:
                throw new Error("unexpected replacement Reflect.apply call")
            }
          }) as typeof Reflect.apply

          try {
            Reflect.apply = replacementApply
            callbackResult = await settle(async () => {
              await sdkOnData!({} as Uint8Array)
            })
          } finally {
            Reflect.apply = originalApply
          }
        },
      ),
    )

    expect(wrapperResult.status).toBe("rejected")
    if (wrapperResult.status === "rejected") {
      expect(wrapperResult.reason).toBeInstanceOf(AdapterContractError)
      expect(wrapperResult.reason).toMatchObject({ code: "integrity_failed" })
    }
    expect(replacementApplyCalls).toBe(0)
    expect(callbackResult).toEqual({ status: "fulfilled", value: undefined })
    expect(delivered).toEqual([])
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
    expect(params.user).toBe("daytona")
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

  type E2bNetworkFixture = {
    allowOut: string[] | undefined
    denyOut: string[] | undefined
    rules: Record<string, Array<{ transform?: { headers?: Record<string, string> } }>> | undefined
    allowPublicTraffic: boolean | undefined
    maskRequestHost: string | undefined
  }

  function e2bNetwork(
    overrides: Partial<E2bNetworkFixture> = {},
  ): E2bNetworkFixture {
    return {
      allowOut: undefined,
      denyOut: ["0.0.0.0/0"],
      rules: undefined,
      allowPublicTraffic: false,
      maskRequestHost: undefined,
      ...overrides,
    }
  }

  type E2bListCandidateFixture = {
    sandboxId: string
    templateId: string
    metadata: Record<string, string>
    startedAt: Date
    endAt: Date
    state: "paused" | "running"
    cpuCount: number
    memoryMB: number
    envdVersion: string
    volumeMounts: Array<{ name: string; path: string }>
  }

  function e2bListCandidate(
    overrides: Partial<E2bListCandidateFixture> = {},
  ): E2bListCandidateFixture {
    return {
      sandboxId: "opaque-e2b-list-candidate",
      templateId: "template-1",
      metadata: labels(),
      startedAt: new Date("2026-07-10T09:00:00.000Z"),
      endAt: new Date("2026-07-10T11:00:00.000Z"),
      state: "paused",
      cpuCount: 2,
      memoryMB: 4096,
      envdVersion: "pinned",
      volumeMounts: [],
      ...overrides,
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
    let getInfoCalls = 0
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
      network: e2bNetwork({ allowOut: [], rules: {}, maskRequestHost: "" }),
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
            return [e2bListCandidate({
              sandboxId: info.sandboxId,
              templateId: info.templateId,
              metadata: info.metadata,
              startedAt: info.startedAt,
              endAt: info.endAt,
              state: info.state,
              cpuCount: info.cpuCount,
              memoryMB: info.memoryMB,
              envdVersion: info.envdVersion,
              volumeMounts: [...info.volumeMounts],
            }) as never]
          },
        }
      },
      async getInfo() {
        getInfoCalls += 1
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
    expect(getInfoCalls).toBe(1)
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
      user: "daytona",
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

  test("Daytona creates one exact deny-all candidate, activates it, and proves get/list absence", async () => {
    const installationId = "installation-v1"
    const providerScopeRef = "scope-v1"
    const ownershipBinding = "ownership-binding-v1"
    const install = canonicalSha256(installationId)
    const scope = canonicalSha256(providerScopeRef)
    const ownershipNonce = canonicalSha256(ownershipBinding)
    const creation = digest("dc1")
    const immutable = digest("dc2")
    const policy = digest("dc3")
    const imageDigest = digest("dc4")
    const mappingBase = {
      schema_version: "sandboxes.daytona-image-mapping/v1" as const,
      image_or_snapshot_sha256: imageDigest,
      image: "daytonaio/sandbox:0.5.0",
      mapping_version: "v1",
    }
    let alive = false
    let sandbox: Record<string, unknown>
    const lifecycle: DaytonaOfficialLifecycleSdkV1 = {
      async create(params) {
        alive = true
        sandbox = {
          id: "daytona-disposable-1",
          organizationId: "organization-1",
          labels: params.labels,
          state: "started",
          user: "daytona",
          public: params.public,
          networkBlockAll: params.networkBlockAll,
          autoDeleteInterval: params.autoDeleteInterval,
          volumes: [],
          env: params.envVars,
          createdAt: "2026-07-12T09:00:00.000Z",
          async refreshData() {},
        }
        return sandbox as never
      },
      async start(value) { (value as unknown as Record<string, unknown>).state = "started" },
      async stop(value) { (value as unknown as Record<string, unknown>).state = "stopped" },
      async delete(value) { (value as unknown as Record<string, unknown>).state = "destroyed" },
      async get() { return alive ? sandbox as never : "absent" },
      list() {
        return (async function* () { if (alive) yield sandbox as never })()
      },
    }
    const bridge = new DaytonaOfficialSdkControlBridgeV1(
      lifecycle,
      attestation(),
      install,
      scope,
      () => observedAt,
      {
        resolve(value) {
          if (value !== imageDigest) return "absent"
          return { ...mappingBase, mapping_sha256: daytonaImageMappingSha256(mappingBase) }
        },
      },
    )
    const target = {
      operation_id: "operation-1",
      operation_digest: digest("dc5"),
      operation_step_id: "create",
      resource_id: "resource-1",
      resource_lifecycle_generation: 1n,
      provider_idempotency_token_sha256: digest("dc6"),
      provider_creation_token_sha256: creation,
      immutable_fingerprint_sha256: immutable,
      authorization_consumption_receipt_sha256: digest("dc7"),
    }
    const resource = await bridge.createInert({
      target,
      spec: {
        schema_version: "sandboxes.runtime/v1",
        run_id: "run-1",
        attempt_id: "attempt-1",
        source: { repository_ref: "source", commit_sha: "commit", source_bundle_sha256: digest("dc8") },
        environment: { image_or_snapshot_sha256: imageDigest, toolchain_manifest_sha256: digest("dc9") },
        runtime_class: "strong_vm",
        architecture: "amd64",
        workspace_root: "/workspace",
        network_policy: { mode: "deny_all", policy_sha256: policy },
        resources: { cpu_millis: 1_000, memory_bytes: 1024 ** 3, disk_bytes: 10 * 1024 ** 3, pids: 64, open_files: 256, output_bytes: 1024 },
        exec_concurrency: 1,
        max_runtime_ms: 120_000,
        expires_at: "2099-01-01T00:00:00.000Z",
        data_class: "internal_non_sensitive",
        input_bundle_refs: [],
      },
      allocation_key_sha256: digest("dca"),
      ownership: { installation_id: installationId, provider_scope_ref: providerScopeRef, ownership_nonce: ownershipBinding },
      initial_network_policy: { mode: "deny_all", policy_sha256: policy },
    })
    expect(resource).toMatchObject({ state: "inert", owned: true, credential_attached: false, source_attached: false })
    expect(resource.ownership.ownership_nonce_sha256).toBe(ownershipNonce)
    const active = await bridge.activateResource(resource.opaque_resource_id, target, ownershipNonce)
    expect(active.state).toBe("active")
    await bridge.destroyResource(resource.opaque_resource_id, active.provider_resource_version, target, ownershipNonce)
    expect(await bridge.inspectResource(resource.opaque_resource_id)).toBe("absent")
    expect((await bridge.findByCreationToken(creation)).items).toHaveLength(0)
  })

  test("E2B attests and returns one immutable DTO snapshot", async () => {
    const originalLabels = labels()
    const info = {
      sandboxId: "opaque-e2b-snapshot-a",
      templateId: "template-a",
      metadata: originalLabels,
      startedAt: new Date("2026-07-10T09:00:00.000Z"),
      endAt: new Date("2026-07-10T11:00:00.000Z"),
      state: "paused" as "paused" | "running",
      cpuCount: 2,
      memoryMB: 4096,
      envdVersion: "pinned",
      allowInternetAccess: false,
      network: e2bNetwork(),
      lifecycle: { onTimeout: "pause" as "pause" | "kill", autoResume: false },
      volumeMounts: [] as Array<{ name: string; path: string }>,
    }
    let attestationInput: Parameters<ManagedResourceAttestationPortV1["attest"]>[0] | undefined
    const mutatingAttestation: ManagedResourceAttestationPortV1 = {
      async attest(input) {
        attestationInput = input
        info.sandboxId = "opaque-e2b-snapshot-b"
        info.templateId = "template-b"
        info.metadata = {
          ...labels(),
          "hasna.installation_sha256": digest("d1"),
          "hasna.provider_scope_ref_sha256": digest("d2"),
          "hasna.creation_token_sha256": digest("d3"),
          "hasna.immutable_fingerprint_sha256": digest("d4"),
        }
        info.startedAt = new Date("2026-07-10T12:00:00.000Z")
        info.state = "running"
        info.allowInternetAccess = true
        info.network = e2bNetwork({ denyOut: [], allowPublicTraffic: true })
        info.lifecycle = { onTimeout: "kill", autoResume: true }
        info.volumeMounts = [{ name: "hostile-volume", path: "/workspace" }]
        return {
          source_free: true,
          credential_free: true,
          strong_vm: true,
          architecture: "amd64",
          evidence_sha256: digest("d5"),
        }
      },
    }
    const bridge = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async getInfo() {
          return info as never
        },
      },
      mutatingAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )

    const resource = await bridge.inspectResource("opaque-e2b-snapshot-a")

    expect(attestationInput).toEqual({
      provider: "e2b",
      opaque_resource_id: "opaque-e2b-snapshot-a",
      immutable_fingerprint_sha256: immutableFingerprintSha256,
    })
    expect(resource).toMatchObject({
      opaque_resource_id: "opaque-e2b-snapshot-a",
      provider_creation_token_sha256: creationTokenSha256,
      immutable_fingerprint_sha256: immutableFingerprintSha256,
      provider_created_at: "2026-07-10T09:00:00.000Z",
      state: "inert",
      provider_runtime_state: "paused",
      auto_delete_disabled: true,
      owned: true,
      source_attached: false,
      ownership: {
        installation_id_sha256: installationSha256,
        provider_scope_ref_sha256: providerScopeRefSha256,
        ownership_nonce_sha256: originalLabels["hasna.ownership_nonce_sha256"],
      },
      network_policy: { policy_sha256: networkPolicySha256 },
    })
  })

  test("E2B rejects two-value denyOut accessors without invoking them", async () => {
    let getterCalls = 0
    let attestCalls = 0
    const denyOut: string[] = []
    Object.defineProperty(denyOut, "0", {
      enumerable: true,
      get() {
        getterCalls += 1
        return getterCalls === 1 ? "0.0.0.0/0" : "203.0.113.0/24"
      },
    })
    const bridge = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async getInfo() {
          return {
            sandboxId: "accessor-network-e2b",
            templateId: "template-a",
            metadata: labels(),
            startedAt: new Date("2026-07-10T09:00:00.000Z"),
            endAt: new Date("2026-07-10T10:00:00.000Z"),
            state: "paused",
            cpuCount: 2,
            memoryMB: 1024,
            envdVersion: "pinned",
            allowInternetAccess: false,
            network: e2bNetwork({ denyOut }),
            lifecycle: { onTimeout: "pause", autoResume: false },
            volumeMounts: [],
          } as never
        },
      },
      {
        async attest() {
          attestCalls += 1
          throw new Error("attestation must remain unreachable")
        },
      },
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )

    await expect(bridge.inspectResource("accessor-network-e2b")).rejects.toMatchObject({
      code: "integrity_failed",
    })
    expect(getterCalls).toBe(0)
    expect(attestCalls).toBe(0)
  })

  test("E2B rejects malformed nested network descriptors before attestation", async () => {
    const sparseDenyOut = ["0.0.0.0/0"]
    sparseDenyOut.length = 2
    const hiddenDenyOut = ["0.0.0.0/0"]
    Object.defineProperty(hiddenDenyOut, "0", { enumerable: false, value: "0.0.0.0/0" })
    const extraArrayKey = ["0.0.0.0/0"]
    Object.defineProperty(extraArrayKey, "extra", { enumerable: true, value: "hidden" })
    const symbolNetwork = e2bNetwork()
    Object.defineProperty(symbolNetwork, Symbol("hidden"), { enumerable: true, value: "hidden" })
    const extraNetworkKey = {
      ...e2bNetwork(),
      unexpected: "hidden",
    }
    const malformedNetworks = [
      e2bNetwork({ denyOut: sparseDenyOut }),
      e2bNetwork({ denyOut: hiddenDenyOut }),
      e2bNetwork({ denyOut: extraArrayKey }),
      symbolNetwork,
      extraNetworkKey,
    ]
    let attestCalls = 0

    for (const network of malformedNetworks) {
      const bridge = new E2bOfficialSdkControlBridgeV1(
        {
          list() {
            throw new Error("list must remain unreachable")
          },
          async getInfo() {
            return {
              sandboxId: "malformed-network-e2b",
              templateId: "template-a",
              metadata: labels(),
              startedAt: new Date("2026-07-10T09:00:00.000Z"),
              endAt: new Date("2026-07-10T10:00:00.000Z"),
              state: "paused",
              cpuCount: 2,
              memoryMB: 1024,
              envdVersion: "pinned",
              allowInternetAccess: false,
              network,
              lifecycle: { onTimeout: "pause", autoResume: false },
              volumeMounts: [],
            } as never
          },
        },
        {
          async attest() {
            attestCalls += 1
            throw new Error("attestation must remain unreachable")
          },
        },
        installationSha256,
        providerScopeRefSha256,
        () => observedAt,
      )
      await expect(bridge.inspectResource("malformed-network-e2b")).rejects.toMatchObject({
        code: "integrity_failed",
      })
    }
    expect(attestCalls).toBe(0)
  })

  test("E2B rejects permissive official network combinations before attestation", async () => {
    const unsafeNetworks: E2bNetworkFixture[] = [
      e2bNetwork({ allowOut: ["198.51.100.0/24"] }),
      e2bNetwork({
        rules: {
          "api.example.test": [{ transform: { headers: { "x-test": "unsafe" } } }],
        },
      }),
      e2bNetwork({ allowPublicTraffic: true }),
      e2bNetwork({ maskRequestHost: "masked.example.test" }),
    ]
    let attestCalls = 0

    for (const network of unsafeNetworks) {
      const bridge = new E2bOfficialSdkControlBridgeV1(
        {
          list() {
            throw new Error("list must remain unreachable")
          },
          async getInfo() {
            return {
              sandboxId: "unsafe-network-e2b",
              templateId: "template-a",
              metadata: labels(),
              startedAt: new Date("2026-07-10T09:00:00.000Z"),
              endAt: new Date("2026-07-10T10:00:00.000Z"),
              state: "paused",
              cpuCount: 2,
              memoryMB: 1024,
              envdVersion: "pinned",
              allowInternetAccess: false,
              network,
              lifecycle: { onTimeout: "pause", autoResume: false },
              volumeMounts: [],
            } as never
          },
        },
        {
          async attest() {
            attestCalls += 1
            throw new Error("attestation must remain unreachable")
          },
        },
        installationSha256,
        providerScopeRefSha256,
        () => observedAt,
      )

      await expect(bridge.inspectResource("unsafe-network-e2b")).rejects.toMatchObject({
        code: "integrity_failed",
      })
    }
    expect(attestCalls).toBe(0)
  })

  test("E2B rejects oversized and malformed provider pages before attestation", async () => {
    const info = {
      sandboxId: "page-e2b",
      templateId: "template-a",
      metadata: labels(),
      startedAt: new Date("2026-07-10T09:00:00.000Z"),
      endAt: new Date("2026-07-10T10:00:00.000Z"),
      state: "paused",
      cpuCount: 2,
      memoryMB: 1024,
      envdVersion: "pinned",
      allowInternetAccess: false,
      network: e2bNetwork(),
      lifecycle: { onTimeout: "pause", autoResume: false },
      volumeMounts: [],
    } as const
    const candidate = e2bListCandidate({
      sandboxId: info.sandboxId,
      templateId: info.templateId,
      metadata: info.metadata,
      startedAt: info.startedAt,
      endAt: info.endAt,
      state: info.state,
      cpuCount: info.cpuCount,
      memoryMB: info.memoryMB,
      envdVersion: info.envdVersion,
      volumeMounts: [],
    })
    let attestCalls = 0
    let getInfoCalls = 0
    const pageCases = [
      {
        nextToken: undefined,
        items: Array.from({ length: 101 }, () => candidate),
      },
      {
        nextToken: "x".repeat(4097),
        items: [candidate],
      },
      {
        nextToken: undefined,
        items: (() => {
          const sparse = [candidate]
          sparse.length = 2
          return sparse
        })(),
      },
    ]

    for (const pageCase of pageCases) {
      const bridge = new E2bOfficialSdkControlBridgeV1(
        {
          list() {
            return {
              hasNext: true,
              nextToken: pageCase.nextToken,
              async nextItems() {
                return pageCase.items as never
              },
            }
          },
          async getInfo() {
            getInfoCalls += 1
            return info as never
          },
        },
        {
          async attest() {
            attestCalls += 1
            return {
              source_free: true,
              credential_free: true,
              strong_vm: true,
              architecture: "amd64",
              evidence_sha256: digest("d6"),
            }
          },
        },
        installationSha256,
        providerScopeRefSha256,
        () => observedAt,
      )

      await expect(bridge.listOwnedResources()).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
    }
    expect(attestCalls).toBe(0)
    expect(getInfoCalls).toBe(0)
  })

  test("E2B rejects missing, mismatched, or duplicate hydrated list identities before attestation", async () => {
    const candidate = e2bListCandidate({ sandboxId: "hydrate-e2b" })
    const fullInfo = {
      ...candidate,
      allowInternetAccess: false,
      network: e2bNetwork(),
      lifecycle: { onTimeout: "pause" as const, autoResume: false },
    }
    const mismatches = [
      { ...fullInfo, sandboxId: "hydrate-e2b-other" },
      {
        ...fullInfo,
        metadata: {
          ...fullInfo.metadata,
          "hasna.immutable_fingerprint_sha256": digest("d8"),
        },
      },
      {
        ...fullInfo,
        metadata: {
          ...fullInfo.metadata,
          "hasna.creation_token_sha256": digest("d9"),
        },
      },
      "absent" as const,
    ]
    let attestCalls = 0
    let getInfoCalls = 0

    for (const mismatch of mismatches) {
      const bridge = new E2bOfficialSdkControlBridgeV1(
        {
          list() {
            return {
              hasNext: true,
              nextToken: undefined,
              async nextItems() {
                return [candidate as never]
              },
            }
          },
          async getInfo(opaqueResourceId) {
            getInfoCalls += 1
            expect(opaqueResourceId).toBe(candidate.sandboxId)
            return mismatch as never
          },
        },
        {
          async attest() {
            attestCalls += 1
            throw new Error("attestation must remain unreachable")
          },
        },
        installationSha256,
        providerScopeRefSha256,
        () => observedAt,
      )

      await expect(bridge.listOwnedResources()).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
    }

    const duplicateBridge = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          return {
            hasNext: true,
            nextToken: undefined,
            async nextItems() {
              return [candidate, candidate] as never
            },
          }
        },
        async getInfo() {
          getInfoCalls += 1
          return fullInfo as never
        },
      },
      {
        async attest() {
          attestCalls += 1
          throw new Error("attestation must remain unreachable")
        },
      },
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    await expect(duplicateBridge.listOwnedResources()).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })

    const secondCandidate = e2bListCandidate({ sandboxId: "hydrate-e2b-second" })
    let multiGetInfoCalls = 0
    const laterMismatchBridge = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          return {
            hasNext: true,
            nextToken: undefined,
            async nextItems() {
              return [candidate, secondCandidate] as never
            },
          }
        },
        async getInfo(opaqueResourceId) {
          multiGetInfoCalls += 1
          if (opaqueResourceId === candidate.sandboxId) return fullInfo as never
          return {
            ...fullInfo,
            sandboxId: secondCandidate.sandboxId,
            metadata: {
              ...secondCandidate.metadata,
              "hasna.creation_token_sha256": digest("da"),
            },
          } as never
        },
      },
      {
        async attest() {
          attestCalls += 1
          throw new Error("attestation must remain unreachable")
        },
      },
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    await expect(laterMismatchBridge.listOwnedResources()).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })

    expect(getInfoCalls).toBe(mismatches.length)
    expect(multiGetInfoCalls).toBe(2)
    expect(attestCalls).toBe(0)
  })

  test("Daytona rejects a 101-item inventory before refresh or attestation", async () => {
    let refreshCalls = 0
    let attestCalls = 0
    const sandbox = {
      id: "page-daytona",
      organizationId: "organization-a",
      labels: labels(),
      state: "stopped",
      user: "daytona",
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
    const bridge = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          return (async function* () {
            for (let index = 0; index < 101; index += 1) yield sandbox as never
          })()
        },
        async get() {
          throw new Error("get must remain unreachable")
        },
      },
      {
        async attest() {
          attestCalls += 1
          return {
            source_free: true,
            credential_free: true,
            strong_vm: true,
            architecture: "amd64",
            evidence_sha256: digest("d7"),
          }
        },
      },
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )

    await expect(bridge.listOwnedResources()).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(refreshCalls).toBe(0)
    expect(attestCalls).toBe(0)
  })

  test("Daytona attests and returns one immutable refreshed object snapshot", async () => {
    const originalLabels = labels()
    const sandbox = {
      id: "opaque-daytona-snapshot-a",
      organizationId: "organization-a",
      labels: originalLabels,
      state: "stopped" as string,
      user: "daytona",
      public: false,
      networkBlockAll: true,
      autoDeleteInterval: -1,
      volumes: [] as Array<{ id: string }>,
      env: {} as Record<string, string>,
      createdAt: "2026-07-10T09:00:00.000Z",
      async refreshData() {},
    }
    let attestationInput: Parameters<ManagedResourceAttestationPortV1["attest"]>[0] | undefined
    const mutatingAttestation: ManagedResourceAttestationPortV1 = {
      async attest(input) {
        attestationInput = input
        sandbox.id = "opaque-daytona-snapshot-b"
        sandbox.organizationId = "organization-b"
        sandbox.labels = {
          ...labels(),
          "hasna.installation_sha256": digest("e1"),
          "hasna.provider_scope_ref_sha256": digest("e2"),
          "hasna.creation_token_sha256": digest("e3"),
          "hasna.immutable_fingerprint_sha256": digest("e4"),
        }
        sandbox.state = "started"
        sandbox.user = "root"
        sandbox.public = true
        sandbox.networkBlockAll = false
        sandbox.autoDeleteInterval = 0
        sandbox.volumes = [{ id: "hostile-volume" }]
        sandbox.env = { HOSTILE_ENV: "present" }
        sandbox.createdAt = "2026-07-10T12:00:00.000Z"
        return {
          source_free: true,
          credential_free: true,
          strong_vm: true,
          architecture: "amd64",
          evidence_sha256: digest("e5"),
        }
      },
    }
    const bridge = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async get() {
          return sandbox as never
        },
      },
      mutatingAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )

    const resource = await bridge.inspectResource("opaque-daytona-snapshot-a")

    expect(attestationInput).toEqual({
      provider: "daytona_cloud",
      opaque_resource_id: "opaque-daytona-snapshot-a",
      immutable_fingerprint_sha256: immutableFingerprintSha256,
    })
    expect(resource).toMatchObject({
      opaque_resource_id: "opaque-daytona-snapshot-a",
      provider_creation_token_sha256: creationTokenSha256,
      immutable_fingerprint_sha256: immutableFingerprintSha256,
      provider_created_at: "2026-07-10T09:00:00.000Z",
      state: "inert",
      provider_runtime_state: "stopped",
      auto_delete_disabled: true,
      ephemeral: false,
      owned: true,
      source_attached: false,
      credential_attached: false,
      ownership: {
        installation_id_sha256: installationSha256,
        provider_scope_ref_sha256: providerScopeRefSha256,
        ownership_nonce_sha256: originalLabels["hasna.ownership_nonce_sha256"],
      },
      network_policy: { policy_sha256: networkPolicySha256 },
    })
  })

  test("inspect binds the requested opaque ID before either provider is attested", async () => {
    let attestCalls = 0
    let daytonaRefreshCalls = 0
    const rejectingAttestation: ManagedResourceAttestationPortV1 = {
      async attest() {
        attestCalls += 1
        throw new Error("attestation must remain unreachable")
      },
    }
    const e2b = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async getInfo() {
          return {
            sandboxId: "returned-e2b-id",
            templateId: "template-a",
            metadata: labels(),
            startedAt: new Date("2026-07-10T09:00:00.000Z"),
            endAt: new Date("2026-07-10T10:00:00.000Z"),
            state: "paused",
            cpuCount: 2,
            memoryMB: 1024,
            envdVersion: "pinned",
            allowInternetAccess: false,
            network: e2bNetwork(),
            lifecycle: { onTimeout: "pause", autoResume: false },
            volumeMounts: [],
          } as never
        },
      },
      rejectingAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    const daytona = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async get() {
          return {
            id: "returned-daytona-id",
            organizationId: "organization-a",
            labels: labels(),
            state: "stopped",
            user: "daytona",
            public: false,
            networkBlockAll: true,
            autoDeleteInterval: -1,
            volumes: [],
            env: {},
            createdAt: "2026-07-10T09:00:00.000Z",
            async refreshData() {
              daytonaRefreshCalls += 1
            },
          } as never
        },
      },
      rejectingAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )

    await expect(e2b.inspectResource("requested-e2b-id")).rejects.toMatchObject({
      code: "integrity_failed",
    })
    await expect(daytona.inspectResource("requested-daytona-id")).rejects.toMatchObject({
      code: "integrity_failed",
    })
    expect(daytonaRefreshCalls).toBe(0)
    expect(attestCalls).toBe(0)
  })

  test("Daytona validates the whole page and duplicate IDs before refresh or attestation", async () => {
    let refreshCalls = 0
    let attestCalls = 0
    const sandbox = (id: string, sandboxLabels: Record<string, string> = labels()) => ({
      id,
      organizationId: "organization-a",
      labels: sandboxLabels,
      state: "stopped",
      user: "daytona",
      public: false,
      networkBlockAll: true,
      autoDeleteInterval: -1,
      volumes: [],
      env: {},
      createdAt: "2026-07-10T09:00:00.000Z",
      async refreshData() {
        refreshCalls += 1
      },
    })
    const cases = [
      [sandbox("duplicate-daytona"), sandbox("duplicate-daytona")],
      [sandbox("valid-daytona"), sandbox("late-malformed-daytona", {
        ...labels(),
        "hasna.immutable_fingerprint_sha256": "not-a-digest",
      })],
    ]

    for (const providerItems of cases) {
      const bridge = new DaytonaOfficialSdkControlBridgeV1(
        {
          list() {
            return (async function* () {
              for (const providerItem of providerItems) yield providerItem as never
            })()
          },
          async get() {
            throw new Error("get must remain unreachable")
          },
        },
        {
          async attest() {
            attestCalls += 1
            throw new Error("attestation must remain unreachable")
          },
        },
        installationSha256,
        providerScopeRefSha256,
        () => observedAt,
      )

      await expect(bridge.listOwnedResources()).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
    }

    expect(refreshCalls).toBe(0)
    expect(attestCalls).toBe(0)
  })

  test("Daytona rejects late top-level accessors without invoking them", async () => {
    let getterCalls = 0
    let refreshCalls = 0
    let attestCalls = 0
    const sandbox = (id: string) => ({
      id,
      organizationId: "organization-a",
      labels: labels(),
      state: "stopped",
      user: "daytona",
      public: false,
      networkBlockAll: true,
      autoDeleteInterval: -1,
      volumes: [],
      env: {},
      createdAt: "2026-07-10T09:00:00.000Z",
      async refreshData() {
        refreshCalls += 1
      },
    })
    const accessorCases: Array<() => ReturnType<typeof sandbox>> = [
      () => {
        const value = sandbox("late-daytona-id")
        Object.defineProperty(value, "id", {
          enumerable: true,
          get() {
            getterCalls += 1
            return "duplicate-daytona-id"
          },
        })
        return value
      },
      () => {
        const value = sandbox("late-daytona-field")
        Object.defineProperty(value, "public", {
          enumerable: true,
          get() {
            getterCalls += 1
            return false
          },
        })
        return value
      },
      () => {
        const value = sandbox("late-daytona-refresh")
        Object.defineProperty(value, "refreshData", {
          enumerable: true,
          get() {
            getterCalls += 1
            return async () => {
              refreshCalls += 1
            }
          },
        })
        return value
      },
    ]

    for (const accessorCase of accessorCases) {
      const bridge = new DaytonaOfficialSdkControlBridgeV1(
        {
          list() {
            return (async function* () {
              yield sandbox("duplicate-daytona-id") as never
              yield accessorCase() as never
            })()
          },
          async get() {
            throw new Error("get must remain unreachable")
          },
        },
        {
          async attest() {
            attestCalls += 1
            throw new Error("attestation must remain unreachable")
          },
        },
        installationSha256,
        providerScopeRefSha256,
        () => observedAt,
      )

      await expect(bridge.listOwnedResources()).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
    }

    expect(getterCalls).toBe(0)
    expect(refreshCalls).toBe(0)
    expect(attestCalls).toBe(0)
  })

  test("Daytona accepts sparse pinned list candidates only after refresh hydration", async () => {
    let refreshCalls = 0
    let attestCalls = 0
    const prototype = {
      async refreshData() {
        refreshCalls += 1
        Object.assign(sparse, {
          organizationId: "organization-a",
          state: "stopped",
          user: "daytona",
          public: false,
          networkBlockAll: true,
          autoDeleteInterval: -1,
          volumes: [],
          env: {},
          createdAt: "2026-07-10T09:00:00.000Z",
        })
      },
    }
    const sparse = Object.assign(Object.create(prototype) as Record<string, unknown>, {
      id: "sparse-daytona",
      labels: labels(),
    })
    const bridge = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          return (async function* () {
            yield sparse as never
          })()
        },
        async get() {
          throw new Error("get must remain unreachable")
        },
      },
      {
        async attest() {
          attestCalls += 1
          return {
            source_free: true,
            credential_free: true,
            strong_vm: true,
            architecture: "amd64",
            evidence_sha256: digest("e6"),
          }
        },
      },
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )

    await expect(bridge.listOwnedResources()).resolves.toMatchObject({
      items: [{ opaque_resource_id: "sparse-daytona", owned: true }],
    })
    expect(refreshCalls).toBe(1)
    expect(attestCalls).toBe(1)
  })

  test("Daytona drains iterator validation before refresh and rejects changed hydration before attestation", async () => {
    let refreshCalls = 0
    let attestCalls = 0
    let getterCalls = 0
    const sandbox = (id: string, mutate: (value: Record<string, unknown>) => void = () => {}) => {
      const value: Record<string, unknown> = {
        id,
        organizationId: "organization-a",
        labels: labels(),
        state: "stopped",
        user: "daytona",
        public: false,
        networkBlockAll: true,
        autoDeleteInterval: -1,
        volumes: [],
        env: {},
        createdAt: "2026-07-10T09:00:00.000Z",
        async refreshData() {
          refreshCalls += 1
          mutate(value)
        },
      }
      return value
    }
    const rejectingAttestation: ManagedResourceAttestationPortV1 = {
      async attest() {
        attestCalls += 1
        throw new Error("attestation must remain unreachable")
      },
    }
    const partialIterator = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          return (async function* () {
            yield sandbox("partial-daytona") as never
            throw new Error("provider-secret-diagnostic")
          })()
        },
        async get() {
          throw new Error("get must remain unreachable")
        },
      },
      rejectingAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    await expect(partialIterator.listOwnedResources()).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    })
    expect(refreshCalls).toBe(0)
    expect(attestCalls).toBe(0)

    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        value.id = "changed-daytona-id"
      },
      (value) => {
        value.labels = {
          ...labels(),
          "hasna.immutable_fingerprint_sha256": digest("e7"),
        }
      },
      (value) => {
        Object.defineProperty(value, "public", {
          enumerable: true,
          get() {
            getterCalls += 1
            return false
          },
        })
      },
    ]
    for (const [index, mutation] of mutations.entries()) {
      const bridge = new DaytonaOfficialSdkControlBridgeV1(
        {
          list() {
            return (async function* () {
              yield sandbox(`hydration-daytona-${index}`, mutation) as never
            })()
          },
          async get() {
            throw new Error("get must remain unreachable")
          },
        },
        rejectingAttestation,
        installationSha256,
        providerScopeRefSha256,
        () => observedAt,
      )
      await expect(bridge.listOwnedResources()).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
    }
    expect(getterCalls).toBe(0)
    expect(attestCalls).toBe(0)
  })

  test("list and get SDK failures become safe typed adapter failures", async () => {
    const rawMessage = "provider-secret-diagnostic"
    const assertSafeFailure = async (operation: Promise<unknown>) => {
      let failure: unknown
      try {
        await operation
      } catch (cause) {
        failure = cause
      }
      expect(failure).toBeInstanceOf(AdapterContractError)
      expect(failure).toMatchObject({
        code: "provider_unavailable",
        retryable: true,
        quarantine_required: false,
      })
      expect(String(failure)).not.toContain(rawMessage)
      expect(Object.hasOwn(failure as object, "cause")).toBe(false)
    }
    let attestCalls = 0
    const unavailableAttestation: ManagedResourceAttestationPortV1 = {
      async attest() {
        attestCalls += 1
        throw new Error("attestation must remain unreachable")
      },
    }
    const e2bList = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error(rawMessage)
        },
        async getInfo() {
          throw new Error("getInfo must remain unreachable")
        },
      },
      unavailableAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    const e2bPage = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          return {
            hasNext: true,
            nextToken: undefined,
            async nextItems() {
              throw new Error(rawMessage)
            },
          }
        },
        async getInfo() {
          throw new Error("getInfo must remain unreachable")
        },
      },
      unavailableAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    const hydrateCandidate = e2bListCandidate({ sandboxId: "hydrate-sdk-failure" })
    const e2bHydrate = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          return {
            hasNext: true,
            nextToken: undefined,
            async nextItems() {
              return [hydrateCandidate as never]
            },
          }
        },
        async getInfo() {
          throw new Error(rawMessage)
        },
      },
      unavailableAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    const e2bGet = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async getInfo() {
          throw new Error(rawMessage)
        },
      },
      unavailableAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    const daytonaSyncList = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error(rawMessage)
        },
        async get() {
          throw new Error("get must remain unreachable")
        },
      },
      unavailableAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    const refreshingSandbox = (id: string, fails: boolean) => ({
      id,
      organizationId: "organization-a",
      labels: labels(),
      state: "stopped",
      user: "daytona",
      public: false,
      networkBlockAll: true,
      autoDeleteInterval: -1,
      volumes: [],
      env: {},
      createdAt: "2026-07-10T09:00:00.000Z",
      async refreshData() {
        if (fails) throw new Error(rawMessage)
      },
    })
    const daytonaPartialRefresh = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          return (async function* () {
            yield refreshingSandbox("refresh-daytona-a", false) as never
            yield refreshingSandbox("refresh-daytona-b", true) as never
          })()
        },
        async get() {
          throw new Error("get must remain unreachable")
        },
      },
      unavailableAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    const daytonaList = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          return (async function* () {
            throw new Error(rawMessage)
          })()
        },
        async get() {
          throw new Error("get must remain unreachable")
        },
      },
      unavailableAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    const daytonaGet = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async get() {
          throw new Error(rawMessage)
        },
      },
      unavailableAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )

    await assertSafeFailure(e2bList.listOwnedResources())
    await assertSafeFailure(e2bPage.listOwnedResources())
    await assertSafeFailure(e2bHydrate.listOwnedResources())
    await assertSafeFailure(e2bGet.inspectResource("opaque-e2b"))
    await assertSafeFailure(daytonaList.listOwnedResources())
    await assertSafeFailure(daytonaSyncList.listOwnedResources())
    await assertSafeFailure(daytonaPartialRefresh.listOwnedResources())
    await assertSafeFailure(daytonaGet.inspectResource("opaque-daytona"))
    expect(attestCalls).toBe(0)
  })

  test("SDK record snapshots reject accessors and symbols without observing hidden values", async () => {
    let getterCalls = 0
    let attestCalls = 0
    const e2bMetadata = labels()
    Object.defineProperty(e2bMetadata, "hostile", {
      enumerable: true,
      get() {
        getterCalls += 1
        return "hidden"
      },
    })
    const rejectingAttestation: ManagedResourceAttestationPortV1 = {
      async attest() {
        attestCalls += 1
        throw new Error("attestation must remain unreachable")
      },
    }
    const e2b = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async getInfo() {
          return {
            sandboxId: "accessor-e2b",
            templateId: "template-a",
            metadata: e2bMetadata,
            startedAt: new Date("2026-07-10T09:00:00.000Z"),
            endAt: new Date("2026-07-10T10:00:00.000Z"),
            state: "paused",
            cpuCount: 2,
            memoryMB: 1024,
            envdVersion: "pinned",
            allowInternetAccess: false,
            network: e2bNetwork(),
            lifecycle: { onTimeout: "pause", autoResume: false },
            volumeMounts: [],
          } as never
        },
      },
      rejectingAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    await expect(e2b.inspectResource("accessor-e2b")).rejects.toMatchObject({
      code: "integrity_failed",
    })

    const daytonaEnv = { SAFE: "value" }
    Object.defineProperty(daytonaEnv, Symbol("hidden"), {
      enumerable: true,
      value: "hidden",
    })
    const daytona = new DaytonaOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async get() {
          return {
            id: "symbol-daytona",
            organizationId: "organization-a",
            labels: labels(),
            state: "stopped",
            user: "daytona",
            public: false,
            networkBlockAll: true,
            autoDeleteInterval: -1,
            volumes: [],
            env: daytonaEnv,
            createdAt: "2026-07-10T09:00:00.000Z",
            async refreshData() {},
          } as never
        },
      },
      rejectingAttestation,
      installationSha256,
      providerScopeRefSha256,
      () => observedAt,
    )
    await expect(daytona.inspectResource("symbol-daytona")).rejects.toMatchObject({
      code: "integrity_failed",
    })

    expect(getterCalls).toBe(0)
    expect(attestCalls).toBe(0)
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
      network: e2bNetwork(),
      lifecycle: { onTimeout: "pause", autoResume: false },
      volumeMounts: [],
    } as const
    const sdk: E2bOfficialReadSdkV1 = {
      list() {
        return {
          hasNext: true,
          nextToken: undefined,
          async nextItems() {
            return [e2bListCandidate({
              sandboxId: info.sandboxId,
              templateId: info.templateId,
              metadata: info.metadata,
            }) as never]
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
      network: e2bNetwork(),
      lifecycle: { onTimeout: "pause", autoResume: false },
      volumeMounts: [],
    } as const
    const sdk: E2bOfficialReadSdkV1 = {
      list() {
        return {
          hasNext: true,
          nextToken: undefined,
          async nextItems() {
            return [e2bListCandidate({
              sandboxId: info.sandboxId,
              templateId: info.templateId,
              metadata: info.metadata,
            }) as never]
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
