import type {
  CreateSandboxFromImageParams,
  Process as DaytonaProcess,
  PtyHandle,
  Sandbox as DaytonaSandbox,
} from "@daytona/sdk"
import type { CommandHandle, Commands as E2bCommands, Sandbox as E2bSandbox } from "e2b"
import {
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  serializeGuestBrokerRequestFrame,
} from "./broker"
import { adapterError } from "./errors"
import {
  buildDaytonaCreateParams,
  buildE2bCreateOptions,
  type DaytonaCreateMappingInputV1,
  type E2bCreateMappingInputV1,
  type SafeE2bCreateOptionsV1,
} from "./sdk-pins"
import type { GuestBrokerRequestFrameV1 } from "./types"

export interface GuestBrokerSdkSessionV1 {
  sendFrame(frame: GuestBrokerRequestFrameV1): Promise<void>
  closeInput(): Promise<void>
}

export type E2bOfficialBrokerCommandsV1 = Pick<E2bCommands, "run">
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
      return Promise.reject(new Error("guest_broker_session_closed"))
    }
    return this.#handle.sendStdin(serializeGuestBrokerRequestFrame(frame))
  }

  #closeInput(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    if (this.#closePromise !== undefined) return this.#closePromise
    const closePromise = (async () => {
      await this.#handle.closeStdin()
      this.#closed = true
    })()
    this.#closePromise = closePromise
    const clearClosePromise = () => {
      if (this.#closePromise === closePromise) this.#closePromise = undefined
    }
    void closePromise.then(clearClosePromise, clearClosePromise)
    return closePromise
  }

  async #finalizeInput(): Promise<void> {
    this.#scopeClosed = true
    try {
      await this.#closeInput()
    } catch {
      await this.#closeInput()
    }
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

export async function withE2bGuestBrokerSdkSession(
  commands: E2bOfficialBrokerCommandsV1,
  use: (session: GuestBrokerSdkSessionV1) => Promise<void>,
): Promise<void> {
  const handle = await commands.run(MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND, {
    background: true,
    cwd: "/workspace",
    envs: {},
    stdin: true,
  })
  const { session, finalize } = createE2bGuestBrokerSession(handle)
  try {
    await use(session)
  } finally {
    await finalize()
  }
}

export const DAYTONA_GUEST_BROKER_PTY_ID = "hasna-sandboxes-broker-v1" as const

class DaytonaGuestBrokerSdkSessionV1 implements GuestBrokerSdkSessionV1 {
  #closed = false
  #closePromise: Promise<void> | undefined
  #scopeClosed = false
  readonly #handle: Pick<PtyHandle, "sendInput" | "disconnect">

  constructor(
    handle: Pick<PtyHandle, "sendInput" | "disconnect">,
    registerFinalizer: (finalize: () => Promise<void>) => void,
  ) {
    this.#handle = handle
    registerFinalizer(() => this.#finalizeInput())
  }

  sendFrame(frame: GuestBrokerRequestFrameV1): Promise<void> {
    if (this.#closed || this.#scopeClosed || this.#closePromise !== undefined) {
      return Promise.reject(new Error("guest_broker_session_closed"))
    }
    return this.#handle.sendInput(serializeGuestBrokerRequestFrame(frame))
  }

  #closeInput(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    if (this.#closePromise !== undefined) return this.#closePromise
    const closePromise = (async () => {
      await this.#handle.disconnect()
      this.#closed = true
    })()
    this.#closePromise = closePromise
    const clearClosePromise = () => {
      if (this.#closePromise === closePromise) this.#closePromise = undefined
    }
    void closePromise.then(clearClosePromise, clearClosePromise)
    return closePromise
  }

  async #finalizeInput(): Promise<void> {
    this.#scopeClosed = true
    try {
      await this.#closeInput()
    } catch {
      await this.#closeInput()
    }
  }

  closeInput(): Promise<void> {
    return this.#closeInput()
  }
}

function createDaytonaGuestBrokerSession(handle: Pick<PtyHandle, "sendInput" | "disconnect">): {
  session: GuestBrokerSdkSessionV1
  finalize: () => Promise<void>
} {
  let finalize!: () => Promise<void>
  const session = new DaytonaGuestBrokerSdkSessionV1(handle, (registered) => {
    finalize = registered
  })
  return { session, finalize }
}

function snapshotDaytonaProviderBytes(data: Uint8Array): Uint8Array {
  try {
    if (!(data instanceof Uint8Array)) throw new TypeError("invalid_provider_bytes")
    const buffer = data.buffer
    if (typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer) {
      throw new TypeError("shared_provider_bytes")
    }
    const byteLength = data.byteLength
    const snapshot = new Uint8Array(data)
    if (snapshot.byteLength !== byteLength) throw new TypeError("unstable_provider_bytes")
    return snapshot
  } catch (cause) {
    throw adapterError("integrity_failed", { cause })
  }
}

export async function withDaytonaGuestBrokerSdkSession(
  process: DaytonaOfficialBrokerProcessV1,
  onData: (data: Uint8Array) => void | Promise<void>,
  use: (session: GuestBrokerSdkSessionV1) => Promise<void>,
): Promise<void> {
  let inboundOpen = true
  let handle: Awaited<ReturnType<DaytonaOfficialBrokerProcessV1["createPty"]>>
  try {
    handle = await process.createPty({
      id: DAYTONA_GUEST_BROKER_PTY_ID,
      cwd: "/workspace",
      envs: {},
      cols: 80,
      rows: 24,
      async onData(data) {
        if (!inboundOpen) return
        const snapshot = snapshotDaytonaProviderBytes(data)
        // Synchronous execution through this second check makes overlap semantics explicit:
        // an already-started delivery may finish, but no delivery starts after finalization.
        if (!inboundOpen) return
        await onData(snapshot)
      },
    })
  } catch (error) {
    inboundOpen = false
    throw error
  }
  const { session, finalize } = createDaytonaGuestBrokerSession(handle)
  try {
    await handle.waitForConnection()
    await handle.sendInput(`${MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND}\n`)
    await use(session)
  } finally {
    inboundOpen = false
    await finalize()
  }
}

/** The closure is supplied only by the trusted credential port; no ambient key is read here. */
export type E2bCredentialBoundCreateV1 = (
  options: SafeE2bCreateOptionsV1,
) => Promise<E2bSandbox>

export function createE2bDenyAllCandidate(
  create: E2bCredentialBoundCreateV1,
  input: E2bCreateMappingInputV1,
): Promise<E2bSandbox> {
  return create(buildE2bCreateOptions(input))
}

export type DaytonaCredentialBoundCreateV1 = (
  params: CreateSandboxFromImageParams,
) => Promise<DaytonaSandbox>

export function createDaytonaDenyAllCandidate(
  create: DaytonaCredentialBoundCreateV1,
  input: DaytonaCreateMappingInputV1,
): Promise<DaytonaSandbox> {
  return create(buildDaytonaCreateParams(input))
}
