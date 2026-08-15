import { canonicalJson, canonicalSha256, isDigest, parseCanonicalJson } from "./canonical"
import { adapterError } from "./errors"
import { managedProviderRequestSha256 } from "./request"
import type {
  Digest,
  AdapterGuestBrokerAuthenticatorPortV1,
  GuestBrokerAttestationV1,
  GuestBrokerRequestFrameV1,
  GuestBrokerRequestV1,
  ManagedGuestBrokerBootstrapCommandV1,
  ProviderOperationV1,
} from "./types"

export const MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND: ManagedGuestBrokerBootstrapCommandV1 =
  "/opt/hasna/bin/sandboxes-broker-v1 --stdio"

export const MANAGED_GUEST_BROKER_PROTOCOL_SHA256: Digest = canonicalSha256({
  schema_version: "sandboxes.guest-broker/v1",
  bootstrap_command_sha256: canonicalSha256(MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND),
  request_frame_schema: "sandboxes.guest-broker-frame/v1",
  encoding: "canonical-tagged-json-utf8/v1",
  shell_interpolation: false,
})

export const MANAGED_GUEST_BROKER_MAX_FRAME_BYTES = 16 * 1024 * 1024
const WIRE_LENGTH_BYTES = 4

function frameBasis(
  frame: Omit<GuestBrokerRequestFrameV1, "frame_sha256" | "authentication_tag_sha256">,
): object {
  return {
    schema_version: frame.schema_version,
    operation: frame.operation,
    immutable_fingerprint_sha256: frame.immutable_fingerprint_sha256,
    target_sha256: frame.target_sha256,
    fence_sha256: frame.fence_sha256,
    request_sha256: frame.request_sha256,
    provider_idempotency_token_sha256: frame.provider_idempotency_token_sha256,
    operation_execution_epoch: frame.operation_execution_epoch,
    protocol_sha256: frame.protocol_sha256,
    provider_session_binding_sha256: frame.provider_session_binding_sha256,
    frame_nonce_sha256: frame.frame_nonce_sha256,
    payload_sha256: frame.payload_sha256,
  }
}

export function encodeGuestBrokerRequestFrame(
  request: GuestBrokerRequestV1,
  operation: ProviderOperationV1,
  broker: GuestBrokerAttestationV1,
  authenticator: AdapterGuestBrokerAuthenticatorPortV1,
): GuestBrokerRequestFrameV1 {
  validateGuestBrokerAttestation(broker, operation.target.immutable_fingerprint_sha256)
  const requestBinding = (() => {
    if (request.operation === "exec_cancel") {
      return {
        operation: "exec_cancel" as const,
        exec_fingerprint_sha256: request.exec.immutable_exec_fingerprint_sha256,
      }
    }
    return request
  })()
  if (
    request.operation !== operation.operation ||
    operation.request_sha256 !== managedProviderRequestSha256(requestBinding)
  ) {
    throw adapterError("request_digest_mismatch")
  }
  const payloadBytes = new TextEncoder().encode(canonicalJson(request))
  if (
    payloadBytes.byteLength === 0 ||
    payloadBytes.byteLength > MANAGED_GUEST_BROKER_MAX_FRAME_BYTES
  ) {
    throw adapterError("validation_failed")
  }
  const withoutFrameDigest = {
    schema_version: "sandboxes.guest-broker-frame/v1" as const,
    operation: request.operation,
    immutable_fingerprint_sha256: operation.target.immutable_fingerprint_sha256,
    target_sha256: canonicalSha256(operation.target),
    fence_sha256: canonicalSha256(operation.fence),
    request_sha256: operation.request_sha256,
    provider_idempotency_token_sha256: operation.target.provider_idempotency_token_sha256,
    operation_execution_epoch: operation.fence.operation_execution_epoch,
    protocol_sha256: MANAGED_GUEST_BROKER_PROTOCOL_SHA256,
    provider_session_binding_sha256: broker.provider_session_binding_sha256,
    frame_nonce_sha256: canonicalSha256({
      target_sha256: canonicalSha256(operation.target),
      request_sha256: operation.request_sha256,
      operation_execution_epoch: operation.fence.operation_execution_epoch,
      provider_session_binding_sha256: broker.provider_session_binding_sha256,
      payload_sha256: canonicalSha256(payloadBytes),
    }),
    payload_sha256: canonicalSha256(payloadBytes),
    payload_bytes: payloadBytes,
  }
  const frameSha256 = canonicalSha256(frameBasis(withoutFrameDigest))
  return {
    ...withoutFrameDigest,
    frame_sha256: frameSha256,
    authentication_tag_sha256: authenticator.authenticate({
      frame_sha256: frameSha256,
      protocol_sha256: withoutFrameDigest.protocol_sha256,
      provider_session_binding_sha256: withoutFrameDigest.provider_session_binding_sha256,
      frame_nonce_sha256: withoutFrameDigest.frame_nonce_sha256,
    }),
  }
}

export function decodeGuestBrokerRequestFrame(frame: GuestBrokerRequestFrameV1): GuestBrokerRequestV1 {
  if (
    frame.schema_version !== "sandboxes.guest-broker-frame/v1" ||
    !isDigest(frame.immutable_fingerprint_sha256) ||
    !isDigest(frame.target_sha256) ||
    !isDigest(frame.fence_sha256) ||
    !isDigest(frame.request_sha256) ||
    !isDigest(frame.provider_idempotency_token_sha256) ||
    frame.protocol_sha256 !== MANAGED_GUEST_BROKER_PROTOCOL_SHA256 ||
    !isDigest(frame.provider_session_binding_sha256) ||
    !isDigest(frame.frame_nonce_sha256) ||
    frame.frame_nonce_sha256 !== canonicalSha256({
      target_sha256: frame.target_sha256,
      request_sha256: frame.request_sha256,
      operation_execution_epoch: frame.operation_execution_epoch,
      provider_session_binding_sha256: frame.provider_session_binding_sha256,
      payload_sha256: frame.payload_sha256,
    }) ||
    !isDigest(frame.payload_sha256) ||
    !isDigest(frame.frame_sha256) ||
    !isDigest(frame.authentication_tag_sha256) ||
    frame.payload_bytes.byteLength === 0 ||
    frame.payload_bytes.byteLength > MANAGED_GUEST_BROKER_MAX_FRAME_BYTES ||
    frame.payload_sha256 !== canonicalSha256(frame.payload_bytes) ||
    frame.frame_sha256 !== canonicalSha256(frameBasis(frame))
  ) {
    throw adapterError("integrity_failed")
  }
  let request: unknown
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(frame.payload_bytes)
    request = parseCanonicalJson(text)
  } catch {
    throw adapterError("integrity_failed")
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw adapterError("integrity_failed")
  }
  if ((request as Record<string, unknown>).operation !== frame.operation) {
    throw adapterError("integrity_failed")
  }
  return request as unknown as GuestBrokerRequestV1
}

export function serializeGuestBrokerRequestFrame(frame: GuestBrokerRequestFrameV1): Uint8Array {
  // Decode first so a corrupted or non-canonical frame can never reach an SDK transport.
  decodeGuestBrokerRequestFrame(frame)
  const envelope = new TextEncoder().encode(canonicalJson(frame))
  if (envelope.byteLength > MANAGED_GUEST_BROKER_MAX_FRAME_BYTES) {
    throw adapterError("validation_failed")
  }
  const wire = new Uint8Array(WIRE_LENGTH_BYTES + envelope.byteLength)
  new DataView(wire.buffer).setUint32(0, envelope.byteLength, false)
  wire.set(envelope, WIRE_LENGTH_BYTES)
  return wire
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
