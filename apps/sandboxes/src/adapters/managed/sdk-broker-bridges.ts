import type { Daytona, Process as DaytonaProcess, PtyHandle, Sandbox as DaytonaSandbox } from "@daytona/sdk"
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
  constructor(private readonly handle: Pick<CommandHandle, "sendStdin" | "closeStdin">) {}

  sendFrame(frame: GuestBrokerRequestFrameV1): Promise<void> {
    return this.handle.sendStdin(serializeGuestBrokerRequestFrame(frame))
  }

  closeInput(): Promise<void> {
    return this.handle.closeStdin()
  }
}

export async function openE2bGuestBrokerSdkSession(
  commands: E2bOfficialBrokerCommandsV1,
): Promise<GuestBrokerSdkSessionV1> {
  const handle = await commands.run(MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND, {
    background: true,
    cwd: "/workspace",
    envs: {},
    stdin: true,
  })
  return new E2bGuestBrokerSdkSessionV1(handle)
}

export const DAYTONA_GUEST_BROKER_PTY_ID = "hasna-sandboxes-broker-v1" as const

class DaytonaGuestBrokerSdkSessionV1 implements GuestBrokerSdkSessionV1 {
  constructor(private readonly handle: Pick<PtyHandle, "sendInput" | "disconnect">) {}

  sendFrame(frame: GuestBrokerRequestFrameV1): Promise<void> {
    return this.handle.sendInput(serializeGuestBrokerRequestFrame(frame))
  }

  async closeInput(): Promise<void> {
    await this.handle.disconnect()
  }
}

export async function openDaytonaGuestBrokerSdkSession(
  process: DaytonaOfficialBrokerProcessV1,
  onData: (data: Uint8Array) => void | Promise<void>,
): Promise<GuestBrokerSdkSessionV1> {
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
  return new DaytonaGuestBrokerSdkSessionV1(handle)
}

/** The closure is supplied only by the trusted credential port; no ambient key is read here. */
export type E2bCredentialBoundCreateV1 = (
  options: SafeE2bCreateOptionsV1,
) => Promise<E2bSandbox>

export function createE2bSourceFreeInert(
  create: E2bCredentialBoundCreateV1,
  input: E2bCreateMappingInputV1,
): Promise<E2bSandbox> {
  return create(buildE2bCreateOptions(input))
}

export function createDaytonaSourceFreeInert(
  daytona: Pick<Daytona, "create">,
  input: DaytonaCreateMappingInputV1,
): Promise<DaytonaSandbox> {
  return daytona.create(buildDaytonaCreateParams(input))
}
