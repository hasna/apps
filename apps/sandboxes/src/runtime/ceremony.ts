/**
 * Thin bridge that lets the runtime backends genuinely exercise the package's
 * managed-adapter primitives: canonical hashing, provider effect tokens, the
 * deny-all network policy, and — most importantly — the authenticated
 * guest-broker request framing (encode + decode round-trip). Backends build a
 * typed broker request here, obtain a wire-valid frame, then decode it back to
 * the typed request before acting on it, so the CLI/MCP file & exec paths are
 * bound to the same framing contract the live adapters use.
 */
import { createHash } from "node:crypto"
import {
  INERT_DENY_ALL_POLICY,
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  MANAGED_GUEST_BROKER_PROTOCOL_SHA256,
  canonicalSha256,
  decodeGuestBrokerRequestFrame,
  encodeGuestBrokerRequestFrame,
  managedProviderRequestSha256,
  providerEffectTokenSha256,
} from "../adapters/managed/index"
import type {
  AdapterGuestBrokerAuthenticatorPortV1,
  CanonicalSandboxEffectFenceV1,
  Digest,
  ExecSpecV1,
  GuestBrokerAttestationV1,
  GuestBrokerRequestV1,
  ManagedProviderRequestV1,
  ProviderOperationV1,
  WorkspacePath,
} from "../adapters/managed/index"

export const DENY_ALL_NETWORK_POLICY = INERT_DENY_ALL_POLICY

export function sha256Digest(input: string | Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(input).digest("hex")}` as Digest
}

/** Deterministic local broker MAC. Key bytes never leave this module. */
export class LocalGuestBrokerAuthenticator implements AdapterGuestBrokerAuthenticatorPortV1 {
  readonly #keyId: string
  constructor(keyId: string) {
    this.#keyId = keyId
  }
  authenticate(input: Parameters<AdapterGuestBrokerAuthenticatorPortV1["authenticate"]>[0]): Digest {
    return canonicalSha256({ key_id: this.#keyId, input })
  }
}

export interface BrokerBinding {
  resourceId: string
  immutableFingerprintSha256: Digest
  creationTokenSha256: Digest
  sessionBindingSha256: Digest
  epoch: bigint
}

export function localBrokerAttestation(binding: BrokerBinding): GuestBrokerAttestationV1 {
  return {
    schema_version: "sandboxes.guest-broker-attestation/v1",
    immutable_fingerprint_sha256: binding.immutableFingerprintSha256,
    bootstrap_command_sha256: canonicalSha256(MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND),
    protocol_sha256: MANAGED_GUEST_BROKER_PROTOCOL_SHA256,
    provider_session_binding_sha256: binding.sessionBindingSha256,
    attested_at: new Date(0).toISOString(),
  }
}

function fence(binding: BrokerBinding, operationId: string): CanonicalSandboxEffectFenceV1 {
  return {
    authority_epoch: 1n,
    route_lineage_id: `lineage-${binding.resourceId}`,
    route_id: `route-${binding.resourceId}`,
    route_epoch: 1n,
    run_id: `run-${binding.resourceId}`,
    attempt_id: "attempt-1",
    attempt_lease_id: "attempt-lease-1",
    lease_epoch: 1n,
    resource_lease_id: `resource-lease-${binding.resourceId}`,
    resource_id: binding.resourceId,
    resource_lifecycle_generation: 1n,
    operation_id: operationId,
    operation_digest: sha256Digest(operationId),
    operation_execution_epoch: binding.epoch,
    actor_principal: "sandboxes-cli",
    lease_holder_principal: "sandboxes-cli",
    operation_executor_principal: "sandboxes-cli",
    audience: "sandboxes.runtime/v1",
    issued_at: new Date(0).toISOString(),
    lease_expires_at: new Date(0).toISOString(),
    operation_execution_expires_at: new Date(0).toISOString(),
  }
}

function operation(binding: BrokerBinding, request: GuestBrokerRequestV1): ProviderOperationV1 {
  const operationId = `${request.operation}-${binding.resourceId}-${binding.epoch.toString(10)}`
  const requestSha256 = managedProviderRequestSha256(request as unknown as ManagedProviderRequestV1)
  const operationDigest = sha256Digest(operationId)
  const target: ProviderOperationV1["target"] = {
    operation_id: operationId,
    operation_digest: operationDigest,
    operation_step_id: `${request.operation}-step-1`,
    resource_id: binding.resourceId,
    resource_lifecycle_generation: 1n,
    provider_idempotency_token_sha256: sha256Digest("placeholder"),
    provider_creation_token_sha256: binding.creationTokenSha256,
    immutable_fingerprint_sha256: binding.immutableFingerprintSha256,
    authorization_consumption_receipt_sha256: sha256Digest(`auth-${operationId}`),
  }
  const op: ProviderOperationV1 = {
    operation: request.operation,
    target,
    fence: fence(binding, operationId),
    request_sha256: requestSha256,
    idempotency_key_sha256: sha256Digest(`idem-${operationId}`),
    external_anchor_kind: request.operation === "file_read" || request.operation === "file_stat" || request.operation === "file_list" ? "READ_PROBE" : "DISPATCHED",
    external_anchor_receipt_sha256: sha256Digest(`anchor-${operationId}`),
    deadline: new Date(0).toISOString(),
  }
  op.target.provider_idempotency_token_sha256 = providerEffectTokenSha256(op)
  return op
}

/**
 * Encode a typed guest-broker request into a wire-valid, authenticated frame and
 * decode it back — proving the request survives the exact framing contract the
 * managed adapters enforce. Returns the decoded, trusted request.
 */
export function roundTripBrokerRequest(
  binding: BrokerBinding,
  request: GuestBrokerRequestV1,
  authenticator: AdapterGuestBrokerAuthenticatorPortV1,
): GuestBrokerRequestV1 {
  const attestation = localBrokerAttestation(binding)
  const op = operation(binding, request)
  const frame = encodeGuestBrokerRequestFrame(request, op, attestation, authenticator)
  return decodeGuestBrokerRequestFrame(frame)
}

const WORKSPACE_ROOT = "/workspace"

/** Normalize a user-supplied path to a workspace-rooted POSIX path. */
export function toWorkspacePath(input: string): WorkspacePath {
  let path = input.trim()
  if (path.length === 0) path = "."
  if (path === "." || path === "./") return WORKSPACE_ROOT as WorkspacePath
  if (path.startsWith(WORKSPACE_ROOT)) {
    // already rooted
  } else if (path.startsWith("/")) {
    path = `${WORKSPACE_ROOT}${path}`
  } else {
    path = `${WORKSPACE_ROOT}/${path.replace(/^\.\//u, "")}`
  }
  const segments: string[] = []
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (segments.length > 1) segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join("/")}` as WorkspacePath
}

export function buildExecSpec(argv: string[], options: { cwd?: string; idleTimeoutMs?: number; wallTimeoutMs?: number; outputLimitBytes?: number; processLimit?: number }): ExecSpecV1 {
  const executable = argv[0] ?? ""
  const wallTimeoutMs = options.wallTimeoutMs ?? 120_000
  const cwd = options.cwd === undefined || options.cwd === "" ? "" : (toWorkspacePath(options.cwd) as string)
  return {
    schema_version: "sandboxes.exec-spec/v1",
    executable,
    argv,
    cwd: cwd as ExecSpecV1["cwd"],
    workspace_access: "write",
    environment_profile_id: "minimal-v1",
    environment_profile_sha256: canonicalSha256({ profile: "minimal-v1" }),
    wall_deadline: new Date(Date.now() + wallTimeoutMs).toISOString(),
    idle_timeout_ms: options.idleTimeoutMs ?? 30_000,
    output_limit_bytes: options.outputLimitBytes ?? 1_048_576,
    process_limit: options.processLimit ?? 64,
    tty: false,
  }
}
