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

  constructor(private readonly handle: Pick<CommandHandle, "sendStdin" | "closeStdin">) {}

  sendFrame(frame: GuestBrokerRequestFrameV1): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("guest_broker_session_closed"))
    return this.handle.sendStdin(serializeGuestBrokerRequestFrame(frame))
  }

  async closeInput(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.handle.closeStdin()
  }
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
  const session = new E2bGuestBrokerSdkSessionV1(handle)
  try {
    await use(session)
  } finally {
    await session.closeInput()
  }
}

export const DAYTONA_GUEST_BROKER_PTY_ID = "hasna-sandboxes-broker-v1" as const

class DaytonaGuestBrokerSdkSessionV1 implements GuestBrokerSdkSessionV1 {
  #closed = false

  constructor(private readonly handle: Pick<PtyHandle, "sendInput" | "disconnect">) {}

  sendFrame(frame: GuestBrokerRequestFrameV1): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("guest_broker_session_closed"))
    return this.handle.sendInput(serializeGuestBrokerRequestFrame(frame))
  }

  async closeInput(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.handle.disconnect()
  }
}

export async function withDaytonaGuestBrokerSdkSession(
  process: DaytonaOfficialBrokerProcessV1,
  onData: (data: Uint8Array) => void | Promise<void>,
  use: (session: GuestBrokerSdkSessionV1) => Promise<void>,
): Promise<void> {
  const handle = await process.createPty({
    id: DAYTONA_GUEST_BROKER_PTY_ID,
    cwd: "/workspace",
    envs: {},
    cols: 80,
    rows: 24,
    onData,
  })
  await handle.waitForConnection()
  await handle.sendInput(`${MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND}\n`)
  const session = new DaytonaGuestBrokerSdkSessionV1(handle)
  try {
    await use(session)
  } finally {
    await session.closeInput()
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
