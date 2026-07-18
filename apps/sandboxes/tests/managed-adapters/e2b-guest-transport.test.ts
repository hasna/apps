import { describe, expect, test } from "bun:test"
import {
  withE2bGuestBrokerDuplexSdkSession,
  type E2bGuestBrokerDuplexLimitsV1,
} from "../../src/adapters/managed/sdk-broker-bridges"
import { MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND } from "../../src/adapters/managed/broker"

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

const LIMITS: E2bGuestBrokerDuplexLimitsV1 = {
  request_timeout_ms: 1_000,
  session_timeout_ms: 5_000,
  receive_timeout_ms: 1_000,
  max_request_frame_bytes: 1_024,
  max_response_frame_bytes: 1_024,
  max_response_frames: 4,
  max_response_bytes: 4_096,
}

describe("E2B fixed guest-broker duplex host transport", () => {
  test("sends and receives bounded JSON lines, then drains before disconnect", async () => {
    const requestLine = bytes('{"request":true}\n')
    const responseLine = bytes('{"ok":true}\n')
    const state = {
      command: "",
      options: undefined as unknown,
      killed: 0,
      disconnected: 0,
      writes: 0,
    }
    let finish!: (value: { exitCode: number; stdout: string; stderr: string }) => void
    const wait = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
      finish = resolve
    })
    const commands = {
      run(command: string, options: {
        onStdout?: (data: string) => void | Promise<void>
        onStderr?: (data: string) => void | Promise<void>
      }) {
        state.command = command
        state.options = options
        return Promise.resolve({
          async sendStdin() {
            state.writes += 1
            await options.onStdout?.('{"ok":true}\n')
          },
          async closeStdin() {
            finish({ exitCode: 0, stdout: "", stderr: "" })
          },
          wait: () => wait,
          async kill() {
            state.killed += 1
            return true
          },
          async disconnect() {
            state.disconnected += 1
          },
        })
      },
    }

    await withE2bGuestBrokerDuplexSdkSession(commands as never, LIMITS, async (session) => {
      await session.sendRequestLine(requestLine)
      expect(await session.receiveResponseLine()).toEqual(responseLine)
    })

    expect(state.command).toBe(MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND)
    expect(state.options).toMatchObject({
      background: true,
      cwd: "/workspace",
      envs: {},
      stdin: true,
      requestTimeoutMs: 1_000,
      timeoutMs: 5_000,
    })
    expect(state).toMatchObject({ writes: 1, killed: 0, disconnected: 1 })
  })

  test("kills and rejects malformed or over-budget broker stdout", async () => {
    const state = { killed: 0, disconnected: 0 }
    let finish!: (value: { exitCode: number; stdout: string; stderr: string }) => void
    const wait = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
      finish = resolve
    })
    const commands = {
      run(_command: string, options: { onStdout?: (data: string) => void | Promise<void> }) {
        return Promise.resolve({
          async sendStdin() {
            await options.onStdout?.("bad\0frame\n")
          },
          async closeStdin() {
            finish({ exitCode: 0, stdout: "", stderr: "" })
          },
          wait: () => wait,
          async kill() {
            state.killed += 1
            finish({ exitCode: 137, stdout: "", stderr: "" })
            return true
          },
          async disconnect() {
            state.disconnected += 1
          },
        })
      },
    }
    const limits: E2bGuestBrokerDuplexLimitsV1 = {
      ...LIMITS,
      max_request_frame_bytes: 16,
      max_response_frame_bytes: 16,
      max_response_frames: 1,
      max_response_bytes: 16,
    }

    await expect(withE2bGuestBrokerDuplexSdkSession(commands as never, limits, async (session) => {
      await session.sendRequestLine(bytes('{"x":1}\n'))
    })).rejects.toMatchObject({ code: "integrity_failed" })
    expect(state).toEqual({ killed: 1, disconnected: 1 })
  })
})
