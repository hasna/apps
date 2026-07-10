import { canonicalJson, canonicalSha256, isDigest } from "./canonical"
import { adapterError } from "./errors"
import type {
  Digest,
  GuestBrokerAttestationV1,
  GuestBrokerRequestFrameV1,
  GuestBrokerRequestV1,
  ManagedGuestBrokerBootstrapCommandV1,
} from "./types"

export const MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND: ManagedGuestBrokerBootstrapCommandV1 =
  "/opt/hasna/bin/sandboxes-broker-v1 --stdio"

export const MANAGED_GUEST_BROKER_PROTOCOL_SHA256: Digest = canonicalSha256({
  schema_version: "sandboxes.guest-broker/v1",
  bootstrap_command_sha256: canonicalSha256(MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND),
  request_frame_schema: "sandboxes.guest-broker-frame/v1",
  encoding: "canonical-json-utf8",
  shell_interpolation: false,
})

const MAX_BROKER_FRAME_BYTES = 16 * 1024 * 1024

function frameBasis(frame: Omit<GuestBrokerRequestFrameV1, "frame_sha256">): object {
  return {
    schema_version: frame.schema_version,
    operation: frame.operation,
    immutable_fingerprint_sha256: frame.immutable_fingerprint_sha256,
    payload_sha256: frame.payload_sha256,
  }
}

export function encodeGuestBrokerRequestFrame(
  request: GuestBrokerRequestV1,
  immutableFingerprintSha256: Digest,
): GuestBrokerRequestFrameV1 {
  if (!isDigest(immutableFingerprintSha256)) throw adapterError("validation_failed")
  const payloadBytes = new TextEncoder().encode(canonicalJson(request))
  if (payloadBytes.byteLength === 0 || payloadBytes.byteLength > MAX_BROKER_FRAME_BYTES) {
    throw adapterError("validation_failed")
  }
  const withoutFrameDigest = {
    schema_version: "sandboxes.guest-broker-frame/v1" as const,
    operation: request.operation,
    immutable_fingerprint_sha256: immutableFingerprintSha256,
    payload_sha256: canonicalSha256(payloadBytes),
    payload_bytes: payloadBytes,
  }
  return {
    ...withoutFrameDigest,
    frame_sha256: canonicalSha256(frameBasis(withoutFrameDigest)),
  }
}

function reviveCanonicalBytes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveCanonicalBytes)
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 1 && entries[0]?.[0] === "$bytes_hex") {
      const hex = entries[0][1]
      if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(hex)) {
        throw adapterError("integrity_failed")
      }
      return Uint8Array.from(Buffer.from(hex, "hex"))
    }
    return Object.fromEntries(entries.map(([key, item]) => [key, reviveCanonicalBytes(item)]))
  }
  return value
}

export function decodeGuestBrokerRequestFrame(frame: GuestBrokerRequestFrameV1): GuestBrokerRequestV1 {
  if (
    frame.schema_version !== "sandboxes.guest-broker-frame/v1" ||
    !isDigest(frame.immutable_fingerprint_sha256) ||
    !isDigest(frame.payload_sha256) ||
    !isDigest(frame.frame_sha256) ||
    frame.payload_bytes.byteLength === 0 ||
    frame.payload_bytes.byteLength > MAX_BROKER_FRAME_BYTES ||
    frame.payload_sha256 !== canonicalSha256(frame.payload_bytes) ||
    frame.frame_sha256 !== canonicalSha256(frameBasis(frame))
  ) {
    throw adapterError("integrity_failed")
  }
  let normalized: unknown
  try {
    normalized = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame.payload_bytes))
  } catch {
    throw adapterError("integrity_failed")
  }
  if (canonicalJson(normalized) !== new TextDecoder().decode(frame.payload_bytes)) {
    throw adapterError("integrity_failed")
  }
  const request = reviveCanonicalBytes(normalized) as Record<string, unknown>
  if (request.operation !== frame.operation) throw adapterError("integrity_failed")
  if (request.operation === "file_write") {
    const write = (request as { request?: Record<string, unknown> }).request
    if (write !== undefined && typeof write.expected_prior_revision === "string") {
      if (!/^(0|[1-9][0-9]*)$/u.test(write.expected_prior_revision)) throw adapterError("integrity_failed")
      write.expected_prior_revision = BigInt(write.expected_prior_revision)
    }
  }
  return request as unknown as GuestBrokerRequestV1
}

export function validateGuestBrokerAttestation(
  attestation: GuestBrokerAttestationV1,
  immutableFingerprintSha256: Digest,
): void {
  if (
    attestation.schema_version !== "sandboxes.guest-broker-attestation/v1" ||
    attestation.immutable_fingerprint_sha256 !== immutableFingerprintSha256 ||
    attestation.bootstrap_command_sha256 !== canonicalSha256(MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND) ||
    attestation.protocol_sha256 !== MANAGED_GUEST_BROKER_PROTOCOL_SHA256 ||
    !isDigest(attestation.provider_session_binding_sha256) ||
    Number.isNaN(Date.parse(attestation.attested_at))
  ) {
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }
}
