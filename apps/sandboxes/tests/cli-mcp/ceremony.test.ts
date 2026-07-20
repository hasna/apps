import { describe, expect, test } from "bun:test"
import { buildBrokerFrame, LocalGuestBrokerAuthenticator, sha256Digest } from "../../src/runtime/ceremony"
import { decodeGuestBrokerRequestFrame } from "../../src/adapters/managed/index"
import type { GuestBrokerRequestV1, WorkspacePath } from "../../src/adapters/managed/index"

const binding = {
  resourceId: "sbx_local_ceremony",
  immutableFingerprintSha256: sha256Digest("fingerprint"),
  creationTokenSha256: sha256Digest("creation"),
  sessionBindingSha256: sha256Digest("session"),
  epoch: 3n,
}
const authenticator = new LocalGuestBrokerAuthenticator("test-key")
const request: GuestBrokerRequestV1 = {
  operation: "file_write",
  request: { path: "/workspace/x.txt" as WorkspacePath, bytes: new TextEncoder().encode("hello") },
}

describe("guest-broker framing is load-bearing", () => {
  test("a valid frame decodes back to the same typed request (byte-exact)", () => {
    const frame = buildBrokerFrame(binding, request, authenticator)
    const decoded = decodeGuestBrokerRequestFrame(frame)
    expect(decoded.operation).toBe("file_write")
    if (decoded.operation !== "file_write") throw new Error("unreachable")
    expect(new TextDecoder().decode(decoded.request.bytes)).toBe("hello")
    expect(String(decoded.request.path)).toBe("/workspace/x.txt")
  })

  test("mutating the payload bytes is rejected (integrity_failed)", () => {
    const frame = buildBrokerFrame(binding, request, authenticator)
    const tampered = { ...frame, payload_bytes: new Uint8Array([...frame.payload_bytes]) }
    tampered.payload_bytes[0] = (tampered.payload_bytes[0] ?? 0) ^ 0xff
    expect(() => decodeGuestBrokerRequestFrame(tampered)).toThrow()
  })

  test("mutating the protocol id is rejected", () => {
    const frame = buildBrokerFrame(binding, request, authenticator)
    const tampered = { ...frame, protocol_sha256: sha256Digest("not-the-protocol") }
    expect(() => decodeGuestBrokerRequestFrame(tampered)).toThrow()
  })

  test("mutating the frame digest is rejected", () => {
    const frame = buildBrokerFrame(binding, request, authenticator)
    const tampered = { ...frame, frame_sha256: sha256Digest("forged-frame") }
    expect(() => decodeGuestBrokerRequestFrame(tampered)).toThrow()
  })
})
