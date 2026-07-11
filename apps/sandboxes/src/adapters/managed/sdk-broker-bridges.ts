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
  buildDaytonaCreateParams,
  buildE2bCreateOptions,
  type DaytonaCreateMappingInputV1,
  type E2bCreateMappingInputV1,
  type SafeE2bCreateOptionsV1,
} from "./sdk-pins"
import type { GuestBrokerRequestFrameV1 } from "./types"

const INTRINSIC_REFLECT_APPLY = Reflect.apply
const INTRINSIC_REFLECT_DELETE_PROPERTY = Reflect.deleteProperty
const INTRINSIC_OBJECT_DEFINE_PROPERTY = Object.defineProperty
const INTRINSIC_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf
const INTRINSIC_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor
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

  constructor(
    handle: Pick<CommandHandle, "sendStdin" | "closeStdin">,
    registerFinalizer: (finalize: () => Promise<void>) => void,
  ) {
    this.#handle = handle
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
        await runPromiseOperation(() => this.#handle.closeStdin())
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

function createE2bGuestBrokerSession(handle: Pick<CommandHandle, "sendStdin" | "closeStdin">): {
  session: GuestBrokerSdkSessionV1
  finalize: () => Promise<void>
} {
  let finalize!: () => Promise<void>
  const session = new E2bGuestBrokerSdkSessionV1(handle, (registered) => {
    finalize = registered
  })
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
