import type {
  CreateSandboxFromImageParams,
  Process as DaytonaProcess,
  PtyHandle,
  Sandbox as DaytonaSandbox,
} from "@daytona/sdk"
import type { CommandHandle, Commands as E2bCommands, Sandbox as E2bSandbox } from "e2b"
import { isPromise as isNativePromise } from "node:util/types"
import {
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  MANAGED_GUEST_BROKER_MAX_FRAME_BYTES,
  serializeGuestBrokerRequestFrame,
} from "./broker"
import { AdapterContractError, adapterError } from "./errors"
import {
  E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
  E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1,
  decodeE2bGuestBrokerStartupLineV1,
  decodeE2bGuestBrokerResponseLineV1,
  e2bGuestBrokerBootstrapCommandV1,
  encodeE2bGuestBrokerSessionKeyInitV1,
  type E2bGuestBrokerAuthenticatedLineExchangePortV1,
  type E2bGuestBrokerDigestV1,
  type E2bGuestBrokerExpectedResponseV1,
  type E2bGuestBrokerResponseFrameV1,
} from "./e2b-guest-broker"
import type {
  E2bGuestBrokerArtifactAttestationV1,
  E2bSandboxDestroyAndProveAbsentPortV1,
} from "./e2b-broker-artifact-control"
import {
  buildDaytonaCreateParams,
  buildE2bCreateOptions,
  type DaytonaCreateMappingInputV1,
  type E2bCreateMappingInputV1,
  type SafeE2bCreateOptionsV1,
} from "./sdk-pins"
import type { GuestBrokerRequestFrameV1 } from "./types"

const INTRINSIC_REFLECT_APPLY = Reflect.apply
const INTRINSIC_REFLECT_DELETE_PROPERTY = Reflect.deleteProperty
const INTRINSIC_REFLECT_OWN_KEYS = Reflect.ownKeys
const INTRINSIC_OBJECT_DEFINE_PROPERTY = Object.defineProperty
const INTRINSIC_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf
const INTRINSIC_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor
const INTRINSIC_OBJECT_KEYS = Object.keys
const INTRINSIC_PROMISE = Promise
const INTRINSIC_PROMISE_PROTOTYPE = INTRINSIC_PROMISE.prototype
const INTRINSIC_PROMISE_THEN = INTRINSIC_PROMISE_PROTOTYPE.then
const OWNED_PROMISE_OBSERVER_CONSTRUCTOR = {}
INTRINSIC_OBJECT_DEFINE_PROPERTY(OWNED_PROMISE_OBSERVER_CONSTRUCTOR, Symbol.species, {
  value: INTRINSIC_PROMISE,
})
const IGNORE_OWNED_PROMISE_REJECTION = () => undefined
const INTRINSIC_ERROR = Error
const INTRINSIC_TYPE_ERROR = TypeError
const INTRINSIC_UINT8_ARRAY = Uint8Array
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(INTRINSIC_UINT8_ARRAY.prototype) as object
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)!.get!
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)!.get!
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
)!.get!
const TYPED_ARRAY_NAME_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)!.get!
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!
const TYPED_ARRAY_SET = INTRINSIC_UINT8_ARRAY.prototype.set

function assertPromiseRuntimeIntegrity(): void {
  const descriptor = INTRINSIC_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    INTRINSIC_PROMISE.prototype,
    "constructor",
  )
  if (
    descriptor === undefined ||
    descriptor.value !== INTRINSIC_PROMISE ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined
  ) {
    throw adapterError("integrity_failed")
  }
}

function rejectedOwnedPromise<T>(reason: unknown): Promise<T> {
  let rejectOwnedPromise!: (reason: unknown) => void
  const promise = new INTRINSIC_PROMISE<T>((_resolve, reject) => {
    rejectOwnedPromise = reject
  })
  // Adapter-owned rejections can be returned to SDK callbacks that ignore their result. Attach a
  // reaction before rejecting; the temporary private species shim bypasses hostile global Promise
  // constructor/species lookups and is removed before the Promise crosses the adapter boundary.
  INTRINSIC_OBJECT_DEFINE_PROPERTY(promise, "constructor", {
    configurable: true,
    value: OWNED_PROMISE_OBSERVER_CONSTRUCTOR,
  })
  try {
    INTRINSIC_REFLECT_APPLY(INTRINSIC_PROMISE_THEN, promise, [
      undefined,
      IGNORE_OWNED_PROMISE_REJECTION,
    ])
  } finally {
    INTRINSIC_REFLECT_DELETE_PROPERTY(promise, "constructor")
  }
  rejectOwnedPromise(reason)
  return promise
}

async function observeIntrinsicPromiseRejection(candidate: Promise<unknown>): Promise<void> {
  try {
    await candidate
  } catch {
    // This observer owns no result; it only prevents a rejected provider Promise from escaping.
  }
}

function observeNativePromise<T>(candidate: unknown): Promise<T> {
  return (async () => {
    // Official SDK and callback ports declare native Promise, not arbitrary PromiseLike.
    // Node assimilates cross-realm promises and can observe hostile own `then` fields while
    // doing so. Accept only same-realm intrinsic promises whose own lookup fields are exact.
    const nativePromise = isNativePromise(candidate)
    const sameRealmPromise = nativePromise &&
      INTRINSIC_OBJECT_GET_PROTOTYPE_OF(candidate) === INTRINSIC_PROMISE_PROTOTYPE
    const constructorDescriptor = sameRealmPromise
      ? INTRINSIC_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(candidate, "constructor")
      : undefined
    const thenDescriptor = sameRealmPromise
      ? INTRINSIC_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(candidate, "then")
      : undefined
    const exactConstructor = constructorDescriptor === undefined ||
      (constructorDescriptor.value === INTRINSIC_PROMISE &&
        constructorDescriptor.get === undefined &&
        constructorDescriptor.set === undefined)
    const exactThen = thenDescriptor === undefined ||
      (thenDescriptor.value === INTRINSIC_PROMISE_THEN &&
        thenDescriptor.get === undefined &&
        thenDescriptor.set === undefined)
    if (sameRealmPromise && exactConstructor && !exactThen) {
      // Await takes the direct native-Promise path after the constructor check, attaching a
      // rejection reaction without consulting the rejected candidate's hostile own `then`.
      void observeIntrinsicPromiseRejection(candidate as Promise<unknown>)
    }
    if (
      !sameRealmPromise ||
      !exactConstructor ||
      !exactThen
    ) {
      throw adapterError("integrity_failed")
    }
    return await (candidate as Promise<T>)
  })()
}

function runPromiseOperation<T>(operation: () => unknown): Promise<T> {
  try {
    assertPromiseRuntimeIntegrity()
    return observeNativePromise<T>(operation())
  } catch (reason) {
    return rejectedOwnedPromise(reason)
  }
}

function resolvedVoidPromise(): Promise<void> {
  return new INTRINSIC_PROMISE<void>((resolve) => resolve())
}

function rejectedSessionClosedPromise(): Promise<void> {
  return rejectedOwnedPromise(new INTRINSIC_ERROR("guest_broker_session_closed"))
}

function observePromiseSettlement(
  promise: Promise<void>,
  observer: () => void,
): Promise<void> {
  return (async () => {
    try {
      await promise
    } catch {
      // The caller owns the close result; this observer only performs matching cleanup.
    } finally {
      observer()
    }
  })()
}

function isPromiseContractFailure(reason: unknown): boolean {
  return (
    reason instanceof AdapterContractError &&
    reason.code === "integrity_failed"
  )
}

export interface GuestBrokerSdkSessionV1 {
  sendFrame(frame: GuestBrokerRequestFrameV1): Promise<void>
  closeInput(): Promise<void>
}

export interface E2bGuestBrokerDuplexLimitsV1 {
  request_timeout_ms: number
  session_timeout_ms: number
  receive_timeout_ms: number
  max_request_frame_bytes: number
  max_response_frame_bytes: number
  max_response_frames: number
  max_response_bytes: number
}

export interface E2bGuestBrokerDuplexSdkSessionV1 {
  sendRequestLine(line: Uint8Array): Promise<void>
  receiveResponseLine(): Promise<Uint8Array>
  closeInput(): Promise<void>
}

/** Exact lifecycle cleanup TCB. Implementations destroy the sandbox and prove its absence. */
export type E2bGuestBrokerSandboxDestroyPortV1 = E2bSandboxDestroyAndProveAbsentPortV1

/**
 * Control-plane TCB port backed by the exact pinned official E2B SDK in this Node realm.
 * Every returned async value must be a same-realm intrinsic Promise with unmodified lookup fields.
 */
export type E2bOfficialBrokerCommandsV1 = Pick<E2bCommands, "run">

/**
 * Control-plane TCB port backed by the exact pinned official Daytona SDK in this Node realm.
 * Every returned async value must be a same-realm intrinsic Promise with unmodified lookup fields.
 */
export type DaytonaOfficialBrokerProcessV1 = Pick<DaytonaProcess, "createPty">

class E2bGuestBrokerSdkSessionV1 implements GuestBrokerSdkSessionV1 {
  #closed = false
  #closePromise: Promise<void> | undefined
  #scopeClosed = false
  readonly #handle: Pick<CommandHandle, "sendStdin" | "closeStdin">
  readonly #requestTimeoutMs: number | undefined

  constructor(
    handle: Pick<CommandHandle, "sendStdin" | "closeStdin">,
    registerFinalizer: (finalize: () => Promise<void>) => void,
    requestTimeoutMs?: number,
  ) {
    this.#handle = handle
    this.#requestTimeoutMs = requestTimeoutMs
    registerFinalizer(() => this.#finalizeInput())
  }

  sendFrame(frame: GuestBrokerRequestFrameV1): Promise<void> {
    if (this.#closed || this.#scopeClosed || this.#closePromise !== undefined) {
      return rejectedSessionClosedPromise()
    }
    try {
      assertPromiseRuntimeIntegrity()
    } catch (reason) {
      this.#scopeClosed = true
      return rejectedOwnedPromise(reason)
    }
    const sendPromise = runPromiseOperation<void>(() =>
      this.#handle.sendStdin(serializeGuestBrokerRequestFrame(frame)),
    )
    return (async () => {
      try {
        await sendPromise
      } catch (reason) {
        if (isPromiseContractFailure(reason)) this.#scopeClosed = true
        throw reason
      }
    })()
  }

  #closeInput(): Promise<void> {
    if (this.#closed) return resolvedVoidPromise()
    if (this.#closePromise !== undefined) return this.#closePromise
    try {
      assertPromiseRuntimeIntegrity()
    } catch (reason) {
      return rejectedOwnedPromise(reason)
    }
    let canRetry = true
    const closePromise = (async () => {
      try {
        await runPromiseOperation(() => this.#handle.closeStdin(
          this.#requestTimeoutMs === undefined
            ? undefined
            : { requestTimeoutMs: this.#requestTimeoutMs },
        ))
        this.#closed = true
      } catch (reason) {
        canRetry = !isPromiseContractFailure(reason)
        throw reason
      }
    })()
    this.#closePromise = closePromise
    const clearClosePromise = () => {
      if (canRetry && this.#closePromise === closePromise) this.#closePromise = undefined
    }
    void observePromiseSettlement(closePromise, clearClosePromise)
    return closePromise
  }

  #finalizeInput(): Promise<void> {
    return (async () => {
      this.#scopeClosed = true
      try {
        await this.#closeInput()
      } catch (reason) {
        if (isPromiseContractFailure(reason)) throw reason
        await this.#closeInput()
      }
    })()
  }

  closeInput(): Promise<void> {
    return this.#closeInput()
  }
}

function createE2bGuestBrokerSession(
  handle: Pick<CommandHandle, "sendStdin" | "closeStdin">,
  requestTimeoutMs?: number,
): {
  session: GuestBrokerSdkSessionV1
  finalize: () => Promise<void>
} {
  let finalize!: () => Promise<void>
  const session = new E2bGuestBrokerSdkSessionV1(
    handle,
    (registered) => {
      finalize = registered
    },
    requestTimeoutMs,
  )
  return { session, finalize }
}

/**
 * Runs a broker session through the trusted E2B SDK port. `use` is an in-package TCB callback and
 * must return a same-realm intrinsic Promise; broker frames and provider results remain untrusted.
 */
export function withE2bGuestBrokerSdkSession(
  commands: E2bOfficialBrokerCommandsV1,
  use: (session: GuestBrokerSdkSessionV1) => Promise<void>,
): Promise<void> {
  try {
    assertPromiseRuntimeIntegrity()
  } catch (reason) {
    return rejectedOwnedPromise(reason)
  }
  return (async () => {
    const handle = await runPromiseOperation<
      Pick<CommandHandle, "sendStdin" | "closeStdin">
    >(() =>
      commands.run(MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND, {
        background: true,
        cwd: "/workspace",
        envs: {},
        stdin: true,
      }),
    )
    const { session, finalize } = createE2bGuestBrokerSession(handle)
    try {
      await runPromiseOperation(() => use(session))
    } finally {
      await finalize()
    }
  })()
}

interface InboundWaiterV1 {
  resolve(value: Uint8Array): void
  reject(reason: unknown): void
  timeout: ReturnType<typeof setTimeout>
}

class BoundedE2bBrokerInboundV1 {
  readonly #limits: E2bGuestBrokerDuplexLimitsV1
  readonly #frames: Uint8Array[] = []
  readonly #waiters: InboundWaiterV1[] = []
  #text = ""
  #frameCount = 0
  #byteCount = 0
  #ended = false
  #failure: unknown

  constructor(limits: E2bGuestBrokerDuplexLimitsV1) {
    this.#limits = limits
  }

  push(chunk: string): void {
    if (this.#ended || this.#failure !== undefined) throw adapterError("integrity_failed")
    if (typeof chunk !== "string" || /[\0-\x09\x0b-\x1f\x7f]/u.test(chunk)) {
      return this.fail(adapterError("integrity_failed"))
    }
    this.#text += chunk
    if (
      Buffer.byteLength(this.#text, "utf8") > this.#limits.max_response_frame_bytes &&
      !this.#text.includes("\n")
    ) {
      return this.fail(adapterError("integrity_failed"))
    }
    while (true) {
      const newline = this.#text.indexOf("\n")
      if (newline < 0) break
      const encoded = this.#text.slice(0, newline)
      this.#text = this.#text.slice(newline + 1)
      if (encoded.length === 0) {
        return this.fail(adapterError("integrity_failed"))
      }
      const decoded = new TextEncoder().encode(`${encoded}\n`)
      if (
        decoded.byteLength > this.#limits.max_response_frame_bytes ||
        this.#frameCount + 1 > this.#limits.max_response_frames ||
        this.#byteCount + decoded.byteLength > this.#limits.max_response_bytes
      ) {
        return this.fail(adapterError("integrity_failed"))
      }
      this.#frameCount += 1
      this.#byteCount += decoded.byteLength
      const owned = decoded.slice()
      const waiter = this.#waiters.shift()
      if (waiter === undefined) {
        this.#frames.push(owned)
      } else {
        clearTimeout(waiter.timeout)
        waiter.resolve(owned)
      }
    }
    if (Buffer.byteLength(this.#text, "utf8") > this.#limits.max_response_frame_bytes) {
      this.fail(adapterError("integrity_failed"))
    }
  }

  fail(reason: unknown): never {
    if (this.#failure === undefined) this.#failure = reason
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timeout)
      waiter.reject(this.#failure)
    }
    throw this.#failure
  }

  end(): void {
    if (this.#ended) return
    this.#ended = true
    if (this.#text.length !== 0) {
      try {
        this.fail(adapterError("integrity_failed"))
      } catch {
        // Stored failure is observed by receiveFrame or the session finalizer.
      }
    }
    if (this.#frames.length === 0 && this.#failure === undefined) {
      for (const waiter of this.#waiters.splice(0)) {
        clearTimeout(waiter.timeout)
        waiter.reject(adapterError("provider_state_unknown", { quarantineRequired: true }))
      }
    }
  }

  receiveFrame(): Promise<Uint8Array> {
    if (this.#failure !== undefined) return rejectedOwnedPromise(this.#failure)
    const frame = this.#frames.shift()
    if (frame !== undefined) return new INTRINSIC_PROMISE((resolve) => resolve(frame))
    if (this.#ended) {
      return rejectedOwnedPromise(adapterError("provider_state_unknown", { quarantineRequired: true }))
    }
    return new INTRINSIC_PROMISE<Uint8Array>((resolve, reject) => {
      const waiter: InboundWaiterV1 = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = this.#waiters.indexOf(waiter)
          if (index >= 0) this.#waiters.splice(index, 1)
          reject(adapterError("provider_state_unknown", { quarantineRequired: true }))
        }, this.#limits.receive_timeout_ms),
      }
      this.#waiters.push(waiter)
    })
  }

  assertCleanEnd(): void {
    if (this.#failure !== undefined) throw this.#failure
    if (this.#text.length !== 0 || this.#frames.length !== 0 || this.#waiters.length !== 0) {
      throw adapterError("integrity_failed")
    }
  }
}

function snapshotDuplexLimits(value: E2bGuestBrokerDuplexLimitsV1): E2bGuestBrokerDuplexLimitsV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    Reflect.ownKeys(value).length !== 7 ||
    !["request_timeout_ms", "session_timeout_ms", "receive_timeout_ms", "max_request_frame_bytes", "max_response_frame_bytes", "max_response_frames", "max_response_bytes"]
      .every((key) => Object.hasOwn(value, key))
  ) {
    throw adapterError("validation_failed")
  }
  const snapshot = { ...value }
  for (const amount of Object.values(snapshot)) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw adapterError("validation_failed")
  }
  if (
    snapshot.request_timeout_ms > snapshot.session_timeout_ms ||
    snapshot.receive_timeout_ms > snapshot.session_timeout_ms ||
    snapshot.max_request_frame_bytes > E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1 ||
    snapshot.max_response_frame_bytes > E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1 ||
    snapshot.max_response_bytes < snapshot.max_response_frame_bytes ||
    snapshot.max_response_frames > 10_000 ||
    snapshot.max_response_bytes > E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1
  ) {
    throw adapterError("validation_failed")
  }
  return Object.freeze(snapshot)
}

function snapshotGuestBrokerRequestLine(value: Uint8Array, maximum: number): Uint8Array {
  if (!(value instanceof Uint8Array)) throw adapterError("validation_failed")
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    value.buffer instanceof SharedArrayBuffer
  ) {
    throw adapterError("validation_failed")
  }
  const owned = value.slice()
  if (
    owned.byteLength < 3 ||
    owned.byteLength > maximum ||
    owned.at(-1) !== 0x0a ||
    owned.slice(0, -1).includes(0x0a) ||
    owned.slice(0, -1).includes(0x0d) ||
    owned.slice(0, -1).includes(0)
  ) {
    throw adapterError("validation_failed")
  }
  return owned
}

/**
 * Bounded duplex E2B transport for the reviewed guest broker only. Task output
 * remains broker-framed; raw task stdout/stderr never reaches CommandHandle.
 */
function runE2bGuestBrokerDuplexSdkSession(
  commands: E2bOfficialBrokerCommandsV1,
  limitsValue: E2bGuestBrokerDuplexLimitsV1,
  use: (session: E2bGuestBrokerDuplexSdkSessionV1) => Promise<void>,
  initializationValue?: Uint8Array,
  destruction?: E2bGuestBrokerSandboxDestroyPortV1,
  bootstrapCommandValue?: string,
): Promise<void> {
  let limits: E2bGuestBrokerDuplexLimitsV1
  try {
    assertPromiseRuntimeIntegrity()
    limits = snapshotDuplexLimits(limitsValue)
  } catch (reason) {
    return rejectedOwnedPromise(reason)
  }
  return (async () => {
    const deadlineAt = Date.now() + limits.session_timeout_ms
    const boundedPromise = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
      new INTRINSIC_PROMISE<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          duplexSealed = true
          reject(adapterError("provider_state_unknown", { quarantineRequired: true }))
        }, timeoutMs)
        void promise.then(
          (value) => {
            clearTimeout(timeout)
            resolve(value)
          },
          (reason) => {
            clearTimeout(timeout)
            reject(reason)
          },
        )
      })
    const boundedProviderPromise = <T>(promise: Promise<T>): Promise<T> => boundedPromise(
      promise,
      Math.max(1, Math.min(limits.request_timeout_ms, deadlineAt - Date.now())),
    )
    const boundedCleanupPromise = <T>(promise: Promise<T>): Promise<T> => boundedPromise(
      promise,
      limits.request_timeout_ms,
    )
    const inbound = new BoundedE2bBrokerInboundV1(limits)
    const initialization = initializationValue?.slice()
    let handle: Pick<CommandHandle, "sendStdin" | "closeStdin" | "wait" | "kill" | "disconnect"> | undefined
    let mustKill = false
    let duplexSealed = false
    let boundaryFailure: unknown
    let killPromise: Promise<boolean> | undefined
    const requestKill = (): Promise<boolean> => {
      if (killPromise !== undefined) return killPromise
      if (destruction !== undefined) {
        killPromise = (async () => {
          await boundedCleanupPromise(runPromiseOperation(
            () => destruction.destroyAndProveAbsent(),
          ))
          return true
        })()
      } else if (handle === undefined) {
        killPromise = new INTRINSIC_PROMISE((resolve) => resolve(false))
      } else {
        killPromise = boundedProviderPromise(runPromiseOperation(() => handle!.kill()))
      }
      return killPromise
    }
    const failInbound = (reason: unknown): Promise<void> => {
      try {
        inbound.fail(reason)
      } catch (failure) {
        mustKill = true
        duplexSealed = true
        boundaryFailure ??= failure
        if (handle !== undefined) void requestKill()
        return rejectedOwnedPromise(failure)
      }
      return rejectedOwnedPromise(adapterError("integrity_failed"))
    }
    let connectedHandle: Pick<CommandHandle, "sendStdin" | "closeStdin" | "wait" | "kill" | "disconnect">
    try {
      connectedHandle = await boundedProviderPromise(runPromiseOperation<
        Pick<CommandHandle, "sendStdin" | "closeStdin" | "wait" | "kill" | "disconnect">
      >(() =>
        commands.run(bootstrapCommandValue ?? MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND, {
          background: true,
          cwd: "/workspace",
          envs: {},
          stdin: true,
          requestTimeoutMs: limits.request_timeout_ms,
          timeoutMs: limits.session_timeout_ms,
          onStdout(data) {
            try {
              inbound.push(data)
              return resolvedVoidPromise()
            } catch (reason) {
              return failInbound(reason)
            }
          },
          onStderr(data) {
            return data.length === 0
              ? resolvedVoidPromise()
              : failInbound(adapterError("integrity_failed"))
          },
        }),
      ))
    } catch (reason) {
      if (destruction !== undefined) {
        try {
          if (await requestKill() !== true) {
            throw adapterError("provider_state_unknown", { quarantineRequired: true })
          }
        } catch {
          throw adapterError("provider_state_unknown", { quarantineRequired: true })
        }
      }
      throw reason
    }
    handle = connectedHandle
    const { session, finalize } = createE2bGuestBrokerSession(
      connectedHandle,
      limits.request_timeout_ms,
    )
    const duplex: E2bGuestBrokerDuplexSdkSessionV1 = {
      sendRequestLine(line) {
        if (duplexSealed) return rejectedSessionClosedPromise()
        let owned: Uint8Array
        try {
          owned = snapshotGuestBrokerRequestLine(line, limits.max_request_frame_bytes)
        } catch (reason) {
          return rejectedOwnedPromise(reason)
        }
        return runPromiseOperation(() => connectedHandle.sendStdin(owned, {
          requestTimeoutMs: limits.request_timeout_ms,
        }))
      },
      closeInput: () => duplexSealed ? rejectedSessionClosedPromise() : session.closeInput(),
      receiveResponseLine: () => duplexSealed
        ? rejectedOwnedPromise(boundaryFailure ?? adapterError("provider_state_unknown", {
            quarantineRequired: true,
          }))
        : inbound.receiveFrame(),
    }
    let primaryFailed = false
    let primaryFailure: unknown
    try {
      if (initialization !== undefined) {
        try {
          await boundedProviderPromise(runPromiseOperation(
            () => connectedHandle.sendStdin(initialization, {
              requestTimeoutMs: limits.request_timeout_ms,
            }),
          ))
        } finally {
          initialization.fill(0)
        }
      }
      const usePromise = runPromiseOperation(() => use(duplex))
      await new INTRINSIC_PROMISE<void>((resolve, reject) => {
        const remaining = Math.max(1, deadlineAt - Date.now())
        const timeout = setTimeout(() => {
          duplexSealed = true
          reject(adapterError("provider_state_unknown", { quarantineRequired: true }))
        }, remaining)
        void usePromise.then(
          () => {
            clearTimeout(timeout)
            resolve()
          },
          (reason) => {
            clearTimeout(timeout)
            reject(reason)
          },
        )
      })
    } catch (reason) {
      primaryFailed = true
      primaryFailure = reason
      mustKill = true
    }
    duplexSealed = true
    let cleanupFailed = false
    let cleanupFailure: unknown
    let destructionFailure: unknown
    const recordCleanupFailure = (reason: unknown): void => {
      if (!cleanupFailed) {
        cleanupFailed = true
        cleanupFailure = reason
      }
    }
    try {
      try {
        await boundedCleanupPromise(finalize())
      } catch (reason) {
        mustKill = true
        recordCleanupFailure(reason)
      }
      if (mustKill) {
        try {
          if (await requestKill() !== true) {
            recordCleanupFailure(adapterError("provider_state_unknown", { quarantineRequired: true }))
          }
        } catch (reason) {
          destructionFailure = destruction === undefined
            ? reason
            : adapterError("provider_state_unknown", { quarantineRequired: true })
          recordCleanupFailure(destructionFailure)
        }
        inbound.end()
      } else if (!primaryFailed) {
        try {
          const result = await boundedProviderPromise(runPromiseOperation<Awaited<
            ReturnType<CommandHandle["wait"]>
          >>(() => connectedHandle.wait()))
          inbound.end()
          if (result.exitCode !== 0) throw adapterError("provider_state_unknown", { quarantineRequired: true })
          inbound.assertCleanEnd()
        } catch (reason) {
          mustKill = true
          recordCleanupFailure(reason)
          try {
            if (await requestKill() !== true) {
              recordCleanupFailure(adapterError("provider_state_unknown", { quarantineRequired: true }))
            }
          } catch (killReason) {
            destructionFailure = destruction === undefined
              ? killReason
              : adapterError("provider_state_unknown", { quarantineRequired: true })
            recordCleanupFailure(destructionFailure)
          }
        }
      }
    } finally {
      try {
        await boundedCleanupPromise(runPromiseOperation(() => connectedHandle.disconnect()))
      } catch (reason) {
        if (destruction !== undefined) {
          try {
            await requestKill()
          } catch {
            // The typed ambiguity below remains authoritative either way.
          }
          destructionFailure = adapterError("provider_state_unknown", {
            quarantineRequired: true,
          })
          recordCleanupFailure(destructionFailure)
        } else {
          recordCleanupFailure(reason)
        }
      }
    }
    if (boundaryFailure !== undefined) {
      recordCleanupFailure(boundaryFailure)
      try {
        if (await requestKill() !== true) {
          recordCleanupFailure(adapterError("provider_state_unknown", { quarantineRequired: true }))
        }
      } catch (reason) {
        destructionFailure = destruction === undefined
          ? reason
          : adapterError("provider_state_unknown", { quarantineRequired: true })
        recordCleanupFailure(destructionFailure)
      }
    }
    if (destruction !== undefined && !primaryFailed && !cleanupFailed &&
      boundaryFailure === undefined) {
      try {
        if (await requestKill() !== true) {
          destructionFailure = adapterError("provider_state_unknown", {
            quarantineRequired: true,
          })
        }
      } catch {
        destructionFailure = adapterError("provider_state_unknown", {
          quarantineRequired: true,
        })
      }
    }
    if (destructionFailure !== undefined) throw destructionFailure
    if (primaryFailed) throw primaryFailure
    if (cleanupFailed) throw cleanupFailure
  })()
}

/** Raw bounded transport primitive retained for provider-free SDK shape tests. */
export function withE2bGuestBrokerDuplexSdkSession(
  commands: E2bOfficialBrokerCommandsV1,
  limitsValue: E2bGuestBrokerDuplexLimitsV1,
  use: (session: E2bGuestBrokerDuplexSdkSessionV1) => Promise<void>,
): Promise<void> {
  return runE2bGuestBrokerDuplexSdkSession(commands, limitsValue, use)
}

/**
 * Exact live broker wire: sends the secret 72-byte session record exactly once,
 * before exposing the raw LF-delimited request/response session to the caller.
 */
export function withAuthenticatedE2bGuestBrokerDuplexSdkSession(
  commands: E2bOfficialBrokerCommandsV1,
  destruction: E2bGuestBrokerSandboxDestroyPortV1,
  artifactAttestation: E2bGuestBrokerArtifactAttestationV1,
  limitsValue: E2bGuestBrokerDuplexLimitsV1,
  sessionBindingSha256: E2bGuestBrokerDigestV1,
  macKey: Uint8Array,
  use: (
    session: E2bGuestBrokerAuthenticatedLineExchangePortV1,
    startupReceipt: E2bGuestBrokerResponseFrameV1,
  ) => Promise<void>,
): Promise<void> {
  let initialization: Uint8Array
  let ownedMacKey: Uint8Array
  let bootstrapCommand: string
  let artifactByteLength: number
  let ownedDestruction: E2bGuestBrokerSandboxDestroyPortV1
  try {
    if (destruction === null || typeof destruction !== "object" ||
      INTRINSIC_REFLECT_OWN_KEYS(destruction).length !== 1) {
      throw adapterError("validation_failed")
    }
    const destroyDescriptor = INTRINSIC_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
      destruction,
      "destroyAndProveAbsent",
    )
    if (destroyDescriptor === undefined || destroyDescriptor.get !== undefined ||
      destroyDescriptor.set !== undefined || typeof destroyDescriptor.value !== "function") {
      throw adapterError("validation_failed")
    }
    const destroyCallable = destroyDescriptor.value as () => Promise<void>
    ownedDestruction = Object.freeze({
      destroyAndProveAbsent: () => INTRINSIC_REFLECT_APPLY(
        destroyCallable,
        destruction,
        [],
      ) as Promise<void>,
    })
    if (artifactAttestation === null || typeof artifactAttestation !== "object") {
      throw adapterError("validation_failed")
    }
    const expectedAttestation = {
      artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
      byte_length: E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
      group: "root",
      mode: 0o500,
      owner: "root",
      path: E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
    } as const
    const expectedKeys = INTRINSIC_OBJECT_KEYS(expectedAttestation).sort()
    const actualKeys = INTRINSIC_REFLECT_OWN_KEYS(artifactAttestation)
    if (actualKeys.some((key) => typeof key !== "string") ||
      (actualKeys as string[]).sort().some((key, index) => key !== expectedKeys[index]) ||
      actualKeys.length !== expectedKeys.length) {
      throw adapterError("validation_failed")
    }
    for (const key of expectedKeys) {
      const descriptor = INTRINSIC_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(artifactAttestation, key)
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined ||
        descriptor.value !== expectedAttestation[key as keyof typeof expectedAttestation]) {
        throw adapterError("validation_failed")
      }
    }
    artifactByteLength = E2B_GUEST_BROKER_ARTIFACT_SIZE_V1
    bootstrapCommand = e2bGuestBrokerBootstrapCommandV1()
    let keyView: DaytonaProviderBytesViewV1
    try {
      keyView = inspectDaytonaProviderBytes(macKey)
    } catch {
      throw adapterError("validation_failed")
    }
    if (keyView.byteLength !== 32) {
      throw adapterError("validation_failed")
    }
    ownedMacKey = snapshotDaytonaProviderBytes(keyView)
    initialization = encodeE2bGuestBrokerSessionKeyInitV1(sessionBindingSha256, ownedMacKey)
  } catch (reason) {
    return rejectedOwnedPromise(reason)
  }
  let nextSequence = 0
  let exchangeInFlight = false
  let execSeen = false
  let execQuiescent = true
  let terminalFailure: unknown
  const inspectRequestBinding = (
    line: Uint8Array,
    expected: E2bGuestBrokerExpectedResponseV1,
  ): void => {
    let frame: Record<string, unknown>
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(line.subarray(0, -1))
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw adapterError("integrity_failed")
      }
      frame = parsed as Record<string, unknown>
    } catch {
      throw adapterError("integrity_failed")
    }
    if (
      frame.session_binding_sha256 !== expected.session_binding_sha256 ||
      frame.request_id !== expected.request_id ||
      frame.sequence !== expected.sequence ||
      frame.nonce_sha256 !== expected.nonce_sha256 ||
      frame.operation !== expected.operation
    ) {
      throw adapterError("integrity_failed")
    }
  }
  const abortable = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal === undefined) return promise
    if (signal.aborted) return rejectedOwnedPromise(adapterError("provider_state_unknown", {
      quarantineRequired: true,
    }))
    return new INTRINSIC_PROMISE<T>((resolve, reject) => {
      const abort = () => reject(adapterError("provider_state_unknown", { quarantineRequired: true }))
      signal.addEventListener("abort", abort, { once: true })
      void promise.then(
        (value) => {
          signal.removeEventListener("abort", abort)
          resolve(value)
        },
        (reason) => {
          signal.removeEventListener("abort", abort)
          reject(reason)
        },
      )
    })
  }
  const operation = runE2bGuestBrokerDuplexSdkSession(
    commands,
    limitsValue,
    async (session) => {
      const startupLine = await session.receiveResponseLine()
      const startupReceipt = decodeE2bGuestBrokerStartupLineV1(startupLine, {
        session_binding_sha256: sessionBindingSha256,
        artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
        path: E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
        uid: 0,
        gid: 0,
        mode: 0o500,
        size: artifactByteLength,
        verified_fd: true,
      }, ownedMacKey)
      if (startupReceipt.result?.size !== artifactByteLength ||
        startupReceipt.result.process_baseline_sha256 === undefined) {
        throw adapterError("integrity_failed")
      }
      const processBaselineSha256 = startupReceipt.result.process_baseline_sha256
      await use({
      async exchangeAuthenticatedLine(requestLine, expected, signal) {
        try {
          if (terminalFailure !== undefined || exchangeInFlight || signal?.aborted === true ||
            expected.session_binding_sha256 !== sessionBindingSha256 ||
            expected.sequence !== nextSequence) {
            throw adapterError("validation_failed")
          }
          if (expected.operation === "exec") {
            if (execSeen) throw adapterError("validation_failed")
            execSeen = true
            execQuiescent = false
          } else if (expected.operation === "checkpoint" && !execQuiescent) {
            throw adapterError("validation_failed")
          }
          inspectRequestBinding(requestLine, expected)
          exchangeInFlight = true
          await abortable(session.sendRequestLine(requestLine), signal)
          const responseLine = await abortable(session.receiveResponseLine(), signal)
          const response = decodeE2bGuestBrokerResponseLineV1(
            responseLine,
            expected,
            ownedMacKey,
          )
          if (response.ok !== true) {
            throw adapterError("provider_state_unknown", { quarantineRequired: true })
          }
          if (expected.operation === "exec") {
            if (response.result?.status !== "exited" ||
              response.result.exit_code !== 0 || response.result.output_truncated !== false ||
              response.result.checkpoint_eligible !== true ||
              response.result.destroy_required !== false ||
              response.result.unexpected_process_count !== 0 ||
              response.result.process_baseline_sha256 !== processBaselineSha256 ||
              response.result.process_quiescence_sha256 !== processBaselineSha256) {
              throw adapterError("integrity_failed")
            }
            execQuiescent = true
          }
          if (expected.operation === "checkpoint" && (
            response.result?.process_baseline_sha256 !== processBaselineSha256 ||
            response.result.process_quiescence_sha256 !== processBaselineSha256 ||
            response.result.unexpected_process_count !== 0
          )) {
            throw adapterError("integrity_failed")
          }
          nextSequence += 1
          return responseLine
        } catch (reason) {
          terminalFailure ??= reason
          throw reason
        } finally {
          exchangeInFlight = false
        }
      },
      }, startupReceipt)
      if (terminalFailure !== undefined) throw terminalFailure
    },
    initialization,
    ownedDestruction,
    bootstrapCommand,
  )
  initialization.fill(0)
  return (async () => {
    try {
      await operation
    } finally {
      ownedMacKey.fill(0)
    }
  })()
}

export const DAYTONA_GUEST_BROKER_PTY_ID = "hasna-sandboxes-broker-v1" as const
export const DAYTONA_GUEST_BROKER_MAX_IN_FLIGHT_DELIVERIES = 8
export const DAYTONA_GUEST_BROKER_MAX_IN_FLIGHT_BYTES =
  MANAGED_GUEST_BROKER_MAX_FRAME_BYTES

class DaytonaGuestBrokerSdkSessionV1 implements GuestBrokerSdkSessionV1 {
  #closed = false
  #closePromise: Promise<void> | undefined
  #scopeClosed = false
  readonly #handle: Pick<PtyHandle, "sendInput" | "disconnect">
  readonly #sealInbound: () => void

  constructor(
    handle: Pick<PtyHandle, "sendInput" | "disconnect">,
    sealInbound: () => void,
    registerFinalizer: (finalize: () => Promise<void>) => void,
  ) {
    this.#handle = handle
    this.#sealInbound = sealInbound
    registerFinalizer(() => this.#finalizeInput())
  }

  sendFrame(frame: GuestBrokerRequestFrameV1): Promise<void> {
    if (this.#closed || this.#scopeClosed || this.#closePromise !== undefined) {
      return rejectedSessionClosedPromise()
    }
    try {
      assertPromiseRuntimeIntegrity()
    } catch (reason) {
      this.#scopeClosed = true
      return rejectedOwnedPromise(reason)
    }
    const sendPromise = runPromiseOperation<void>(() =>
      this.#handle.sendInput(serializeGuestBrokerRequestFrame(frame)),
    )
    return (async () => {
      try {
        await sendPromise
      } catch (reason) {
        if (isPromiseContractFailure(reason)) this.#scopeClosed = true
        throw reason
      }
    })()
  }

  #closeInput(): Promise<void> {
    this.#sealInbound()
    if (this.#closed) return resolvedVoidPromise()
    if (this.#closePromise !== undefined) return this.#closePromise
    try {
      assertPromiseRuntimeIntegrity()
    } catch (reason) {
      return rejectedOwnedPromise(reason)
    }
    let canRetry = true
    const closePromise = (async () => {
      try {
        await runPromiseOperation(() => this.#handle.disconnect())
        this.#closed = true
      } catch (reason) {
        canRetry = !isPromiseContractFailure(reason)
        throw reason
      }
    })()
    this.#closePromise = closePromise
    const clearClosePromise = () => {
      if (canRetry && this.#closePromise === closePromise) this.#closePromise = undefined
    }
    void observePromiseSettlement(closePromise, clearClosePromise)
    return closePromise
  }

  #finalizeInput(): Promise<void> {
    return (async () => {
      this.#scopeClosed = true
      try {
        await this.#closeInput()
      } catch (reason) {
        if (isPromiseContractFailure(reason)) throw reason
        await this.#closeInput()
      }
    })()
  }

  closeInput(): Promise<void> {
    return this.#closeInput()
  }
}

function createDaytonaGuestBrokerSession(
  handle: Pick<PtyHandle, "sendInput" | "disconnect">,
  sealInbound: () => void,
): {
  session: GuestBrokerSdkSessionV1
  finalize: () => Promise<void>
} {
  let finalize!: () => Promise<void>
  const session = new DaytonaGuestBrokerSdkSessionV1(
    handle,
    sealInbound,
    (registered) => {
      finalize = registered
    },
  )
  return { session, finalize }
}

interface DaytonaProviderBytesViewV1 {
  buffer: ArrayBuffer
  byteLength: number
  byteOffset: number
}

function inspectDaytonaProviderBytes(data: Uint8Array): DaytonaProviderBytesViewV1 {
  try {
    if (INTRINSIC_REFLECT_APPLY(TYPED_ARRAY_NAME_GETTER, data, []) !== "Uint8Array") {
      throw new INTRINSIC_TYPE_ERROR("invalid_provider_bytes")
    }
    const buffer = INTRINSIC_REFLECT_APPLY(TYPED_ARRAY_BUFFER_GETTER, data, []) as ArrayBuffer
    INTRINSIC_REFLECT_APPLY(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, [])
    const byteOffset = INTRINSIC_REFLECT_APPLY(
      TYPED_ARRAY_BYTE_OFFSET_GETTER,
      data,
      [],
    ) as number
    const byteLength = INTRINSIC_REFLECT_APPLY(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      data,
      [],
    ) as number
    return { buffer, byteLength, byteOffset }
  } catch (cause) {
    throw adapterError("integrity_failed", { cause })
  }
}

function snapshotDaytonaProviderBytes(view: DaytonaProviderBytesViewV1): Uint8Array {
  try {
    const cleanView = new INTRINSIC_UINT8_ARRAY(
      view.buffer,
      view.byteOffset,
      view.byteLength,
    )
    const snapshot = new INTRINSIC_UINT8_ARRAY(view.byteLength)
    INTRINSIC_REFLECT_APPLY(TYPED_ARRAY_SET, snapshot, [cleanView])
    return snapshot
  } catch (cause) {
    throw adapterError("integrity_failed", { cause })
  }
}

/**
 * Runs a broker session through the trusted Daytona SDK port. `onData` and `use` are in-package
 * TCB callbacks and must return same-realm intrinsic Promises; inbound bytes remain hostile.
 */
export function withDaytonaGuestBrokerSdkSession(
  process: DaytonaOfficialBrokerProcessV1,
  onData: (data: Uint8Array) => void | Promise<void>,
  use: (session: GuestBrokerSdkSessionV1) => Promise<void>,
): Promise<void> {
  try {
    assertPromiseRuntimeIntegrity()
  } catch (reason) {
    return rejectedOwnedPromise(reason)
  }
  return (async () => {
    let inboundOpen = false
    const inFlightDeliveries = new Set<Promise<void>>()
    let inFlightDeliveryBytes = 0
    let inFlightDeliveryCount = 0
    let nextDeliverySequence = 0
    let firstDeliveryFailure: { reason: unknown; sequence: number } | undefined

    const recordDeliveryFailure = (sequence: number, reason: unknown): void => {
      if (
        firstDeliveryFailure === undefined ||
        sequence < firstDeliveryFailure.sequence
      ) {
        firstDeliveryFailure = { reason, sequence }
      }
    }

    const trackDelivery = (
      sequence: number,
      delivery: Promise<void>,
      byteLength: number,
    ): Promise<void> => {
      const completion = (async () => {
        try {
          await delivery
        } catch (reason) {
          recordDeliveryFailure(sequence, reason)
          inboundOpen = false
        } finally {
          inFlightDeliveryCount -= 1
          inFlightDeliveryBytes -= byteLength
        }
      })()
      inFlightDeliveries.add(completion)
      void (async () => {
        try {
          await completion
        } finally {
          inFlightDeliveries.delete(completion)
        }
      })()
      return completion
    }

    const trackDeliveryFailure = (sequence: number, reason: unknown): void => {
      recordDeliveryFailure(sequence, reason)
      inboundOpen = false
    }

    const drainDeliveries = async (): Promise<void> => {
      while (inFlightDeliveries.size > 0) {
        const current = Array.from(inFlightDeliveries)
        for (const delivery of current) {
          await delivery
          inFlightDeliveries.delete(delivery)
        }
      }
      if (firstDeliveryFailure !== undefined) throw firstDeliveryFailure.reason
    }

    let handle: Awaited<ReturnType<DaytonaOfficialBrokerProcessV1["createPty"]>>
    try {
      handle = await runPromiseOperation(() =>
        process.createPty({
          id: DAYTONA_GUEST_BROKER_PTY_ID,
          cwd: "/workspace",
          envs: {},
          cols: 80,
          rows: 24,
          onData(data) {
            if (!inboundOpen) return
            const deliverySequence = nextDeliverySequence
            nextDeliverySequence += 1
            try {
              assertPromiseRuntimeIntegrity()
            } catch (reason) {
              return trackDeliveryFailure(deliverySequence, reason)
            }
            let view: DaytonaProviderBytesViewV1
            try {
              view = inspectDaytonaProviderBytes(data)
            } catch (reason) {
              return trackDeliveryFailure(deliverySequence, reason)
            }
            if (
              view.byteLength > MANAGED_GUEST_BROKER_MAX_FRAME_BYTES ||
              inFlightDeliveryCount >= DAYTONA_GUEST_BROKER_MAX_IN_FLIGHT_DELIVERIES ||
              inFlightDeliveryBytes >
                DAYTONA_GUEST_BROKER_MAX_IN_FLIGHT_BYTES - view.byteLength
            ) {
              return trackDeliveryFailure(
                deliverySequence,
                adapterError("output_limit_exceeded"),
              )
            }
            inFlightDeliveryCount += 1
            inFlightDeliveryBytes += view.byteLength
            let snapshot: Uint8Array
            try {
              snapshot = snapshotDaytonaProviderBytes(view)
            } catch (reason) {
              inFlightDeliveryCount -= 1
              inFlightDeliveryBytes -= view.byteLength
              return trackDeliveryFailure(deliverySequence, reason)
            }
            // Synchronous execution through this second check makes overlap semantics explicit:
            // an already-started validation may finish, but no delivery starts after finalization.
            if (!inboundOpen) {
              inFlightDeliveryCount -= 1
              inFlightDeliveryBytes -= view.byteLength
              return
            }
            let result: void | Promise<void>
            try {
              result = onData(snapshot)
            } catch (reason) {
              inFlightDeliveryCount -= 1
              inFlightDeliveryBytes -= view.byteLength
              return trackDeliveryFailure(deliverySequence, reason)
            }
            if (result === undefined) {
              inFlightDeliveryCount -= 1
              inFlightDeliveryBytes -= view.byteLength
              return
            }
            return trackDelivery(
              deliverySequence,
              observeNativePromise(result),
              view.byteLength,
            )
          },
        }),
      )
    } catch (error) {
      inboundOpen = false
      throw error
    }
    const { session, finalize } = createDaytonaGuestBrokerSession(handle, () => {
      inboundOpen = false
    })
    try {
      await runPromiseOperation(() => handle.waitForConnection())
      await runPromiseOperation(() =>
        handle.sendInput(`${MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND}\n`),
      )
      inboundOpen = true
      await runPromiseOperation(() => use(session))
    } finally {
      inboundOpen = false
      try {
        await finalize()
      } finally {
        await drainDeliveries()
      }
    }
  })()
}

/** The closure is supplied only by the trusted credential port; no ambient key is read here. */
export type E2bCredentialBoundCreateV1 = (
  options: SafeE2bCreateOptionsV1,
) => Promise<E2bSandbox>

export function createE2bDenyAllCandidate(
  create: E2bCredentialBoundCreateV1,
  input: E2bCreateMappingInputV1,
): Promise<E2bSandbox> {
  return runPromiseOperation(() => create(buildE2bCreateOptions(input)))
}

export type DaytonaCredentialBoundCreateV1 = (
  params: CreateSandboxFromImageParams,
) => Promise<DaytonaSandbox>

export function createDaytonaDenyAllCandidate(
  create: DaytonaCredentialBoundCreateV1,
  input: DaytonaCreateMappingInputV1,
): Promise<DaytonaSandbox> {
  return runPromiseOperation(() => create(buildDaytonaCreateParams(input)))
}
