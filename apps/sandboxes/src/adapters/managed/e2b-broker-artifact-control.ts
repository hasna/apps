import {
  E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  type E2bGuestBrokerDigestV1,
  verifyE2bGuestBrokerArtifactV1,
} from "./e2b-guest-broker"
import { AdapterContractError, adapterError, type AdapterErrorCodeV1 } from "./errors"

const INTRINSIC_REFLECT_APPLY = Reflect.apply
const INTRINSIC_REFLECT_OWN_KEYS = Reflect.ownKeys

const INSTALL_COMMAND =
  "/bin/chown root:root -- /opt/hasna/bin/sandboxes-broker-v1 && /bin/chmod 0500 -- /opt/hasna/bin/sandboxes-broker-v1"

export const E2B_GUEST_WORKSPACE_ROOT_V1 = "/workspace" as const
export const E2B_GUEST_WORKSPACE_MODE_V1 = 0o700 as const

export interface E2bGuestWorkspaceIdentityV1 {
  readonly uid: number
  readonly gid: number
  readonly dev: number
  readonly ino: number
}

const WORKSPACE_PROVISION_RECEIPT =
  /^sandboxes\.e2b-workspace\/v1 path=\/workspace type=dir uid=([1-9][0-9]*) gid=([1-9][0-9]*) dev=([1-9][0-9]*) ino=([1-9][0-9]*) mode=0700 nofollow=true\n$/

export const E2B_GUEST_WORKSPACE_PROVISION_SOURCE_V1 = `import grp,os,pwd,stat,sys
account=pwd.getpwnam('user')
group=grp.getgrgid(account.pw_gid)
if account.pw_uid==0 or account.pw_name!='user' or group.gr_name!='user':
  sys.exit(70)
root_fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
created=False
try:
  try:
    before=os.stat('workspace',dir_fd=root_fd,follow_symlinks=False)
  except FileNotFoundError:
    try:
      os.mkdir('workspace',0o755,dir_fd=root_fd)
      created=True
    except FileExistsError:
      pass
    before=os.stat('workspace',dir_fd=root_fd,follow_symlinks=False)
  if not stat.S_ISDIR(before.st_mode) or stat.S_ISLNK(before.st_mode):
    sys.exit(70)
  workspace_fd=os.open('workspace',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=root_fd)
  try:
    if created:
      os.fchown(workspace_fd,account.pw_uid,account.pw_gid)
      os.fchmod(workspace_fd,0o700)
    opened=os.fstat(workspace_fd)
    after=os.stat('workspace',dir_fd=root_fd,follow_symlinks=False)
    exact=stat.S_ISDIR(opened.st_mode) and not stat.S_ISLNK(after.st_mode) and opened.st_dev==after.st_dev and opened.st_ino==after.st_ino and opened.st_uid==account.pw_uid and opened.st_gid==account.pw_gid and stat.S_IMODE(opened.st_mode)==0o700
    if not exact:
      sys.exit(70)
    receipt=('sandboxes.e2b-workspace/v1 path=/workspace type=dir uid=%d gid=%d dev=%d ino=%d mode=0700 nofollow=true\\n' % (opened.st_uid,opened.st_gid,opened.st_dev,opened.st_ino)).encode('ascii')
    os.write(1,receipt)
  finally:
    os.close(workspace_fd)
finally:
  os.close(root_fd)`

function shellQuoteFixed(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/** Fixed, reviewed root-only workspace provision command; it contains no caller input. */
export const E2B_GUEST_WORKSPACE_PROVISION_COMMAND_V1 =
  `/usr/bin/python3 -I -c ${shellQuoteFixed(E2B_GUEST_WORKSPACE_PROVISION_SOURCE_V1)}` as const

export const E2B_GUEST_WORKSPACE_WRITE_PROBE_SOURCE_V1 = `import grp,os,pwd,stat,sys
expected_uid=int(sys.argv[1])
expected_gid=int(sys.argv[2])
expected_dev=int(sys.argv[3])
expected_ino=int(sys.argv[4])
account=pwd.getpwnam('user')
group=grp.getgrgid(account.pw_gid)
identity_exact=account.pw_name=='user' and group.gr_name=='user' and expected_uid>0 and expected_gid>0 and expected_dev>0 and expected_ino>0 and account.pw_uid==expected_uid and account.pw_gid==expected_gid and os.geteuid()==expected_uid and os.getegid()==expected_gid
if not identity_exact:
  sys.exit(70)
directory=os.open('/workspace',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
descriptor=-1
try:
  workspace=os.fstat(directory)
  workspace_exact=stat.S_ISDIR(workspace.st_mode) and workspace.st_dev==expected_dev and workspace.st_ino==expected_ino and workspace.st_uid==expected_uid and workspace.st_gid==expected_gid and stat.S_IMODE(workspace.st_mode)==0o700
  if not workspace_exact:
    sys.exit(70)
  descriptor=os.open('.',os.O_WRONLY|os.O_TMPFILE|os.O_CLOEXEC,0o600,dir_fd=directory)
  if os.write(descriptor,b'v1')!=2:
    sys.exit(70)
  os.fsync(descriptor)
  info=os.fstat(descriptor)
  exact=stat.S_ISREG(info.st_mode) and info.st_nlink==0 and info.st_uid==expected_uid and info.st_gid==expected_gid and stat.S_IMODE(info.st_mode)==0o600 and info.st_size==2
  if not exact:
    sys.exit(70)
finally:
  if descriptor>=0:
    os.close(descriptor)
  os.close(directory)
receipt=('sandboxes.e2b-workspace-write/v1 uid=%d gid=%d dev=%d ino=%d unnamed=true\\n' % (expected_uid,expected_gid,expected_dev,expected_ino)).encode('ascii')
os.write(1,receipt)`

function exactSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function exactWorkspaceIdentity(value: E2bGuestWorkspaceIdentityV1): boolean {
  if (value === null || typeof value !== "object" ||
    INTRINSIC_REFLECT_OWN_KEYS(value).length !== 4) return false
  for (const key of ["uid", "gid", "dev", "ino"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined ||
      !exactSafePositiveInteger(descriptor.value)) return false
  }
  return true
}

export function parseE2bGuestWorkspaceProvisionReceiptV1(
  value: string,
): E2bGuestWorkspaceIdentityV1 {
  if (typeof value !== "string" || value.length > 256) {
    throw new TypeError("workspace_receipt_invalid")
  }
  const match = WORKSPACE_PROVISION_RECEIPT.exec(value)
  if (match === null) throw new TypeError("workspace_receipt_invalid")
  const identity = {
    uid: Number(match[1]),
    gid: Number(match[2]),
    dev: Number(match[3]),
    ino: Number(match[4]),
  }
  if (!exactWorkspaceIdentity(identity)) throw new TypeError("workspace_receipt_invalid")
  return Object.freeze(identity)
}

export function e2bGuestWorkspaceWriteProbeCommandV1(
  identity: E2bGuestWorkspaceIdentityV1,
): string {
  if (!exactWorkspaceIdentity(identity)) throw new TypeError("workspace_identity_invalid")
  return `/usr/bin/python3 -I -c ${shellQuoteFixed(E2B_GUEST_WORKSPACE_WRITE_PROBE_SOURCE_V1)} ${identity.uid} ${identity.gid} ${identity.dev} ${identity.ino}`
}

export function e2bGuestWorkspaceWriteProbeReceiptV1(
  identity: E2bGuestWorkspaceIdentityV1,
): string {
  if (!exactWorkspaceIdentity(identity)) throw new TypeError("workspace_identity_invalid")
  return `sandboxes.e2b-workspace-write/v1 uid=${identity.uid} gid=${identity.gid} dev=${identity.dev} ino=${identity.ino} unnamed=true\n`
}

export type E2bWorkspaceBootstrapPhaseV1 =
  | "workspace_provision"
  | "workspace_readback"
  | "workspace_write_probe"
  | "workspace_destroy"

/** Provider text is deliberately discarded; only this bounded phase survives the boundary. */
export class E2bWorkspaceBootstrapBoundaryErrorV1 extends AdapterContractError {
  constructor(
    code: Extract<AdapterErrorCodeV1, "integrity_failed" | "provider_state_unknown">,
    readonly phase: E2bWorkspaceBootstrapPhaseV1,
    quarantineRequired = false,
  ) {
    super(code, { quarantineRequired })
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), phase: this.phase }
  }
}

export interface E2bGuestBrokerArtifactControlPortV1 {
  files: {
    write(
      path: string,
      data: ArrayBuffer,
      options: { requestTimeoutMs: number; user: "root" },
    ): Promise<{ name: string; path: string }>
    read(
      path: string,
      options: { format: "bytes"; requestTimeoutMs: number; user: "root" },
    ): Promise<Uint8Array>
    getInfo(
      path: string,
      options: { requestTimeoutMs: number; user: "root" },
    ): Promise<{
      name: string
      path: string
      type?: string
      size: number
      mode: number
      permissions: string
      owner: string
      group: string
      symlinkTarget?: string
    }>
  }
  commands: {
    run(
      command: string,
      options: {
        background: false
        cwd: "/" | "/workspace"
        envs: Record<string, never>
        requestTimeoutMs: number
        timeoutMs: number
        user: "root" | "user"
      },
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
  destruction: E2bSandboxDestroyAndProveAbsentPortV1
}

export interface E2bSandboxDestroyAndProveAbsentPortV1 {
  destroyAndProveAbsent(): Promise<void>
}

export interface E2bGuestBrokerArtifactAttestationV1 {
  path: typeof E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1
  artifact_sha256: E2bGuestBrokerDigestV1
  byte_length: number
  mode: 0o500
  owner: "root"
  group: "root"
}

function exactPositiveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
    throw adapterError("validation_failed")
  }
  return value
}

function snapshotReviewedArtifact(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) ||
    (typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer)) {
    throw adapterError("validation_failed")
  }
  const snapshot = value.slice()
  if (!verifyE2bGuestBrokerArtifactV1(snapshot)) throw adapterError("integrity_failed")
  return snapshot
}

function exactWriteInfo(value: { name: string; path: string }): boolean {
  return value !== null && typeof value === "object" &&
    value.path === E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1 &&
    value.name === "sandboxes-broker-v1"
}

function exactEntryInfo(
  value: Awaited<ReturnType<E2bGuestBrokerArtifactControlPortV1["files"]["getInfo"]>>,
  byteLength: number,
): boolean {
  return value !== null && typeof value === "object" &&
    value.path === E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1 &&
    value.name === "sandboxes-broker-v1" &&
    value.type === "file" &&
    value.symlinkTarget === undefined &&
    value.size === byteLength &&
    value.mode === 0o500 &&
    value.owner === "root" &&
    value.group === "root"
}

function exactWorkspaceInfo(
  value: Awaited<ReturnType<E2bGuestBrokerArtifactControlPortV1["files"]["getInfo"]>>,
): boolean {
  return value !== null && typeof value === "object" &&
    value.path === E2B_GUEST_WORKSPACE_ROOT_V1 &&
    value.name === "workspace" &&
    value.type === "dir" &&
    value.symlinkTarget === undefined
}

async function killAfterAmbiguity(
  destroyAndProveAbsent: () => Promise<void>,
): Promise<never> {
  try {
    await destroyAndProveAbsent()
  } catch {
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }
  throw adapterError("integrity_failed")
}

/**
 * Installs the byte-for-byte reviewed broker through the provider control plane.
 * This helper is intentionally unsuitable for task files or checkpoint evidence.
 */
export async function installExactE2bGuestBrokerArtifactV1(
  control: E2bGuestBrokerArtifactControlPortV1,
  artifactValue: Uint8Array,
  requestTimeoutValue: number,
): Promise<E2bGuestBrokerArtifactAttestationV1> {
  let destructionTarget: E2bSandboxDestroyAndProveAbsentPortV1
  let destructionDescriptor: PropertyDescriptor
  try {
    destructionTarget = control.destruction
    const candidate = destructionTarget === null || typeof destructionTarget !== "object"
      ? undefined
      : Object.getOwnPropertyDescriptor(destructionTarget, "destroyAndProveAbsent")
    if (candidate === undefined || candidate.get !== undefined || candidate.set !== undefined ||
      typeof candidate.value !== "function" || INTRINSIC_REFLECT_OWN_KEYS(destructionTarget).length !== 1) {
      throw adapterError("provider_state_unknown")
    }
    destructionDescriptor = candidate
  } catch {
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }
  const destructionCallable = destructionDescriptor.value as () => Promise<void>
  const destroyAndProveAbsent = (): Promise<void> => INTRINSIC_REFLECT_APPLY(
    destructionCallable,
    destructionTarget,
    [],
  ) as Promise<void>
  let destroyPromise: Promise<void> | undefined
  const destroyOnceAndProveAbsent = (): Promise<void> => {
    destroyPromise ??= (async () => {
      await destroyAndProveAbsent()
    })()
    return destroyPromise
  }
  let requestTimeoutMs: number
  try {
    requestTimeoutMs = exactPositiveTimeout(requestTimeoutValue)
  } catch {
    try {
      await destroyOnceAndProveAbsent()
    } catch {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    throw adapterError("validation_failed")
  }
  let artifact: Uint8Array | undefined
  try {
    artifact = snapshotReviewedArtifact(artifactValue)
  } catch {
    return await killAfterAmbiguity(destroyOnceAndProveAbsent)
  }
  let workspacePhase: Exclude<E2bWorkspaceBootstrapPhaseV1, "workspace_destroy"> =
    "workspace_provision"
  try {
    const provisioned = await control.commands.run(E2B_GUEST_WORKSPACE_PROVISION_COMMAND_V1, {
      background: false,
      cwd: "/",
      envs: {},
      requestTimeoutMs,
      timeoutMs: requestTimeoutMs,
      user: "root",
    })
    if ("wait" in provisioned || provisioned.exitCode !== 0 || provisioned.stderr !== "") {
      throw new E2bWorkspaceBootstrapBoundaryErrorV1("integrity_failed", workspacePhase)
    }
    const workspaceIdentity = parseE2bGuestWorkspaceProvisionReceiptV1(provisioned.stdout)
    workspacePhase = "workspace_readback"
    const workspaceInfo = await control.files.getInfo(E2B_GUEST_WORKSPACE_ROOT_V1, {
      requestTimeoutMs,
      user: "root",
    })
    if (!exactWorkspaceInfo(workspaceInfo)) {
      throw new E2bWorkspaceBootstrapBoundaryErrorV1("integrity_failed", workspacePhase)
    }
    workspacePhase = "workspace_write_probe"
    const writeProbeCommand = e2bGuestWorkspaceWriteProbeCommandV1(workspaceIdentity)
    const writeProbeReceipt = e2bGuestWorkspaceWriteProbeReceiptV1(workspaceIdentity)
    const writeProbe = await control.commands.run(writeProbeCommand, {
      background: false,
      cwd: "/workspace",
      envs: {},
      requestTimeoutMs,
      timeoutMs: requestTimeoutMs,
      user: "user",
    })
    if ("wait" in writeProbe || writeProbe.exitCode !== 0 ||
      writeProbe.stdout !== writeProbeReceipt ||
      writeProbe.stderr !== "") {
      throw new E2bWorkspaceBootstrapBoundaryErrorV1("integrity_failed", workspacePhase)
    }
  } catch {
    try {
      await destroyOnceAndProveAbsent()
    } catch {
      artifact.fill(0)
      throw new E2bWorkspaceBootstrapBoundaryErrorV1(
        "provider_state_unknown",
        "workspace_destroy",
        true,
      )
    }
    artifact.fill(0)
    throw new E2bWorkspaceBootstrapBoundaryErrorV1("integrity_failed", workspacePhase)
  }
  try {
    const body = new Uint8Array(artifact.byteLength)
    body.set(artifact)
    const written = await control.files.write(
      E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
      body.buffer,
      { requestTimeoutMs, user: "root" },
    )
    if (!exactWriteInfo(written)) throw adapterError("integrity_failed")

    const command = await control.commands.run(INSTALL_COMMAND, {
      background: false,
      cwd: "/",
      envs: {},
      requestTimeoutMs,
      timeoutMs: requestTimeoutMs,
      user: "root",
    })
    if ("wait" in command || command.exitCode !== 0 || command.stdout !== "" || command.stderr !== "") {
      throw adapterError("integrity_failed")
    }

    const readback = await control.files.read(E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1, {
      format: "bytes",
      requestTimeoutMs,
      user: "root",
    })
    if (!(readback instanceof Uint8Array) ||
      (typeof SharedArrayBuffer !== "undefined" && readback.buffer instanceof SharedArrayBuffer) ||
      readback.byteLength !== artifact.byteLength ||
      !verifyE2bGuestBrokerArtifactV1(readback)) {
      throw adapterError("integrity_failed")
    }

    const info = await control.files.getInfo(E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1, {
      requestTimeoutMs,
      user: "root",
    })
    if (!exactEntryInfo(info, artifact.byteLength)) throw adapterError("integrity_failed")

    return Object.freeze({
      path: E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
      artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
      byte_length: artifact.byteLength,
      mode: 0o500,
      owner: "root",
      group: "root",
    })
  } catch {
    return await killAfterAmbiguity(destroyOnceAndProveAbsent)
  } finally {
    artifact?.fill(0)
  }
}
