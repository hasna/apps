import { afterEach, describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Sandbox as OfficialE2bSandbox } from "e2b"
import {
  E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
  E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
  encodeE2bGuestBrokerRequestLineV1,
  encodeE2bGuestBrokerSessionKeyInitV1,
  e2bGuestBrokerBootstrapCommandV1,
  exchangeE2bGuestBrokerRequestV1,
  type E2bGuestBrokerExpectedResponseV1,
} from "../../src/adapters/managed/e2b-guest-broker"
import {
  installExactE2bGuestBrokerArtifactV1,
  type E2bGuestBrokerArtifactControlPortV1,
} from "../../src/adapters/managed/e2b-broker-artifact-control"
import {
  withAuthenticatedE2bGuestBrokerDuplexSdkSession,
  type E2bGuestBrokerDuplexLimitsV1,
} from "../../src/adapters/managed/sdk-broker-bridges"

const LIMITS: E2bGuestBrokerDuplexLimitsV1 = {
  request_timeout_ms: 1_000,
  session_timeout_ms: 10_000,
  receive_timeout_ms: 2_000,
  max_request_frame_bytes: 1024 * 1024,
  max_response_frame_bytes: 1024 * 1024,
  max_response_frames: 8,
  max_response_bytes: 1024 * 1024,
}

const SESSION_BINDING = `sha256:${"11".repeat(32)}` as const
const NONCE = `sha256:${"22".repeat(32)}` as const
const MAC_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const NO_DESTRUCTION = {
  async destroyAndProveAbsent(): Promise<void> {
    throw new Error("unexpected_sandbox_destruction")
  },
}
const ARTIFACT_ATTESTATION = {
  path: E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  byte_length: E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
  mode: 0o500 as const,
  owner: "root" as const,
  group: "root" as const,
}
const cleanup: string[] = []

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`
}

function authenticatedResponse(
  expected: E2bGuestBrokerExpectedResponseV1,
  options: { result?: Record<string, unknown>; error?: { code: string; message: string } },
): string {
  const basis = options.result === undefined
    ? {
        error: options.error,
        nonce_sha256: expected.nonce_sha256,
        ok: false,
        operation: expected.operation,
        protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
        request_id: expected.request_id,
        schema_version: "sandboxes.e2b-guest-broker-response/v1",
        sequence: expected.sequence,
        session_binding_sha256: expected.session_binding_sha256,
      }
    : {
        nonce_sha256: expected.nonce_sha256,
        ok: true,
        operation: expected.operation,
        protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
        request_id: expected.request_id,
        result: options.result,
        schema_version: "sandboxes.e2b-guest-broker-response/v1",
        sequence: expected.sequence,
        session_binding_sha256: expected.session_binding_sha256,
      }
  const mac = `sha256:${createHmac("sha256", MAC_KEY).update(canonicalJson(basis)).digest("hex")}`
  return `${canonicalJson({ ...basis, mac_sha256: mac })}\n`
}

function startupResponse(options: {
  size?: number
  processBaselineSha256?: string
  mode?: number
  verifiedFd?: boolean
} = {}): string {
  const nonce = `sha256:${createHash("sha256").update(`startup:${SESSION_BINDING}`).digest("hex")}`
  return authenticatedResponse({
    session_binding_sha256: SESSION_BINDING,
    request_id: "startup",
    sequence: 0,
    nonce_sha256: nonce,
    operation: "startup",
  } as never, {
    result: {
      artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
      checkpoint_eligible: false,
      device: 1,
      exec_cancel: false,
      exec_limit: 1,
      gid: 0,
      inode: 1,
      mode: options.mode ?? 0o500,
      path: E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
      process_baseline_sha256: options.processBaselineSha256 ?? NONCE,
      production_admission: false,
      resume: false,
      destroy_required: false,
      size: options.size ?? ARTIFACT_ATTESTATION.byte_length,
      uid: 0,
      unexpected_process_count: 0,
      verified_fd: options.verifiedFd ?? true,
    },
  })
}

function statRequest(sequence = 0) {
  const expected: E2bGuestBrokerExpectedResponseV1 = {
    session_binding_sha256: SESSION_BINDING,
    request_id: `stat-${sequence}`,
    sequence,
    nonce_sha256: sequence === 0 ? NONCE : `sha256:${sequence.toString(16).padStart(64, "0")}`,
    operation: "file_stat",
  }
  return {
    expected,
    line: encodeE2bGuestBrokerRequestLineV1({ ...expected, payload: { path: "result.txt" } }, MAC_KEY),
  }
}

function fakeBrokerCommands(
  onRequest: (options: {
    onStdout?: (data: string) => void | Promise<void>
    onStderr?: (data: string) => void | Promise<void>
  }) => void | Promise<void>,
  state: { writes: number; processKills: number },
  startupLine: () => string = startupResponse,
) {
  return {
    run(_command: string, options: {
      onStdout?: (data: string) => void | Promise<void>
      onStderr?: (data: string) => void | Promise<void>
    }) {
      let finish!: (value: { exitCode: number; stdout: string; stderr: string }) => void
      const wait = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
        finish = resolve
      })
      return Promise.resolve({
        async sendStdin() {
          state.writes += 1
          if (state.writes === 1) await options.onStdout?.(startupLine())
          else await onRequest(options)
        },
        async closeStdin() { finish({ exitCode: 0, stdout: "", stderr: "" }) },
        wait: () => wait,
        async kill() {
          state.processKills += 1
          return true
        },
        async disconnect() {},
      })
    },
  }
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("authenticated E2B guest-broker host wire", () => {
  test("accepts the pinned official E2B sandbox control-plane shape", () => {
    const acceptsOfficialPort = (
      sandbox: OfficialE2bSandbox,
      destruction: E2bGuestBrokerArtifactControlPortV1["destruction"],
    ): E2bGuestBrokerArtifactControlPortV1 => ({
      files: sandbox.files,
      commands: sandbox.commands,
      destruction,
    })
    expect(typeof acceptsOfficialPort).toBe("function")
  })

  test("writes the exact 72-byte secret initialization once before exposing the exchange port", async () => {
    const writes: Uint8Array[] = []
    let destroyed = 0
    let finish!: (value: { exitCode: number; stdout: string; stderr: string }) => void
    const wait = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
      finish = resolve
    })
    const commands = {
      run(command: string, options: {
        background: boolean
        cwd: string
        envs: Record<string, unknown>
        stdin: boolean
        user?: string
        requestTimeoutMs: number
        timeoutMs: number
        onStdout?: (data: string) => void | Promise<void>
      }) {
        expect(command).toBe(e2bGuestBrokerBootstrapCommandV1())
        expect({
          background: options.background,
          cwd: options.cwd,
          envs: options.envs,
          stdin: options.stdin,
          user: options.user,
          requestTimeoutMs: options.requestTimeoutMs,
          timeoutMs: options.timeoutMs,
        }).toEqual({
          background: true,
          cwd: "/workspace",
          envs: {},
          stdin: true,
          user: "root",
          requestTimeoutMs: LIMITS.request_timeout_ms,
          timeoutMs: LIMITS.session_timeout_ms,
        })
        return Promise.resolve({
          async sendStdin(data: Uint8Array) {
            writes.push(data.slice())
            await options.onStdout?.(startupResponse())
          },
          async closeStdin() {
            finish({ exitCode: 0, stdout: "", stderr: "" })
          },
          wait: () => wait,
          async kill() { return true },
          async disconnect() {},
        })
      },
    }

    await withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      { async destroyAndProveAbsent() { destroyed += 1 } },
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => {},
    )

    expect(writes).toEqual([
      encodeE2bGuestBrokerSessionKeyInitV1(SESSION_BINDING, MAC_KEY),
    ])
    expect(destroyed).toBe(1)
  })

  test("does not expose the exchange port before exact verified-fd startup attestation", async () => {
    const state = { writes: 0, processKills: 0 }
    let callbackEntered = false
    let destroyed = 0
    const commands = fakeBrokerCommands(
      async () => undefined,
      state,
      () => startupResponse({ verifiedFd: false }),
    )
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      { async destroyAndProveAbsent() { destroyed += 1 } },
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => { callbackEntered = true },
    )).rejects.toBeDefined()
    expect({ callbackEntered, processKills: state.processKills, destroyed }).toEqual({
      callbackEntered: false,
      processKills: 0,
      destroyed: 1,
    })
  })

  test("rejects a truncated key before provider contact and destroys on a replay attempt after startup", async () => {
    let runs = 0
    let preflightDestroy = 0
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      { run() { runs += 1; throw new Error("provider_contacted") } } as never,
      { async destroyAndProveAbsent() { preflightDestroy += 1 } },
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY.subarray(0, 31),
      async () => {},
    )).rejects.toMatchObject({ code: "validation_failed" })
    expect({ runs, preflightDestroy }).toEqual({ runs: 0, preflightDestroy: 0 })

    const state = { writes: 0, processKills: 0 }
    let destroyed = 0
    const replay = Uint8Array.from([
      ...encodeE2bGuestBrokerSessionKeyInitV1(SESSION_BINDING, MAC_KEY),
      0x0a,
    ])
    const expected = statRequest().expected
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      fakeBrokerCommands(() => undefined, state) as never,
      { async destroyAndProveAbsent() { destroyed += 1 } },
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async (session) => { await session.exchangeAuthenticatedLine(replay, expected) },
    )).rejects.toMatchObject({ code: "integrity_failed" })
    expect({ writes: state.writes, processKills: state.processKills, destroyed }).toEqual({
      writes: 1,
      processKills: 0,
      destroyed: 1,
    })
  })

  test("host path language rejects absolute, traversal, .git and non-file root paths", () => {
    const base = {
      session_binding_sha256: SESSION_BINDING,
      request_id: "path-test",
      sequence: 0,
      nonce_sha256: NONCE,
    }
    for (const path of ["/etc/passwd", "../escape", "a/../escape", ".git/config", "a//b"]) {
      expect(() => encodeE2bGuestBrokerRequestLineV1({
        ...base,
        operation: "file_stat",
        payload: { path },
      }, MAC_KEY)).toThrow("invalid_payload")
    }
    expect(() => encodeE2bGuestBrokerRequestLineV1({
      ...base,
      operation: "file_read",
      payload: { length: 0, max_bytes: 0, offset: 0, path: "." },
    }, MAC_KEY)).toThrow("invalid_payload")
    expect(() => encodeE2bGuestBrokerRequestLineV1({
      ...base,
      operation: "exec",
      payload: {
        argv: ["/bin/true"], cwd: ".", exec_id: "path-exec", idle_timeout_ms: 100,
        output_limit_bytes: 64, pids_limit: 2, wall_timeout_ms: 100,
      },
    }, MAC_KEY)).not.toThrow()
  })

  test("kills and disconnects even when input finalization fails", async () => {
    const state = { close: 0, processKill: 0, sandboxDestroy: 0, disconnect: 0 }
    const commands = {
      run(_command: string, options: { onStdout?: (data: string) => void | Promise<void> }) {
        let writes = 0
        return Promise.resolve({
          async sendStdin() {
            writes += 1
            if (writes === 1) await options.onStdout?.(startupResponse())
          },
          async closeStdin() {
            state.close += 1
            throw new Error("close failed")
          },
          wait: () => new Promise<never>(() => undefined),
          async kill() {
            state.processKill += 1
            return true
          },
          async disconnect() {
            state.disconnect += 1
          },
        })
      },
    }

    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      {
        async destroyAndProveAbsent() { state.sandboxDestroy += 1 },
      },
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => {
        throw new Error("use failed")
      },
    )).rejects.toThrow("use failed")
    expect(state).toEqual({ close: 2, processKill: 0, sandboxDestroy: 1, disconnect: 1 })
  })

  test("rejects an aggregate response budget above the protocol ceiling before provider contact", async () => {
    let runs = 0
    const commands = {
      run() {
        runs += 1
        throw new Error("provider_contacted")
      },
    }
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      NO_DESTRUCTION,
      ARTIFACT_ATTESTATION,
      { ...LIMITS, max_response_bytes: 1024 * 1024 + 1 },
      SESSION_BINDING,
      MAC_KEY,
      async () => {},
    )).rejects.toMatchObject({ code: "validation_failed" })
    expect(runs).toBe(0)
  })

  test("rejects a missing destroy port before provider contact and snapshots a valid port", async () => {
    let runs = 0
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      { run() { runs += 1; throw new Error("provider_contacted") } } as never,
      undefined as never,
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => {},
    )).rejects.toMatchObject({ code: "validation_failed" })
    expect(runs).toBe(0)

    const state = { writes: 0, processKills: 0 }
    let originalDestroy = 0
    let mutatedDestroy = 0
    const destruction = {
      async destroyAndProveAbsent() { originalDestroy += 1 },
    }
    const operation = withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      fakeBrokerCommands(() => undefined, state) as never,
      destruction,
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => {},
    )
    destruction.destroyAndProveAbsent = async () => { mutatedDestroy += 1 }
    await operation
    expect({ originalDestroy, mutatedDestroy, processKills: state.processKills }).toEqual({
      originalDestroy: 1,
      mutatedDestroy: 0,
      processKills: 0,
    })
  })

  test("rejects forged artifact attestations and shared key storage before provider contact", async () => {
    let runs = 0
    let getterCalls = 0
    const commands = { async run() { runs += 1; throw new Error("provider_contacted") } }
    const forged = { ...ARTIFACT_ATTESTATION, byte_length: ARTIFACT_ATTESTATION.byte_length - 1 }
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      { async destroyAndProveAbsent() {} },
      forged as never,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => {},
    )).rejects.toMatchObject({ code: "validation_failed" })

    const accessor = { ...ARTIFACT_ATTESTATION } as Record<string, unknown>
    Object.defineProperty(accessor, "path", {
      enumerable: true,
      get() { getterCalls += 1; return E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1 },
    })
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      { async destroyAndProveAbsent() {} },
      accessor as never,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => {},
    )).rejects.toMatchObject({ code: "validation_failed" })

    if (typeof SharedArrayBuffer !== "undefined") {
      const sharedKey = new Uint8Array(new SharedArrayBuffer(32))
      await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
        commands as never,
        { async destroyAndProveAbsent() {} },
        ARTIFACT_ATTESTATION,
        LIMITS,
        SESSION_BINDING,
        sharedKey,
        async () => {},
      )).rejects.toMatchObject({ code: "validation_failed" })
    }
    expect({ runs, getterCalls }).toEqual({ runs: 0, getterCalls: 0 })
  })

  test("session watchdog seals late continuations and destroys exactly once", async () => {
    const state = { writes: 0, processKills: 0 }
    let destroyed = 0
    let resume!: () => void
    const deferred = new Promise<void>((resolve) => { resume = resolve })
    const operation = withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      fakeBrokerCommands(() => undefined, state) as never,
      { async destroyAndProveAbsent() { destroyed += 1 } },
      ARTIFACT_ATTESTATION,
      {
        ...LIMITS,
        request_timeout_ms: 10,
        receive_timeout_ms: 10,
        session_timeout_ms: 20,
      },
      SESSION_BINDING,
      MAC_KEY,
      async (session) => {
        await deferred
        const request = statRequest()
        await session.exchangeAuthenticatedLine(request.line, request.expected)
      },
    )
    await expect(operation).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect({ writes: state.writes, processKills: state.processKills, destroyed }).toEqual({
      writes: 1,
      processKills: 0,
      destroyed: 1,
    })
    resume()
    await Promise.resolve()
    await Promise.resolve()
    expect({ writes: state.writes, destroyed }).toEqual({ writes: 1, destroyed: 1 })
  })

  test("charges launch and use to one deadline but gives proven deletion a bounded cleanup window", async () => {
    const state = { writes: 0, processKills: 0 }
    const base = fakeBrokerCommands(() => undefined, state)
    let destroyed = 0
    let deletionSettled = false
    let useEntered = false
    const commands = {
      async run(command: string, options: Parameters<typeof base.run>[1]) {
        await new Promise((resolve) => setTimeout(resolve, 70))
        return base.run(command, options)
      },
    }
    const started = Date.now()
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      {
        async destroyAndProveAbsent() {
          destroyed += 1
          await new Promise((resolve) => setTimeout(resolve, 15))
          deletionSettled = true
        },
      },
      ARTIFACT_ATTESTATION,
      {
        ...LIMITS,
        request_timeout_ms: 120,
        receive_timeout_ms: 120,
        session_timeout_ms: 120,
      },
      SESSION_BINDING,
      MAC_KEY,
      async () => {
        useEntered = true
        await new Promise<never>(() => undefined)
      },
    )).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
    const elapsed = Date.now() - started
    expect({ useEntered, destroyed, deletionSettled, processKills: state.processKills }).toEqual({
      useEntered: true,
      destroyed: 1,
      deletionSettled: true,
      processKills: 0,
    })
    expect(elapsed).toBeLessThan(180)
  })

  test("successful session proves absence so a second broker cannot start in the sandbox", async () => {
    const state = { writes: 0, processKills: 0 }
    let absent = false
    let handles = 0
    let destroys = 0
    const base = fakeBrokerCommands(() => undefined, state)
    const commands = {
      run(command: string, options: Parameters<typeof base.run>[1]) {
        if (absent) return Promise.reject(new Error("sandbox_absent"))
        handles += 1
        return base.run(command, options)
      },
    }
    const destruction = {
      async destroyAndProveAbsent() {
        destroys += 1
        absent = true
      },
    }
    await withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      destruction,
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => {},
    )
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      destruction,
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => {},
    )).rejects.toThrow("sandbox_absent")
    expect({ absent, handles, destroys, processKills: state.processKills }).toEqual({
      absent: true,
      handles: 1,
      destroys: 2,
      processKills: 0,
    })
  })

  test("observes a broker boundary failure delivered while disconnect drains callbacks", async () => {
    let processKilled = 0
    let sandboxDestroyed = 0
    let finish!: (value: { exitCode: number; stdout: string; stderr: string }) => void
    const wait = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
      finish = resolve
    })
    const commands = {
      run(_command: string, options: {
        onStdout?: (data: string) => void | Promise<void>
        onStderr?: (data: string) => void | Promise<void>
      }) {
        let writes = 0
        return Promise.resolve({
          async sendStdin() {
            writes += 1
            if (writes === 1) await options.onStdout?.(startupResponse())
          },
          async closeStdin() { finish({ exitCode: 0, stdout: "", stderr: "" }) },
          wait: () => wait,
          async kill() {
            processKilled += 1
            return true
          },
          async disconnect() {
            try {
              await options.onStderr?.("late boundary output")
            } catch {
              // The provider may consume callback rejection; the adapter must retain it itself.
            }
          },
        })
      },
    }
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      {
        async destroyAndProveAbsent() { sandboxDestroyed += 1 },
      },
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => {},
    )).rejects.toMatchObject({ code: "integrity_failed" })
    expect({ processKilled, sandboxDestroyed }).toEqual({ processKilled: 0, sandboxDestroyed: 1 })
  })

  test("destroys on an authenticated response with a forged MAC", async () => {
    const request = statRequest()
    const state = { writes: 0, processKills: 0 }
    let destroyed = 0
    const commands = fakeBrokerCommands(async (options) => {
      const valid = authenticatedResponse(request.expected, {
        result: { mode: 0o600, path: "result.txt", sha256: NONCE, size: 0, type: "file" },
      })
      const forged = valid.replace(
        /"mac_sha256":"sha256:([0-9a-f])/u,
        (_, digit: string) => `"mac_sha256":"sha256:${digit === "0" ? "1" : "0"}`,
      )
      await options.onStdout?.(forged)
    }, state)

    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      { async destroyAndProveAbsent() { destroyed += 1 } },
      ARTIFACT_ATTESTATION,
      { ...LIMITS, receive_timeout_ms: 100 },
      SESSION_BINDING,
      MAC_KEY,
      async (session) => { await session.exchangeAuthenticatedLine(request.line, request.expected) },
    )).rejects.toThrow("authentication_failed")
    expect({ writes: state.writes, processKills: state.processKills, destroyed }).toEqual({
      writes: 2,
      processKills: 0,
      destroyed: 1,
    })
  })

  test("destroys on response EOF/timeout", async () => {
    const request = statRequest()
    const state = { writes: 0, processKills: 0 }
    let destroyed = 0
    const commands = fakeBrokerCommands(() => undefined, state)
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      { async destroyAndProveAbsent() { destroyed += 1 } },
      ARTIFACT_ATTESTATION,
      { ...LIMITS, receive_timeout_ms: 10 },
      SESSION_BINDING,
      MAC_KEY,
      async (session) => { await session.exchangeAuthenticatedLine(request.line, request.expected) },
    )).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
    expect({ processKills: state.processKills, destroyed }).toEqual({ processKills: 0, destroyed: 1 })
  })

  test("destroys on abort while waiting for a broker response", async () => {
    const request = statRequest()
    const state = { writes: 0, processKills: 0 }
    let destroyed = 0
    const abort = new AbortController()
    const commands = fakeBrokerCommands(() => {
      setTimeout(() => abort.abort(), 0)
    }, state)
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      { async destroyAndProveAbsent() { destroyed += 1 } },
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async (session) => {
        try {
          await session.exchangeAuthenticatedLine(request.line, request.expected, abort.signal)
        } catch {
          // A caught terminal error must still poison the live session.
        }
      },
    )).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
    expect({ writes: state.writes, processKills: state.processKills, destroyed }).toEqual({
      writes: 2,
      processKills: 0,
      destroyed: 1,
    })
  })

  test("keeps deletion failure quarantined and never falls back to process kill", async () => {
    const state = { writes: 0, processKills: 0 }
    let destroyAttempts = 0
    const commands = fakeBrokerCommands(() => undefined, state)
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      {
        async destroyAndProveAbsent() {
          destroyAttempts += 1
          throw new Error("delete unavailable")
        },
      },
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async () => { throw new Error("protocol failure") },
    )).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
    expect({ processKills: state.processKills, destroyAttempts }).toEqual({
      processKills: 0,
      destroyAttempts: 1,
    })
  })

  test("destroys exactly once on launch, init, request, wait and disconnect failures", async () => {
    for (const failure of ["launch", "init", "request", "wait", "disconnect"] as const) {
      let sends = 0
      let processKills = 0
      let destroys = 0
      let finish!: (value: { exitCode: number; stdout: string; stderr: string }) => void
      const wait = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
        finish = resolve
      })
      const commands = {
        run() {
          if (failure === "launch") return Promise.reject(new Error("launch failed"))
          return Promise.resolve({
            async sendStdin() {
              sends += 1
              if ((failure === "init" && sends === 1) || (failure === "request" && sends === 2)) {
                throw new Error(`${failure} failed`)
              }
            },
            async closeStdin() {
              finish({ exitCode: failure === "wait" ? 9 : 0, stdout: "", stderr: "" })
            },
            wait: () => wait,
            async kill() {
              processKills += 1
              return true
            },
            async disconnect() {
              if (failure === "disconnect") throw new Error("disconnect failed")
            },
          })
        },
      }
      const operation = withAuthenticatedE2bGuestBrokerDuplexSdkSession(
        commands as never,
        { async destroyAndProveAbsent() { destroys += 1 } },
        ARTIFACT_ATTESTATION,
        { ...LIMITS, receive_timeout_ms: 10 },
        SESSION_BINDING,
        MAC_KEY,
        async (session) => {
          if (failure === "request") {
            const request = statRequest()
            await session.exchangeAuthenticatedLine(request.line, request.expected)
          }
        },
      )
      await expect(operation).rejects.toBeDefined()
      expect({ failure, processKills, destroys }).toEqual({ failure, processKills: 0, destroys: 1 })
    }
  })

  test("maps every authenticated broker error to one destroy and blocks checkpoint", async () => {
    const request = statRequest()
    const checkpointExpected = {
      ...request.expected,
      request_id: "checkpoint-1",
      sequence: 1,
      nonce_sha256: `sha256:${"33".repeat(32)}` as const,
      operation: "checkpoint" as const,
    }
    const checkpointLine = encodeE2bGuestBrokerRequestLineV1({
      ...checkpointExpected,
      payload: {
        max_depth: 1,
        max_duration_ms: 100,
        max_file_bytes: 64,
        max_files: 1,
        max_total_bytes: 64,
      },
    }, MAC_KEY)
    for (const code of [
      "authentication_failed",
      "internal_error",
      "unknown_code",
      "sandbox_destruction_required",
    ]) {
      const state = { writes: 0, processKills: 0 }
      let destroyed = 0
      const commands = fakeBrokerCommands(async (options) => {
        await options.onStdout?.(authenticatedResponse(request.expected, {
          error: { code, message: "guest session is tainted" },
        }))
      }, state)
      await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
        commands as never,
        { async destroyAndProveAbsent() { destroyed += 1 } },
        ARTIFACT_ATTESTATION,
        LIMITS,
        SESSION_BINDING,
        MAC_KEY,
        async (session) => {
          try {
            await session.exchangeAuthenticatedLine(request.line, request.expected)
          } catch {}
          await expect(session.exchangeAuthenticatedLine(checkpointLine, checkpointExpected)).rejects
            .toMatchObject({ code: "validation_failed" })
        },
      )).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
      expect({ code, writes: state.writes, processKills: state.processKills, destroyed }).toEqual({
        code,
        writes: 2,
        processKills: 0,
        destroyed: 1,
      })
    }
  })

  test("permits only one foreground exec and blocks later checkpoint after violation", async () => {
    const expected = {
      session_binding_sha256: SESSION_BINDING,
      request_id: "exec-0",
      sequence: 0,
      nonce_sha256: NONCE,
      operation: "exec" as const,
    }
    const payload = {
      argv: ["/bin/true"], cwd: ".", exec_id: "exec-0", idle_timeout_ms: 100,
      output_limit_bytes: 64, pids_limit: 2, wall_timeout_ms: 100,
    }
    const firstLine = encodeE2bGuestBrokerRequestLineV1({ ...expected, payload }, MAC_KEY)
    const secondExpected = {
      ...expected,
      request_id: "exec-1",
      sequence: 1,
      nonce_sha256: `sha256:${"44".repeat(32)}` as const,
    }
    const secondLine = encodeE2bGuestBrokerRequestLineV1({ ...secondExpected, payload: { ...payload, exec_id: "exec-1" } }, MAC_KEY)
    const state = { writes: 0, processKills: 0 }
    let destroyed = 0
    const commands = fakeBrokerCommands(async (options) => {
      await options.onStdout?.(authenticatedResponse(expected, {
        result: {
          checkpoint_eligible: true,
          duration_ms: 0,
          exit_code: 0,
          output_truncated: false,
          process_baseline_sha256: NONCE,
          process_quiescence_sha256: NONCE,
          destroy_required: false,
          status: "exited",
          stderr_base64: "",
          stdout_base64: "",
          unexpected_process_count: 0,
        },
      }))
    }, state)
    await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      { async destroyAndProveAbsent() { destroyed += 1 } },
      ARTIFACT_ATTESTATION,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async (session) => {
        await session.exchangeAuthenticatedLine(firstLine, expected)
        try {
          await session.exchangeAuthenticatedLine(secondLine, secondExpected)
        } catch {}
      },
    )).rejects.toMatchObject({ code: "validation_failed" })
    expect({ writes: state.writes, processKills: state.processKills, destroyed }).toEqual({
      writes: 2,
      processKills: 0,
      destroyed: 1,
    })
  })

  test("destroys on extra stdout frames and any stderr", async () => {
    for (const mode of ["extra_stdout", "stderr"] as const) {
      const request = statRequest()
      const state = { writes: 0, processKills: 0 }
      let destroyed = 0
      const response = authenticatedResponse(request.expected, {
        result: { mode: 0o600, path: "result.txt", sha256: NONCE, size: 0, type: "file" },
      })
      const commands = fakeBrokerCommands(async (options) => {
        await options.onStdout?.(mode === "extra_stdout" ? response + response : response)
        if (mode === "stderr") {
          try { await options.onStderr?.("unexpected stderr") } catch {}
        }
      }, state)
      await expect(withAuthenticatedE2bGuestBrokerDuplexSdkSession(
        commands as never,
        { async destroyAndProveAbsent() { destroyed += 1 } },
        ARTIFACT_ATTESTATION,
        LIMITS,
        SESSION_BINDING,
        MAC_KEY,
        async (session) => { await session.exchangeAuthenticatedLine(request.line, request.expected) },
      )).rejects.toMatchObject({ code: "integrity_failed" })
      expect({ processKills: state.processKills, destroyed }).toEqual({ processKills: 0, destroyed: 1 })
    }
  })

  test("installs only the reviewed artifact as root and attests exact bytes, mode and owner", async () => {
    const artifact = new Uint8Array(await readFile(resolve("scripts/e2b-guest-broker-v1.py")))
    const calls: unknown[] = []
    const port: E2bGuestBrokerArtifactControlPortV1 = {
      files: {
        write(path, data, options) {
          calls.push(["write", path, new Uint8Array(data).slice(), options])
          return Promise.resolve({ name: "sandboxes-broker-v1", path })
        },
        read(path, options) {
          calls.push(["read", path, options])
          return Promise.resolve(artifact.slice())
        },
        getInfo(path, options) {
          calls.push(["getInfo", path, options])
          return Promise.resolve({
            name: "sandboxes-broker-v1",
            path,
            size: artifact.byteLength,
            mode: 0o500,
            permissions: "r-x------",
            owner: "root",
            group: "root",
            type: "file" as never,
          })
        },
      },
      commands: {
        run(command, options) {
          calls.push(["run", command, options])
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })
        },
      },
      destruction: {
        async destroyAndProveAbsent() {
          calls.push(["destroy"])
        },
      },
    }

    const attestation = await installExactE2bGuestBrokerArtifactV1(port, artifact, 1_000)

    expect(attestation).toEqual({
      path: E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
      artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
      byte_length: artifact.byteLength,
      mode: 0o500,
      owner: "root",
      group: "root",
    })
    expect(calls.map((call) => (call as unknown[])[0])).toEqual(["write", "run", "read", "getInfo"])
    expect(calls[0]).toEqual(["write", E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1, artifact, {
      requestTimeoutMs: 1_000,
      user: "root",
    }])
  })

  test("destroys and proves absence on ambiguous artifact readback", async () => {
    const artifact = new Uint8Array(await readFile(resolve("scripts/e2b-guest-broker-v1.py")))
    let destroyed = 0
    const port = {
      files: {
        write: () => Promise.resolve({}),
        read: () => Promise.resolve(Uint8Array.from([...artifact, 0])),
        getInfo: () => Promise.resolve({}),
      },
      commands: { run: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }) },
      destruction: {
        async destroyAndProveAbsent() {
          destroyed += 1
        },
      },
    }

    await expect(installExactE2bGuestBrokerArtifactV1(port as never, artifact, 1_000))
      .rejects.toMatchObject({ code: "integrity_failed" })
    expect(destroyed).toBe(1)
  })

  test("keeps artifact cleanup failure quarantined after exactly one destruction attempt", async () => {
    const artifact = new Uint8Array(await readFile(resolve("scripts/e2b-guest-broker-v1.py")))
    let attempts = 0
    const port = {
      files: {
        write: () => Promise.reject(new Error("write outcome unknown")),
        read: () => Promise.resolve(artifact),
        getInfo: () => Promise.resolve({}),
      },
      commands: { run: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }) },
      destruction: {
        async destroyAndProveAbsent() {
          attempts += 1
          throw new Error("absence unproven")
        },
      },
    }
    await expect(installExactE2bGuestBrokerArtifactV1(port as never, artifact, 1_000))
      .rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
    expect(attempts).toBe(1)
  })

  test("exchanges a harmless command, bounded file and checkpoint with the local broker", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "e2b-guest-host-wire-"))
    cleanup.push(workspace)
    let destroyed = 0
    const localArtifact = new Uint8Array(await readFile(resolve("scripts/e2b-guest-broker-v1.py")))
    const localAttestation = { ...ARTIFACT_ATTESTATION, byte_length: localArtifact.byteLength }
    const commands = {
      run(_command: string, options: {
        onStdout?: (data: string) => void | Promise<void>
        onStderr?: (data: string) => void | Promise<void>
      }) {
        const child = Bun.spawn({
          cmd: [
            "python3",
            resolve("scripts/e2b-guest-broker-v1.py"),
            "--stdio",
            "--allow-non-root-for-test",
            "--test-workspace-root",
            workspace,
          ],
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        })
        const pump = async (
          stream: ReadableStream<Uint8Array>,
          callback?: (data: string) => void | Promise<void>,
        ): Promise<void> => {
          const decoder = new TextDecoder()
          const reader = stream.getReader()
          try {
            while (true) {
              const item = await reader.read()
              if (item.done) break
              await callback?.(decoder.decode(item.value, { stream: true }))
            }
            const tail = decoder.decode()
            if (tail.length > 0) await callback?.(tail)
          } finally {
            reader.releaseLock()
          }
        }
        let startupBuffered = ""
        let startupSeen = false
        const stdout = pump(child.stdout, async (data) => {
          startupBuffered += data
          while (true) {
            const newline = startupBuffered.indexOf("\n")
            if (newline < 0) break
            const line = startupBuffered.slice(0, newline + 1)
            startupBuffered = startupBuffered.slice(newline + 1)
            if (!startupSeen) {
              startupSeen = true
              const parsed = JSON.parse(line) as { result: { process_baseline_sha256: string; size: number } }
              await options.onStdout?.(startupResponse({
                processBaselineSha256: parsed.result.process_baseline_sha256,
                size: parsed.result.size,
              }))
            } else {
              await options.onStdout?.(line)
            }
          }
        })
        const stderr = pump(child.stderr, options.onStderr)
        const wait = Promise.all([child.exited, stdout, stderr]).then(([exitCode]) => ({
          exitCode,
          stdout: "",
          stderr: "",
        }))
        return Promise.resolve({
          async sendStdin(data: Uint8Array) {
            child.stdin.write(data)
            await child.stdin.flush()
          },
          async closeStdin() {
            child.stdin.end()
          },
          wait: () => wait,
          async kill() {
            child.kill(9)
            return true
          },
          async disconnect() {},
        })
      },
    }

    await withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands as never,
      { async destroyAndProveAbsent() { destroyed += 1 } },
      localAttestation,
      LIMITS,
      SESSION_BINDING,
      MAC_KEY,
      async (session) => {
        let sequence = 0
        const exchange = (operation: "exec" | "file_write" | "checkpoint", payload: Record<string, unknown>) => {
          const current = sequence++
          const nonce = current === 0 ? NONCE : `sha256:${current.toString(16).padStart(64, "0")}` as const
          return exchangeE2bGuestBrokerRequestV1(session, {
            session_binding_sha256: SESSION_BINDING,
            request_id: `request-${current}`,
            sequence: current,
            nonce_sha256: nonce,
            operation,
            payload,
          }, MAC_KEY)
        }
        const exec = await exchange("exec", {
          argv: ["/bin/echo", "host-wire-ok"],
          cwd: ".",
          exec_id: "exec-1",
          idle_timeout_ms: 1_000,
          output_limit_bytes: 1_024,
          pids_limit: 4,
          wall_timeout_ms: 2_000,
        })
        expect(exec.ok).toBe(true)
        expect(Buffer.from(String(exec.result?.stdout_base64), "base64").toString()).toBe("host-wire-ok\n")
        expect((await exchange("file_write", {
          content_base64: Buffer.from("checkpoint-data").toString("base64"),
          if_absent: true,
          max_bytes: 64,
          mode: 0o600,
          path: "result.txt",
        })).ok).toBe(true)
        const checkpoint = await exchange("checkpoint", {
          max_depth: 4,
          max_duration_ms: 2_000,
          max_file_bytes: 64,
          max_files: 4,
          max_total_bytes: 128,
        })
        expect(checkpoint.ok).toBe(true)
        expect(checkpoint.result?.file_count).toBe(1)
      },
    )
    expect(destroyed).toBe(1)
  })
})
