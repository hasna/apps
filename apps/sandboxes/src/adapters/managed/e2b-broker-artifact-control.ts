import {
  E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  type E2bGuestBrokerDigestV1,
  verifyE2bGuestBrokerArtifactV1,
} from "./e2b-guest-broker"
import { adapterError } from "./errors"

const INTRINSIC_REFLECT_APPLY = Reflect.apply
const INTRINSIC_REFLECT_OWN_KEYS = Reflect.ownKeys

const INSTALL_COMMAND =
  "/bin/chown root:root -- /opt/hasna/bin/sandboxes-broker-v1 && /bin/chmod 0500 -- /opt/hasna/bin/sandboxes-broker-v1"

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
        cwd: "/"
        envs: Record<string, never>
        requestTimeoutMs: number
        timeoutMs: number
        user: "root"
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
  const requestTimeoutMs = exactPositiveTimeout(requestTimeoutValue)
  const destructionDescriptor = control.destruction === null ||
      typeof control.destruction !== "object"
    ? undefined
    : Object.getOwnPropertyDescriptor(control.destruction, "destroyAndProveAbsent")
  if (destructionDescriptor === undefined || destructionDescriptor.get !== undefined ||
    destructionDescriptor.set !== undefined || typeof destructionDescriptor.value !== "function" ||
    INTRINSIC_REFLECT_OWN_KEYS(control.destruction).length !== 1) {
    throw adapterError("validation_failed")
  }
  const destructionTarget = control.destruction
  const destructionCallable = destructionDescriptor.value as () => Promise<void>
  const destroyAndProveAbsent = (): Promise<void> => INTRINSIC_REFLECT_APPLY(
    destructionCallable,
    destructionTarget,
    [],
  ) as Promise<void>
  let artifact: Uint8Array | undefined
  try {
    artifact = snapshotReviewedArtifact(artifactValue)
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
    return await killAfterAmbiguity(destroyAndProveAbsent)
  } finally {
    artifact?.fill(0)
  }
}
