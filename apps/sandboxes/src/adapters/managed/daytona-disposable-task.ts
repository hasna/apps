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
import {
  DAYTONA_GUEST_BROKER_LAUNCHER_PATH_V1,
  DAYTONA_GUEST_BROKER_LAUNCHER_SHA256_V1,
  DaytonaMailboxBoundaryErrorV1,
} from "./e2b-broker-artifact-control"
import {
  E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  e2bGuestBrokerBootstrapCommandV1,
} from "./e2b-guest-broker"

export const DAYTONA_DISPOSABLE_TASK_PRODUCTION_ADMISSION_V1 = false as const
const DAYTONA_BROKER_UPLOAD_STAGING_PATH_V1 = "/tmp/.hasna-sandboxes-broker-v1-upload-v1"
const DAYTONA_MAILBOX_SESSION_ID_V1 = "hasna-sandboxes-mailbox-v1"
const DAYTONA_MAILBOX_ROOT_V1 = "/run/hasna-daytona-broker-v1"
const DAYTONA_MAILBOX_UPLOAD_ROOT_V1 = "/tmp/.hasna-daytona-upload-v1"

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

const DAYTONA_EXECUTION_IDENTITY_ATTESTATION_SOURCE_V1 = `import grp,os,pwd,stat,sys
daytona=pwd.getpwnam('daytona')
nobody=pwd.getpwnam('nobody')
nogroup=grp.getgrgid(nobody.pw_gid)
try:
  pwd.getpwnam('user')
  sys.exit(70)
except KeyError:
  pass
def secure(path):
  value=os.stat(path,follow_symlinks=True)
  return stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_gid==0 and stat.S_IMODE(value.st_mode)&0o022==0
exact=daytona.pw_uid>0 and daytona.pw_gid>0 and os.geteuid()==daytona.pw_uid and os.getegid()==daytona.pw_gid and nobody.pw_uid==65534 and nobody.pw_gid==65534 and nogroup.gr_name=='nogroup' and all(secure(path) for path in ('/usr/bin/sudo','/usr/sbin/runuser','/bin/sh','/usr/bin/python3'))
sys.exit(0 if exact else 70)`

export const DAYTONA_EXECUTION_IDENTITY_ATTESTATION_COMMAND_V1 =
  `/usr/bin/python3 -I -c ${shellQuote(DAYTONA_EXECUTION_IDENTITY_ATTESTATION_SOURCE_V1)} && /usr/bin/sudo -n -- /usr/bin/python3 -I -c ${shellQuote("import os,sys;sys.exit(0 if os.geteuid()==0 and os.getegid()==0 else 70)")} && /usr/bin/sudo -n -- /usr/sbin/runuser -u nobody -- /usr/bin/python3 -I -c ${shellQuote("import grp,os,pwd,sys;a=pwd.getpwnam('nobody');g=grp.getgrgid(a.pw_gid);sys.exit(0 if a.pw_uid==65534 and a.pw_gid==65534 and g.gr_name=='nogroup' and os.geteuid()==a.pw_uid and os.getegid()==a.pw_gid else 70)")}` as const

const DAYTONA_ACCOUNT_IDENTITY_COMMAND_V1 = `/usr/bin/python3 -I -c ${shellQuote(
  "import os,pwd,sys;a=pwd.getpwnam('daytona');sys.stdout.write('sandboxes.daytona-account/v1 uid=%d gid=%d\\n'%(a.pw_uid,a.pw_gid))",
)}` as const
const DAYTONA_ACCOUNT_IDENTITY_RECEIPT_V1 =
  /^sandboxes\.daytona-account\/v1 uid=([1-9][0-9]*) gid=([1-9][0-9]*)\n$/u

const DAYTONA_BROKER_SUPERVISOR_VERIFIED_FD_SOURCE_V1 = `import hashlib,os,stat,sys
expected='${DAYTONA_GUEST_BROKER_LAUNCHER_SHA256_V1}'
flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
descriptors=[os.open('/',flags)]
try:
  for component in ('opt','hasna','bin'):
    descriptors.append(os.open(component,flags,dir_fd=descriptors[-1]))
  if any(os.fstat(value).st_uid!=0 or os.fstat(value).st_gid!=0 or stat.S_IMODE(os.fstat(value).st_mode)&0o022!=0 for value in descriptors): sys.exit(70)
  descriptor=os.open('daytona-broker-v1',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=descriptors[-1])
  before=os.fstat(descriptor)
  body=b''.join(iter(lambda:os.read(descriptor,65536),b''))
  after=os.fstat(descriptor)
  stable=(after.st_dev,after.st_ino,after.st_size,after.st_mode,after.st_uid,after.st_gid,after.st_mtime_ns,after.st_ctime_ns)==(before.st_dev,before.st_ino,before.st_size,before.st_mode,before.st_uid,before.st_gid,before.st_mtime_ns,before.st_ctime_ns)
  exact=stable and stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_uid==0 and before.st_gid==0 and stat.S_IMODE(before.st_mode)==0o500 and len(body)==before.st_size and 'sha256:'+hashlib.sha256(body).hexdigest()==expected
  if not exact: sys.exit(70)
  os.lseek(descriptor,0,0);os.set_inheritable(descriptor,True)
  os.execve('/proc/self/fd/%d'%descriptor,['${DAYTONA_GUEST_BROKER_LAUNCHER_PATH_V1}'],{'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8'})
finally:
  for value in reversed(descriptors): os.close(value)`
const DAYTONA_BROKER_SUPERVISOR_VERIFIED_FD_COMMAND_V1 =
  `/usr/bin/python3 -I -c ${shellQuote(DAYTONA_BROKER_SUPERVISOR_VERIFIED_FD_SOURCE_V1)}` as const

function daytonaMailboxControlCommandV1(action: "ready" | "close", index = 0): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 64) throw adapterError("validation_failed")
  const source = action === "ready"
    ? `import os,pwd,stat,sys,time
root='${DAYTONA_MAILBOX_ROOT_V1}'
deadline=time.monotonic()+20
while not os.path.exists(root+'/ready'):
  if time.monotonic()>=deadline: sys.exit(70)
  time.sleep(0.02)
directory=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
upload=os.open('/tmp/.hasna-daytona-upload-v1',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
try:
  account=pwd.getpwnam('daytona')
  u=os.fstat(upload)
  if account.pw_uid==0 or u.st_uid!=account.pw_uid or u.st_gid!=account.pw_gid or stat.S_IMODE(u.st_mode)!=0o700: sys.exit(70)
  descriptor=os.open('ready',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=directory)
  try:
    value=os.fstat(descriptor);body=os.read(descriptor,128)
    if not stat.S_ISREG(value.st_mode) or value.st_uid!=0 or value.st_gid!=0 or stat.S_IMODE(value.st_mode)!=0o600 or value.st_nlink!=1 or body!=b'sandboxes.daytona-mailbox/v1 ready=true\\n': sys.exit(70)
  finally: os.close(descriptor)
  os.unlink('ready',dir_fd=directory);os.fsync(directory)
finally:
  os.close(upload);os.close(directory)`
    : `import os,stat,sys,time
root='${DAYTONA_MAILBOX_ROOT_V1}'
directory=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
descriptor=-1
try:
  name='close-%06d'%${index}
  body=b'sandboxes.daytona-mailbox/v1 close=true\\n'
  descriptor=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=directory)
  if os.write(descriptor,body)!=len(body): sys.exit(70)
  os.fchown(descriptor,0,0);os.fchmod(descriptor,0o600);os.fsync(descriptor);os.close(descriptor);descriptor=-1;os.fsync(directory)
  closed='closed-%06d'%${index};deadline=time.monotonic()+20
  while True:
    try:
      value=os.open(closed,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=directory);break
    except FileNotFoundError:
      if time.monotonic()>=deadline: sys.exit(70)
      time.sleep(0.02)
  try:
    info=os.fstat(value);result=os.read(value,128)
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_gid!=0 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or result!=b'sandboxes.daytona-mailbox/v1 closed=true\\n': sys.exit(70)
  finally: os.close(value)
  os.unlink(closed,dir_fd=directory);os.fsync(directory)
finally:
  if descriptor>=0: os.close(descriptor)
  os.close(directory)`
  return `/usr/bin/python3 -I -c ${shellQuote(source)}`
}

export function daytonaRoleCommandV1(
  command: string,
  role: "root" | "user",
  cwd: "/" | "/workspace" = "/",
): string {
  if (typeof command !== "string" || command.length === 0 ||
    Buffer.byteLength(command, "utf8") > 1024 * 1024 || command.includes("\0")) {
    throw adapterError("validation_failed")
  }
  const commandShell = `/bin/sh -c ${shellQuote(command)}`
  const scopedCommand = cwd === "/workspace"
    ? `cd -- /workspace && exec ${commandShell}`
    : `exec ${commandShell}`
  const shellCommand = `/bin/sh -c ${shellQuote(scopedCommand)}`
  return role === "root"
    ? `/usr/bin/sudo -n -- ${shellCommand}`
    : `/usr/bin/sudo -n -- /usr/sbin/runuser -u nobody -- ${shellCommand}`
}

export interface DaytonaOfficialResourceSdkV1 {
  get(opaqueResourceId: string): Promise<DaytonaSandbox | "absent">
}

function ownData(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined ||
    descriptor.set !== undefined) throw adapterError("integrity_failed")
  return descriptor.value
}

function daytonaMailboxPathV1(
  kind: "request" | "response" | "close" | "closed",
  index: number,
): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 64) {
    throw adapterError("validation_failed")
  }
  return `${DAYTONA_MAILBOX_UPLOAD_ROOT_V1}/${kind}-${index.toString().padStart(6, "0")}`
}

function isDaytonaNotFound(reason: unknown): boolean {
  if (reason === null || typeof reason !== "object") return false
  if (Object.getOwnPropertyDescriptor(reason, "statusCode")?.value === 404) return true
  const response = Object.getOwnPropertyDescriptor(reason, "response")?.value
  return response !== null && typeof response === "object" &&
    Object.getOwnPropertyDescriptor(response, "status")?.value === 404
}

function timeoutSeconds(milliseconds: number): number {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 90_000) {
    throw adapterError("validation_failed")
  }
  return Math.ceil(milliseconds / 1_000)
}

function numericMode(mode: string, permissions: string): number {
  const parse = (value: string): number | undefined => {
    if (/^[0-7]{3,4}$/u.test(value)) return Number.parseInt(value.slice(-3), 8)
    const text = value.length === 10 ? value.slice(1) : value
    if (!/^[rwx-]{9}$/u.test(text)) return undefined
    let result = 0
    for (let index = 0; index < 9; index += 1) {
      if (text[index] !== "-") result |= 1 << (8 - index)
    }
    return result
  }
  const values = [parse(mode), parse(permissions)].filter(
    (value): value is number => value !== undefined,
  )
  if (values.length === 0 || values.some((value) => value !== values[0])) {
    throw adapterError("integrity_failed")
  }
  return values[0]!
}

function normalizedOwner(value: string): "root" | "nobody" {
  if (value === "root" || value === "0") return "root"
  if (value === "nobody" || value === "65534") return "nobody"
  throw adapterError("integrity_failed")
}

function normalizedGroup(value: string): "root" | "nogroup" {
  if (value === "root" || value === "0") return "root"
  if (value === "nogroup" || value === "65534") return "nogroup"
  throw adapterError("integrity_failed")
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
    const identity = await process.executeCommand(
      DAYTONA_EXECUTION_IDENTITY_ATTESTATION_COMMAND_V1,
      "/",
      {},
      20,
    )
    if (identity.exitCode !== 0 || identity.result !== "") {
      throw adapterError("integrity_failed")
    }
    const accountIdentity = await process.executeCommand(
      DAYTONA_ACCOUNT_IDENTITY_COMMAND_V1,
      "/", {}, 20,
    )
    const accountMatch = accountIdentity.exitCode === 0
      ? DAYTONA_ACCOUNT_IDENTITY_RECEIPT_V1.exec(accountIdentity.result)
      : null
    if (accountMatch === null) throw adapterError("integrity_failed")
    const daytonaUid = accountMatch[1]!
    const daytonaGid = accountMatch[2]!

    const run = async (command: string, options: Record<string, unknown>): Promise<unknown> => {
      if (typeof command !== "string" || command.length === 0 || options === null ||
        typeof options !== "object") throw adapterError("validation_failed")
      if (options.background === true) {
        const onStdout = options.onStdout
        const onStderr = options.onStderr
        if (typeof onStdout !== "function" || typeof onStderr !== "function" ||
          options.stdin !== true || options.user !== "root" ||
          (options.cwd !== "/" && options.cwd !== "/workspace") ||
          options.envs === null || typeof options.envs !== "object" ||
          Reflect.ownKeys(options.envs).length !== 0 ||
          command !== e2bGuestBrokerBootstrapCommandV1()) throw adapterError("validation_failed")
        let commandId: string
        try {
          await process.createSession(DAYTONA_MAILBOX_SESSION_ID_V1)
          const started = await process.executeSessionCommand(DAYTONA_MAILBOX_SESSION_ID_V1, {
            command: daytonaRoleCommandV1(
              DAYTONA_BROKER_SUPERVISOR_VERIFIED_FD_COMMAND_V1,
              "root",
            ),
            runAsync: true,
            suppressInputEcho: true,
          }, 20)
          const value = ownData(started, "cmdId")
          if (typeof value !== "string" || value.length === 0 || value.length > 256) {
            throw adapterError("integrity_failed")
          }
          commandId = value
        } catch {
          throw new DaytonaMailboxBoundaryErrorV1("mailbox_session_start")
        }
        try {
          const ready = await process.executeCommand(
            daytonaRoleCommandV1(daytonaMailboxControlCommandV1("ready"), "root"),
            "/", {}, 20,
          )
          if (ready.exitCode !== 0 || ready.result !== "") throw adapterError("integrity_failed")
        } catch {
          throw new DaytonaMailboxBoundaryErrorV1("mailbox_ready")
        }
        const takeMailboxFile = async (
          kind: "response" | "closed",
          index: number,
          maximum: number,
        ): Promise<Uint8Array> => {
          const path = daytonaMailboxPathV1(kind, index)
          const failurePath = `${DAYTONA_MAILBOX_UPLOAD_ROOT_V1}/failure`
          const deadline = Date.now() + 15_000
          let info: Awaited<ReturnType<typeof fs.getFileDetails>> | undefined
          let commandExitedAt: number | undefined
          while (Date.now() < deadline) {
            try {
              info = await fs.getFileDetails(path)
              break
            } catch (reason) {
              if (!isDaytonaNotFound(reason)) throw reason
              try {
                const failedInfo = await fs.getFileDetails(failurePath)
                if (failedInfo.isDir || failedInfo.size < 1 || failedInfo.size > 128 ||
                  numericMode(failedInfo.mode, failedInfo.permissions) !== 0o600 ||
                  failedInfo.owner !== "daytona" || failedInfo.group !== "daytona") {
                  throw adapterError("integrity_failed")
                }
                const failed = await fs.downloadFile(failurePath, 20)
                await fs.deleteFile(failurePath, false)
                const match = /^sandboxes\.daytona-mailbox\/v1 phase=(mailbox_supervisor_(?:start|request|broker|response|close))\n$/u.exec(
                  failed.toString("utf8"),
                )
                failed.fill(0)
                if (match === null) throw adapterError("integrity_failed")
                throw new DaytonaMailboxBoundaryErrorV1(
                  match[1] as "mailbox_supervisor_start" | "mailbox_supervisor_request" |
                    "mailbox_supervisor_broker" | "mailbox_supervisor_response" |
                    "mailbox_supervisor_close",
                )
              } catch (failure) {
                if (failure instanceof DaytonaMailboxBoundaryErrorV1) throw failure
                if (!isDaytonaNotFound(failure)) throw failure
              }
              const current = await process.getSessionCommand(
                DAYTONA_MAILBOX_SESSION_ID_V1,
                commandId,
              )
              if (typeof ownData(current, "exitCode") === "number") {
                commandExitedAt ??= Date.now()
                if (Date.now() - commandExitedAt >= 1_000) {
                  throw new DaytonaMailboxBoundaryErrorV1("mailbox_exchange")
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 20))
            }
          }
          const nameExact = info !== undefined && info.name === path.split("/").at(-1)
          const typeExact = info !== undefined && info.isDir === false
          const sizeExact = info !== undefined && info.size >= 1 && info.size <= maximum
          let modeExact = false
          try { modeExact = info !== undefined && numericMode(info.mode, info.permissions) === 0o600 } catch {}
          const ownerExact = info?.owner === "daytona" || info?.owner === daytonaUid
          const groupExact = info?.group === "daytona" || info?.group === daytonaGid
          if (!nameExact || !typeExact || !sizeExact || !modeExact || !ownerExact || !groupExact) {
            throw new DaytonaMailboxBoundaryErrorV1("mailbox_response_stat")
          }
          let downloaded: Buffer
          try {
            downloaded = await fs.downloadFile(path, 20)
          } catch {
            throw new DaytonaMailboxBoundaryErrorV1("mailbox_response_download")
          }
          if (!Buffer.isBuffer(downloaded) || downloaded.byteLength !== info!.size) {
            downloaded.fill(0)
            throw new DaytonaMailboxBoundaryErrorV1("mailbox_response_download")
          }
          const snapshot = Uint8Array.from(downloaded)
          downloaded.fill(0)
          try {
            await fs.deleteFile(path, false)
          } catch {
            snapshot.fill(0)
            throw new DaytonaMailboxBoundaryErrorV1("mailbox_response_delete")
          }
          try {
            await fs.getFileDetails(path)
            snapshot.fill(0)
            throw new DaytonaMailboxBoundaryErrorV1("mailbox_response_absence")
          } catch (reason) {
            if (reason instanceof DaytonaMailboxBoundaryErrorV1) throw reason
            if (!isDaytonaNotFound(reason)) {
              snapshot.fill(0)
              throw new DaytonaMailboxBoundaryErrorV1("mailbox_response_absence")
            }
          }
          return snapshot
        }
        let mailboxIndex = 0
        let closed = false
        let inFlight = false
        return {
          pid: 1,
          exitCode: undefined,
          error: undefined,
          stdout: "",
          stderr: "",
          async sendStdin(data: string | Uint8Array) {
            if (closed || inFlight || mailboxIndex > 64) throw adapterError("integrity_failed")
            const owned = typeof data === "string"
              ? new TextEncoder().encode(data)
              : data.slice()
            if (owned.byteLength === 0 || owned.byteLength > 1024 * 1024 + 1) {
              owned.fill(0)
              throw adapterError("validation_failed")
            }
            inFlight = true
            const upload = Buffer.from(owned)
            try {
              try {
                await fs.uploadFile(upload, daytonaMailboxPathV1("request", mailboxIndex), 20)
              } catch {
                throw new DaytonaMailboxBoundaryErrorV1("mailbox_upload")
              }
              try {
                const response = await takeMailboxFile("response", mailboxIndex, 1024 * 1024)
                let text: string
                try {
                  text = new TextDecoder("utf-8", { fatal: true }).decode(response)
                } finally {
                  response.fill(0)
                }
                mailboxIndex += 1
                await Reflect.apply(onStdout, undefined, [text])
              } catch (reason) {
                if (reason instanceof DaytonaMailboxBoundaryErrorV1) throw reason
                throw new DaytonaMailboxBoundaryErrorV1("mailbox_exchange")
              }
            } finally {
              upload.fill(0)
              owned.fill(0)
              inFlight = false
            }
          },
          async closeStdin() {
            if (closed || inFlight) throw adapterError("integrity_failed")
            const close = Buffer.from("sandboxes.daytona-mailbox/v1 close=true\n", "ascii")
            try {
              await fs.uploadFile(close, daytonaMailboxPathV1("close", mailboxIndex), 20)
              const result = await takeMailboxFile("closed", mailboxIndex, 64)
              const expected = Buffer.from("sandboxes.daytona-mailbox/v1 closed=true\n", "ascii")
              if (!Buffer.from(result).equals(expected)) throw adapterError("integrity_failed")
              result.fill(0)
              expected.fill(0)
              closed = true
            } catch {
              throw new DaytonaMailboxBoundaryErrorV1("mailbox_close")
            } finally {
              close.fill(0)
            }
          },
          async kill() { await process.deleteSession(DAYTONA_MAILBOX_SESSION_ID_V1); return true },
          async disconnect() {},
          async wait() {
            try {
              const deadline = Date.now() + 20_000
              while (Date.now() < deadline) {
                const current = await process.getSessionCommand(
                  DAYTONA_MAILBOX_SESSION_ID_V1,
                  commandId,
                )
                const exitCode = ownData(current, "exitCode")
                if (typeof exitCode === "number") {
                  return { exitCode, error: undefined, stdout: "", stderr: "" }
                }
                await new Promise((resolve) => setTimeout(resolve, 20))
              }
              throw adapterError("provider_unavailable", { retryable: true })
            } catch {
              throw new DaytonaMailboxBoundaryErrorV1("mailbox_wait")
            }
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
        daytonaRoleCommandV1(command, options.user, options.cwd),
        "/",
        {},
        timeoutSeconds(options.timeoutMs),
      )
      return { exitCode: result.exitCode, stdout: result.result, stderr: "" }
    }

    const surface = {
      files: {
        async write(path: string, data: ArrayBuffer, options: { requestTimeoutMs: number; user: "root" }) {
          if (options.user !== "root" || !(data instanceof ArrayBuffer) ||
            path !== E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1) {
            throw adapterError("validation_failed")
          }
          const timeout = timeoutSeconds(options.requestTimeoutMs)
          await fs.uploadFile(Buffer.from(data), DAYTONA_BROKER_UPLOAD_STAGING_PATH_V1, timeout)
          const installed = await process.executeCommand(daytonaRoleCommandV1(
            `/usr/bin/install -d -o root -g root -m 0755 /opt/hasna/bin && /usr/bin/install -o root -g root -m 0600 ${DAYTONA_BROKER_UPLOAD_STAGING_PATH_V1} ${E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1} && /bin/rm -- ${DAYTONA_BROKER_UPLOAD_STAGING_PATH_V1}`,
            "root",
          ), "/", {}, timeout)
          if (installed.exitCode !== 0 || installed.result !== "") {
            throw adapterError("integrity_failed")
          }
          return { name: path.split("/").at(-1) ?? "", path }
        },
        async read(path: string, options: { format: "bytes"; requestTimeoutMs: number; user: "root" }) {
          if (options.user !== "root" || options.format !== "bytes" ||
            path !== E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1) {
            throw adapterError("validation_failed")
          }
          const readback = await process.executeCommand(daytonaRoleCommandV1(
            `/usr/bin/base64 -w 0 -- ${E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1}`,
            "root",
          ), "/", {}, timeoutSeconds(options.requestTimeoutMs))
          if (readback.exitCode !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(readback.result)) {
            throw adapterError("integrity_failed")
          }
          const bytes = Buffer.from(readback.result, "base64")
          if (bytes.toString("base64") !== readback.result) throw adapterError("integrity_failed")
          return new Uint8Array(bytes)
        },
        async getInfo(path: string, options: { requestTimeoutMs: number; user: "root" }) {
          if (options.user !== "root") throw adapterError("validation_failed")
          timeoutSeconds(options.requestTimeoutMs)
          const info = await fs.getFileDetails(path)
          return {
            name: info.name,
            path,
            type: info.isDir ? "dir" : "file",
            size: info.size,
            mode: numericMode(info.mode, info.permissions),
            permissions: info.permissions,
            owner: normalizedOwner(info.owner),
            group: normalizedGroup(info.group),
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
