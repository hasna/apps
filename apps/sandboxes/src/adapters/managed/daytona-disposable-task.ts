import type { Sandbox as DaytonaSandbox } from "@daytona/sdk"
import { adapterError } from "./errors"
import {
  createManagedDisposableSandboxTaskRunnerCandidateV1,
  type E2bDisposableResourceAccessPortV1,
  type E2bDisposableResourceSurfaceV1,
  type ManagedDisposableRunnerConfigV1,
} from "./e2b-disposable-task"
import { DaytonaOfficialSdkControlBridgeV1 } from "./sdk-control-bridges"
import type { DisposableSandboxTaskRunnerV1 } from "./disposable-task"

export const DAYTONA_DISPOSABLE_TASK_PRODUCTION_ADMISSION_V1 = false as const

export interface DaytonaOfficialResourceSdkV1 {
  get(opaqueResourceId: string): Promise<DaytonaSandbox | "absent">
}

function ownData(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined ||
    descriptor.set !== undefined) throw adapterError("integrity_failed")
  return descriptor.value
}

function timeoutSeconds(milliseconds: number): number {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 90_000) {
    throw adapterError("validation_failed")
  }
  return Math.ceil(milliseconds / 1_000)
}

function numericMode(mode: string, permissions: string): number {
  if (/^[0-7]{3,4}$/u.test(mode)) return Number.parseInt(mode.slice(-3), 8)
  const text = permissions.length === 10 ? permissions.slice(1) : permissions
  if (!/^[rwx-]{9}$/u.test(text)) throw adapterError("integrity_failed")
  let result = 0
  for (let index = 0; index < 9; index += 1) {
    if (text[index] !== "-") result |= 1 << (8 - index)
  }
  return result
}

/** Credential-bound Daytona SDK resource bridge. Credentials remain inside the injected `get` closure. */
export class DaytonaOfficialResourceAccessBridgeV1 implements E2bDisposableResourceAccessPortV1 {
  constructor(private readonly sdk: DaytonaOfficialResourceSdkV1) {}

  async withResource<T>(
    opaqueResourceId: string,
    use: (surface: E2bDisposableResourceSurfaceV1) => Promise<T>,
  ): Promise<T> {
    if (typeof opaqueResourceId !== "string" || opaqueResourceId.length === 0 ||
      opaqueResourceId.length > 4096 || /[\0-\x1f\x7f]/u.test(opaqueResourceId)) {
      throw adapterError("validation_failed")
    }
    const sandbox = await this.sdk.get(opaqueResourceId)
    if (sandbox === "absent") throw adapterError("provider_state_unknown", { quarantineRequired: true })
    if (ownData(sandbox, "id") !== opaqueResourceId) throw adapterError("integrity_failed")
    const fs = ownData(sandbox, "fs") as DaytonaSandbox["fs"]
    const process = ownData(sandbox, "process") as DaytonaSandbox["process"]
    if (fs === null || typeof fs !== "object" || process === null || typeof process !== "object") {
      throw adapterError("integrity_failed")
    }

    const run = async (command: string, options: Record<string, unknown>): Promise<unknown> => {
      if (typeof command !== "string" || command.length === 0 || options === null ||
        typeof options !== "object") throw adapterError("validation_failed")
      if (options.background === true) {
        const onStdout = options.onStdout
        const onStderr = options.onStderr
        if (typeof onStdout !== "function" || typeof onStderr !== "function" ||
          options.stdin !== true || options.user !== "root") throw adapterError("validation_failed")
        const handle = await process.createPty({
          id: "hasna-sandboxes-disposable-v1",
          cwd: "/workspace",
          envs: {},
          cols: 80,
          rows: 24,
          onData: async (data) => {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(data)
            await Reflect.apply(onStdout, undefined, [text])
          },
        })
        await handle.waitForConnection()
        await handle.sendInput(`stty raw -echo; exec ${command}\n`)
        return {
          pid: 1,
          get exitCode() { return handle.exitCode },
          get error() { return handle.error },
          stdout: "",
          stderr: "",
          sendStdin(data: string | Uint8Array) { return handle.sendInput(data) },
          closeStdin() { return handle.sendInput(new Uint8Array([4])) },
          async kill() { await handle.kill(); return true },
          disconnect() { return handle.disconnect() },
          async wait() {
            const result = await handle.wait()
            return { exitCode: result.exitCode ?? 1, error: result.error, stdout: "", stderr: "" }
          },
        }
      }
      if (options.background !== false || (options.user !== "root" && options.user !== "user") ||
        (options.cwd !== "/" && options.cwd !== "/workspace") ||
        options.envs === null || typeof options.envs !== "object" ||
        Reflect.ownKeys(options.envs).length !== 0 || typeof options.timeoutMs !== "number") {
        throw adapterError("validation_failed")
      }
      const result = await process.executeCommand(
        command,
        options.cwd,
        {},
        timeoutSeconds(options.timeoutMs),
      )
      return { exitCode: result.exitCode, stdout: result.result, stderr: "" }
    }

    const surface = {
      files: {
        async write(path: string, data: ArrayBuffer, options: { requestTimeoutMs: number; user: "root" }) {
          if (options.user !== "root" || !(data instanceof ArrayBuffer)) throw adapterError("validation_failed")
          await fs.uploadFile(Buffer.from(data), path, timeoutSeconds(options.requestTimeoutMs))
          return { name: path.split("/").at(-1) ?? "", path }
        },
        async read(path: string, options: { format: "bytes"; requestTimeoutMs: number; user: "root" }) {
          if (options.user !== "root" || options.format !== "bytes") throw adapterError("validation_failed")
          const bytes = await fs.downloadFile(path, timeoutSeconds(options.requestTimeoutMs))
          return new Uint8Array(bytes)
        },
        async getInfo(path: string, options: { requestTimeoutMs: number; user: "root" }) {
          if (options.user !== "root") throw adapterError("validation_failed")
          timeoutSeconds(options.requestTimeoutMs)
          const info = await fs.getFileDetails(path)
          return {
            name: info.name,
            path,
            type: info.isDir ? "directory" : "file",
            size: info.size,
            mode: numericMode(info.mode, info.permissions),
            permissions: info.permissions,
            owner: info.owner,
            group: info.group,
          }
        },
      },
      commands: { run },
    } as unknown as E2bDisposableResourceSurfaceV1
    return use(Object.freeze(surface))
  }
}

export type DaytonaDisposableRunnerConfigV1 = Omit<
  ManagedDisposableRunnerConfigV1,
  "provider" | "control" | "resource_access"
> & {
  control: DaytonaOfficialSdkControlBridgeV1
  resource_access: DaytonaOfficialResourceAccessBridgeV1
}

/** Official-SDK Daytona candidate; V2 public admission remains false until live smoke evidence lands. */
export function createDaytonaDisposableSandboxTaskRunnerV1(
  config: DaytonaDisposableRunnerConfigV1,
): DisposableSandboxTaskRunnerV1 {
  if (!(config.control instanceof DaytonaOfficialSdkControlBridgeV1) ||
    !(config.resource_access instanceof DaytonaOfficialResourceAccessBridgeV1) ||
    config.template_mapping_attested !== true) throw adapterError("integrity_failed")
  return createManagedDisposableSandboxTaskRunnerCandidateV1({
    ...config,
    provider: "daytona_cloud",
  })
}
