import { afterEach, describe, expect, test } from "bun:test"
import { createHash, createHmac, randomBytes } from "node:crypto"
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
  E2B_GUEST_BROKER_KEY_INIT_BYTES_V1,
  E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1,
  E2B_GUEST_BROKER_PRODUCTION_ADMISSION_V1,
  E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
  E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_SHA256_V1,
  E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1,
  decodeE2bGuestBrokerProtocolErrorLineV1,
  decodeE2bGuestBrokerResponseLineV1,
  decodeE2bGuestBrokerStartupLineV1,
  e2bGuestBrokerBootstrapCommandV1,
  e2bGuestBrokerBootstrapArgvV1,
  encodeE2bGuestBrokerSessionKeyInitV1,
  encodeE2bGuestBrokerRequestLineV1,
  verifyE2bGuestBrokerArtifactV1,
  type E2bGuestBrokerOperationV1,
  type E2bGuestBrokerResponseFrameV1,
} from "../../src/adapters/managed/e2b-guest-broker"

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(HERE, "../../scripts/e2b-guest-broker-v1.py")
const SESSION = `sha256:${"a".repeat(64)}` as const
const KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1))
const TEST_VERIFIED_FD_LAUNCHER = "import hashlib,os,stat,sys;p=sys.argv[1];w=sys.argv[2];e=sys.argv[3];f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC);s=os.fstat(f);d=b''.join(iter(lambda:os.read(f,65536),b''));ok=stat.S_ISREG(s.st_mode) and s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==0o500 and len(d)==s.st_size and 'sha256:'+hashlib.sha256(d).hexdigest()==e;ok or sys.exit(70);os.lseek(f,0,0);os.set_inheritable(f,True);os.execve('/proc/self/fd/%d'%f,[p,'--stdio','--allow-non-root-for-test','--test-workspace-root',w,'--executed-fd',str(f),'--expected-artifact-sha256',e,'--test-executed-path',p],{'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8'})"
const temporaryDirectories: string[] = []
const brokers: BrokerHarness[] = []

afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.close()
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function canonicalTestJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalTestJson).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalTestJson(item)}`)
    .join(",")}}`
}

interface PendingLine {
  resolve(value: Uint8Array): void
  reject(error: Error): void
}

class BrokerHarness {
  readonly child: {
    stdin: { write(value: Uint8Array): number | Promise<number>; flush(): number | Promise<number>; end(): number | Promise<number> }
    stdout: ReadableStream<Uint8Array>
    stderr: ReadableStream<Uint8Array>
    exited: Promise<number>
    kill(signal?: number | NodeJS.Signals): void
  }
  readonly lines: Uint8Array[] = []
  readonly pending: PendingLine[] = []
  readonly stderr: Uint8Array[] = []
  #buffer = Buffer.alloc(0)
  #closed = false
  #exit: Promise<number>

  constructor(workspace: string, artifactPath: string, artifactSha256: string) {
    const child = Bun.spawn({
      cmd: [
        "/usr/bin/python3",
        "-I",
        "-c",
        TEST_VERIFIED_FD_LAUNCHER,
        artifactPath,
        workspace,
        artifactSha256,
      ],
      env: {},
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    this.child = child
    const initialization = encodeE2bGuestBrokerSessionKeyInitV1(SESSION, KEY)
    expect(initialization.byteLength).toBe(E2B_GUEST_BROKER_KEY_INIT_BYTES_V1)
    child.stdin.write(initialization)
    void child.stdin.flush()
    void this.#pumpStdout(child.stdout)
    void this.#pumpStderr(child.stderr)
    this.#exit = child.exited
  }

  async #pumpStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader()
    while (true) {
      const item = await reader.read()
      if (item.done) return
      this.#accept(Buffer.from(item.value))
    }
  }

  async #pumpStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader()
    while (true) {
      const item = await reader.read()
      if (item.done) return
      this.stderr.push(item.value)
    }
  }

  #accept(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    while (true) {
      const newline = this.#buffer.indexOf(0x0a)
      if (newline < 0) return
      const line = new Uint8Array(this.#buffer.subarray(0, newline + 1))
      this.#buffer = this.#buffer.subarray(newline + 1)
      const waiter = this.pending.shift()
      if (waiter === undefined) this.lines.push(line)
      else waiter.resolve(line)
    }
  }

  nextLine(timeoutMs = 5_000): Promise<Uint8Array> {
    const queued = this.lines.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolveLine, rejectLine) => {
      const timeout = setTimeout(() => {
        const index = this.pending.indexOf(waiter)
        if (index >= 0) this.pending.splice(index, 1)
        rejectLine(new Error(`broker response timeout; stderr=${Buffer.concat(this.stderr).toString("utf8")}`))
      }, timeoutMs)
      const waiter: PendingLine = {
        resolve(value) {
          clearTimeout(timeout)
          resolveLine(value)
        },
        reject(error) {
          clearTimeout(timeout)
          rejectLine(error)
        },
      }
      this.pending.push(waiter)
    })
  }

  write(line: Uint8Array): void {
    this.child.stdin.write(line)
    void this.child.stdin.flush()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    void this.child.stdin.end()
    const exitCode = await Promise.race([
      this.#exit,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("broker did not exit")), 2_000)),
    ]).catch(async (error: unknown) => {
      this.child.kill("SIGKILL")
      await this.#exit
      throw error
    })
    if (exitCode !== 0) {
      throw new Error(`broker exited ${String(exitCode)}: ${Buffer.concat(this.stderr).toString("utf8")}`)
    }
    expect(this.#buffer.byteLength).toBe(0)
  }
}

async function createBroker(): Promise<{ broker: BrokerHarness; workspace: string }> {
  const workspace = await mkdtemp(join(tmpdir(), "e2b-guest-broker-"))
  temporaryDirectories.push(workspace)
  await chmod(workspace, 0o700)
  const artifact = await readFile(SCRIPT)
  const artifactDirectory = await mkdtemp(join(tmpdir(), "e2b-guest-artifact-"))
  temporaryDirectories.push(artifactDirectory)
  const artifactPath = join(artifactDirectory, "sandboxes-broker-v1")
  await writeFile(artifactPath, artifact)
  await chmod(artifactPath, 0o500)
  const artifactInfo = await stat(artifactPath)
  const artifactSha256 = `sha256:${createHash("sha256").update(artifact).digest("hex")}` as const
  const broker = new BrokerHarness(workspace, artifactPath, artifactSha256)
  brokers.push(broker)
  const startup = decodeE2bGuestBrokerStartupLineV1(await broker.nextLine(), {
    session_binding_sha256: SESSION,
    artifact_sha256: artifactSha256,
    path: artifactPath,
    uid: process.getuid?.() ?? artifactInfo.uid,
    gid: process.getgid?.() ?? artifactInfo.gid,
    mode: artifactInfo.mode & 0o777,
    size: artifactInfo.size,
    verified_fd: true,
  }, KEY)
  expect(startup).toMatchObject({
    ok: true,
    operation: "startup",
    result: {
      exec_limit: 1,
      exec_cancel: false,
      resume: false,
      production_admission: false,
      checkpoint_eligible: false,
    },
  })
  return { broker, workspace }
}

function requestLine(
  sequence: number,
  operation: E2bGuestBrokerOperationV1,
  payload: Record<string, unknown>,
  requestId = `request-${sequence}`,
): { line: Uint8Array; expected: { request_id: string; sequence: number; nonce_sha256: `sha256:${string}`; session_binding_sha256: typeof SESSION; operation: E2bGuestBrokerOperationV1 } } {
  const nonce = sha256(`nonce-${sequence}-${requestId}`)
  return {
    line: encodeE2bGuestBrokerRequestLineV1({
      session_binding_sha256: SESSION,
      request_id: requestId,
      sequence,
      nonce_sha256: nonce,
      operation,
      payload,
    }, KEY),
    expected: {
      request_id: requestId,
      sequence,
      nonce_sha256: nonce,
      session_binding_sha256: SESSION,
      operation,
    },
  }
}

/** Test-only authenticated frame builder that intentionally bypasses host-side payload validation. */
function rawRequestLine(
  sequence: number,
  operation: E2bGuestBrokerOperationV1,
  payload: Record<string, unknown>,
  requestId = `request-${sequence}`,
): { line: Uint8Array; expected: { request_id: string; sequence: number; nonce_sha256: `sha256:${string}`; session_binding_sha256: typeof SESSION; operation: E2bGuestBrokerOperationV1 } } {
  const nonce = sha256(`nonce-${sequence}-${requestId}`)
  const expected = {
    request_id: requestId,
    sequence,
    nonce_sha256: nonce,
    session_binding_sha256: SESSION,
    operation,
  }
  const basis = {
    nonce_sha256: nonce,
    operation,
    payload,
    protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
    request_id: requestId,
    schema_version: "sandboxes.e2b-guest-broker-request/v1",
    sequence,
    session_binding_sha256: SESSION,
  }
  const macSha256 = `sha256:${createHmac("sha256", KEY).update(canonicalTestJson(basis)).digest("hex")}`
  return {
    line: new TextEncoder().encode(`${canonicalTestJson({ ...basis, mac_sha256: macSha256 })}\n`),
    expected,
  }
}

async function exchange(
  broker: BrokerHarness,
  sequence: number,
  operation: E2bGuestBrokerOperationV1,
  payload: Record<string, unknown>,
): Promise<E2bGuestBrokerResponseFrameV1> {
  const request = requestLine(sequence, operation, payload)
  broker.write(request.line)
  return decodeE2bGuestBrokerResponseLineV1(await broker.nextLine(), request.expected, KEY)
}

async function exchangeRaw(
  broker: BrokerHarness,
  sequence: number,
  operation: E2bGuestBrokerOperationV1,
  payload: Record<string, unknown>,
): Promise<E2bGuestBrokerResponseFrameV1> {
  const request = rawRequestLine(sequence, operation, payload)
  broker.write(request.line)
  return decodeE2bGuestBrokerResponseLineV1(await broker.nextLine(), request.expected, KEY)
}

describe("E2B guest broker artifact and host codec", () => {
  test("pins the exact artifact and keeps production admission closed", async () => {
    const artifact = new Uint8Array(await readFile(SCRIPT))
    expect(verifyE2bGuestBrokerArtifactV1(artifact)).toBe(true)
    expect(E2B_GUEST_BROKER_ARTIFACT_SHA256_V1).toBe(`sha256:${createHash("sha256").update(artifact).digest("hex")}`)
    expect(E2B_GUEST_BROKER_ARTIFACT_SIZE_V1).toBe(artifact.byteLength)
    expect(verifyE2bGuestBrokerArtifactV1(Uint8Array.from([...artifact, 0x0a]))).toBe(false)
    expect(E2B_GUEST_BROKER_PRODUCTION_ADMISSION_V1).toBe(false)
    expect(E2B_GUEST_BROKER_PROTOCOL_SHA256_V1).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1).toBeLessThanOrEqual(1_048_576)
    const bootstrapArgv = e2bGuestBrokerBootstrapArgvV1()
    expect(bootstrapArgv).toEqual([
      "/usr/bin/python3",
      "-I",
      "-c",
      E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1,
      E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
      E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
    ])
    expect(E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_SHA256_V1).toBe(sha256(E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1))
    expect(E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1).toContain("sandboxes-broker-v1.used")
    expect(E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1).toContain(
      "os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600",
    )
    expect(E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1).toContain(
      "v.st_uid==0 and v.st_gid==0 and stat.S_IMODE(v.st_mode)==0o600 and v.st_nlink==1",
    )
    expect(E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1).toContain("/proc/self/fd/%d")
    expect(e2bGuestBrokerBootstrapCommandV1()).not.toContain("\n")
  })

  test("uses canonical LF frames and rejects response tampering and framing ambiguity", async () => {
    const request = requestLine(0, "file_stat", { path: "missing" })
    const text = new TextDecoder().decode(request.line)
    expect(text.endsWith("\n")).toBe(true)
    expect(text).not.toContain("\r")
    expect(text).not.toContain(" ")
    expect(() => encodeE2bGuestBrokerRequestLineV1({
      session_binding_sha256: SESSION,
      request_id: "bad",
      sequence: 0,
      nonce_sha256: sha256("bad"),
      operation: "file_stat",
      payload: { path: "x", extra: true },
    }, KEY)).toThrow("invalid_payload")

    const { broker } = await createBroker()
    broker.write(request.line)
    const response = await broker.nextLine()
    expect(decodeE2bGuestBrokerResponseLineV1(response, request.expected, KEY).ok).toBe(false)
    const tampered = response.slice()
    const tamperIndex = tampered.byteLength - 3
    tampered[tamperIndex] = (tampered[tamperIndex] ?? 0) ^ 1
    expect(() => decodeE2bGuestBrokerResponseLineV1(tampered, request.expected, KEY)).toThrow()
    expect(() => decodeE2bGuestBrokerResponseLineV1(response.subarray(0, response.byteLength - 1), request.expected, KEY)).toThrow("invalid_framing")
    expect(() => decodeE2bGuestBrokerResponseLineV1(Uint8Array.from([...response, 0x0a]), request.expected, KEY)).toThrow("invalid_framing")
  })
})

describe("local Python E2B guest broker", () => {
  test("executes harmless argv shell-free and performs bounded files plus deterministic checkpoint", async () => {
    const { broker } = await createBroker()
    const write = await exchange(broker, 0, "file_write", {
      path: "input.txt",
      content_base64: Buffer.from("hello\n").toString("base64"),
      mode: 0o600,
      if_absent: true,
      max_bytes: 4_096,
    })
    expect(write.ok).toBe(true)

    const exec = await exchange(broker, 1, "exec", {
      exec_id: "exec-1",
      argv: ["/usr/bin/python3", "-c", "from pathlib import Path; print(Path('input.txt').read_text().strip())"],
      cwd: ".",
      wall_timeout_ms: 3_000,
      idle_timeout_ms: 1_000,
      output_limit_bytes: 4_096,
      pids_limit: 16,
    })
    expect(exec.ok).toBe(true)
    expect(exec.result).toMatchObject({ status: "exited", exit_code: 0, stdout_base64: Buffer.from("hello\n").toString("base64") })

    const read = await exchange(broker, 2, "file_read", {
      path: "input.txt",
      offset: 0,
      length: 32,
      max_bytes: 32,
    })
    expect(read.ok).toBe(true)
    expect(read.result).toMatchObject({ content_base64: Buffer.from("hello\n").toString("base64"), size: 6 })

    const conditionalWrite = await exchange(broker, 3, "file_write", {
      path: "input.txt",
      content_base64: Buffer.from("hello\n").toString("base64"),
      mode: 0o600,
      expected_prior_sha256: sha256("hello\n"),
      max_bytes: 4_096,
    })
    expect(conditionalWrite.ok).toBe(true)
    const list = await exchange(broker, 4, "file_list", { path: ".", depth: 2, limit: 16 })
    expect(list).toMatchObject({ ok: true, result: { entries: [{ path: "input.txt", type: "file", size: 6 }] } })

    const first = await exchange(broker, 5, "checkpoint", {
      max_files: 16,
      max_total_bytes: 16_384,
      max_file_bytes: 4_096,
      max_depth: 4,
      max_duration_ms: 2_000,
    })
    const second = await exchange(broker, 6, "checkpoint", {
      max_files: 16,
      max_total_bytes: 16_384,
      max_file_bytes: 4_096,
      max_depth: 4,
      max_duration_ms: 2_000,
    })
    expect(first.ok).toBe(true)
    expect(first.result).toEqual(second.result)
    expect(first.result).toMatchObject({
      provider_snapshot_is_canonical: false,
      file_count: 1,
      total_bytes: 6,
    })
    const secondExec = await exchange(broker, 7, "exec", {
      exec_id: "exec-2",
      argv: ["/usr/bin/true"],
      cwd: ".",
      wall_timeout_ms: 1_000,
      idle_timeout_ms: 1_000,
      output_limit_bytes: 1_024,
      pids_limit: 4,
    })
    expect(secondExec).toMatchObject({ ok: false, error: { code: "destroy_required" } })
    const checkpointAfterTaint = await exchange(broker, 8, "checkpoint", {
      max_files: 16,
      max_total_bytes: 16_384,
      max_file_bytes: 4_096,
      max_depth: 4,
      max_duration_ms: 2_000,
    })
    expect(checkpointAfterTaint).toMatchObject({ ok: false, error: { code: "destroy_required" } })
  })

  test("rejects traversal, symlinks and special files without following them", async () => {
    const traversalHarness = await createBroker()
    const outside = join(dirname(traversalHarness.workspace), `outside-${randomBytes(4).toString("hex")}`)
    await writeFile(outside, "secret")
    temporaryDirectories.push(outside)
    const traversal = await exchangeRaw(traversalHarness.broker, 0, "file_read", {
      path: "../outside",
      offset: 0,
      length: 32,
      max_bytes: 32,
    })
    expect(traversal).toMatchObject({ ok: false, error: { code: "invalid_path" } })

    const symlinkHarness = await createBroker()
    await symlink(outside, join(symlinkHarness.workspace, "link"))
    const symlinkRead = await exchange(symlinkHarness.broker, 0, "file_read", {
      path: "link",
      offset: 0,
      length: 32,
      max_bytes: 32,
    })
    expect(symlinkRead).toMatchObject({ ok: false, error: { code: "unsafe_file" } })

    const gitHarness = await createBroker()
    const git = await exchangeRaw(gitHarness.broker, 0, "file_stat", { path: ".git/config" })
    expect(git).toMatchObject({ ok: false, error: { code: "invalid_path" } })

    const specialHarness = await createBroker()
    const fifo = join(specialHarness.workspace, "fifo")
    const mkfifo = Bun.spawn({ cmd: ["/usr/bin/mkfifo", fifo], env: {}, stdout: "ignore", stderr: "pipe" })
    expect(await mkfifo.exited).toBe(0)
    const special = await exchange(specialHarness.broker, 0, "file_read", { path: "fifo", offset: 0, length: 1, max_bytes: 1 })
    expect(special).toMatchObject({ ok: false, error: { code: "unsafe_file" } })
  })

  test("makes every error response sticky and forbids later file or checkpoint authority", async () => {
    const { broker } = await createBroker()
    const write = await exchange(broker, 0, "file_write", {
      path: "input.txt",
      content_base64: Buffer.from("hello\n").toString("base64"),
      mode: 0o600,
      if_absent: true,
      max_bytes: 4_096,
    })
    expect(write.ok).toBe(true)
    const failedPrecondition = await exchange(broker, 1, "file_write", {
      path: "input.txt",
      content_base64: Buffer.from("changed\n").toString("base64"),
      mode: 0o600,
      expected_prior_sha256: sha256("wrong-prior"),
      max_bytes: 4_096,
    })
    expect(failedPrecondition).toMatchObject({ ok: false, error: { code: "precondition_failed" } })
    const afterError = await exchange(broker, 2, "file_read", { path: "input.txt", offset: 0, length: 32, max_bytes: 32 })
    expect(afterError).toMatchObject({ ok: false, error: { code: "destroy_required" } })
  })

  test("enforces output, process and timeout limits and makes abnormal exec terminal", async () => {
    const outputHarness = await createBroker()
    const output = await exchange(outputHarness.broker, 0, "exec", {
      exec_id: "exec-output",
      argv: ["/usr/bin/python3", "-c", "import sys; sys.stdout.write('x' * 100000)"],
      cwd: ".",
      wall_timeout_ms: 3_000,
      idle_timeout_ms: 1_000,
      output_limit_bytes: 1_024,
      pids_limit: 16,
    })
    expect(output).toMatchObject({ ok: true, result: { status: "output_limit", output_truncated: true, destroy_required: true, checkpoint_eligible: false } })
    expect(Buffer.from(String((output.result as Record<string, unknown>).stdout_base64), "base64").byteLength).toBeLessThanOrEqual(1_024)
    const blockedCheckpoint = await exchange(outputHarness.broker, 1, "checkpoint", {
      max_files: 1,
      max_total_bytes: 1,
      max_file_bytes: 1,
      max_depth: 1,
      max_duration_ms: 100,
    })
    expect(blockedCheckpoint).toMatchObject({ ok: false, error: { code: "destroy_required" } })

    const forkHarness = await createBroker()
    const forks = await exchange(forkHarness.broker, 0, "exec", {
      exec_id: "exec-forks",
      argv: ["/usr/bin/python3", "-c", "import os\nlimited=False\nchildren=[]\nfor _ in range(32):\n try:\n  pid=os.fork()\n  if pid==0: os._exit(0)\n  children.append(pid)\n except OSError:\n  limited=True\n  break\nfor pid in children: os.waitpid(pid,0)\nprint('limited' if limited else 'unbounded')"],
      cwd: ".",
      wall_timeout_ms: 3_000,
      idle_timeout_ms: 1_000,
      output_limit_bytes: 4_096,
      pids_limit: 4,
    })
    expect(forks.ok).toBe(true)
    expect(Buffer.from(String((forks.result as Record<string, unknown>).stdout_base64), "base64").toString()).toContain("limited")

    const idleHarness = await createBroker()
    const idle = await exchange(idleHarness.broker, 0, "exec", {
      exec_id: "exec-idle",
      argv: ["/usr/bin/python3", "-c", "import time; time.sleep(1)"],
      cwd: ".",
      wall_timeout_ms: 2_000,
      idle_timeout_ms: 50,
      output_limit_bytes: 4_096,
      pids_limit: 4,
    })
    expect(idle).toMatchObject({ ok: true, result: { status: "idle_timeout", destroy_required: true } })

    const wallHarness = await createBroker()
    const wall = await exchange(wallHarness.broker, 0, "exec", {
      exec_id: "exec-wall",
      argv: ["/usr/bin/python3", "-c", "import sys,time\nwhile True:\n print('x', flush=True)\n time.sleep(.01)"],
      cwd: ".",
      wall_timeout_ms: 100,
      idle_timeout_ms: 1_000,
      output_limit_bytes: 4_096,
      pids_limit: 4,
    })
    expect(wall).toMatchObject({ ok: true, result: { status: "wall_timeout", destroy_required: true } })

    expect(() => requestLine(0, "cancel" as never, { exec_id: "forbidden", grace_ms: 0 })).toThrow("invalid_payload")
  })

  test("rejects malformed, wrong-MAC and replayed requests with bounded authenticated frames", async () => {
    const { broker } = await createBroker()
    const valid = requestLine(0, "file_stat", { path: "missing" })
    broker.write(valid.line)
    await broker.nextLine()

    broker.write(valid.line)
    const replay = decodeE2bGuestBrokerResponseLineV1(await broker.nextLine(), valid.expected, KEY)
    expect(replay).toMatchObject({ ok: false, error: { code: "replay" } })

    const wrongMac = requestLine(1, "file_stat", { path: "missing" })
    const text = new TextDecoder().decode(wrongMac.line)
    const changed = text.replace(/("mac_sha256":"sha256:)([0-9a-f])/, (_match, prefix: string, digit: string) => `${prefix}${digit === "0" ? "1" : "0"}`)
    broker.write(new TextEncoder().encode(changed))
    const auth = decodeE2bGuestBrokerResponseLineV1(await broker.nextLine(), wrongMac.expected, KEY)
    expect(auth).toMatchObject({ ok: false, error: { code: "authentication_failed" } })

    const validAfterAuthFailure = requestLine(1, "file_stat", { path: "." }, "after-auth-failure")
    broker.write(validAfterAuthFailure.line)
    expect(decodeE2bGuestBrokerResponseLineV1(await broker.nextLine(), validAfterAuthFailure.expected, KEY))
      .toMatchObject({ ok: false, error: { code: "destroy_required" } })

    broker.write(new TextEncoder().encode('{"x":1}\n'))
    const malformed = await broker.nextLine()
    expect(malformed.byteLength).toBeLessThan(E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1)
    const firstProtocolError = decodeE2bGuestBrokerProtocolErrorLineV1(malformed, SESSION, KEY)
    expect(firstProtocolError).toMatchObject({ ok: false, operation: "protocol_error", error: { code: "invalid_frame" } })
    broker.write(new TextEncoder().encode('{"x":2}\n'))
    const secondProtocolError = decodeE2bGuestBrokerProtocolErrorLineV1(await broker.nextLine(), SESSION, KEY)
    expect(secondProtocolError.request_id).not.toBe(firstProtocolError.request_id)
    expect(secondProtocolError.nonce_sha256).not.toBe(firstProtocolError.nonce_sha256)
    expect(new TextDecoder().decode(malformed)).not.toContain("Traceback")
  })
})
