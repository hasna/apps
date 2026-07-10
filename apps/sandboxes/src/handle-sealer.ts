import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  assertDigest,
  assertOpaqueId,
  canonicalJson,
  sha256,
  storageJson,
  parseStorageJson,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import {
  providerHandleBinding,
  providerHandleBindingDigest,
  providerHandleIdentityDigest,
} from "./provider-identity.js";
import {
  SCHEMA_VERSION,
  type OwnedProviderHandleV1,
  type ProviderHandleBindingV1,
  type SealedProviderHandleV1,
} from "./types.js";

export interface ProviderHandleSealerV1 {
  seal(handle: OwnedProviderHandleV1): SealedProviderHandleV1;
  open(
    sealed: SealedProviderHandleV1,
    expectedBinding: ProviderHandleBindingV1,
  ): OwnedProviderHandleV1;
}

const PROVIDER_HANDLE_AEAD_DOMAIN = "sandboxes.resource-provider-handle/v1" as const;

function providerHandleAad(binding: ProviderHandleBindingV1): Buffer {
  return Buffer.from(`${PROVIDER_HANDLE_AEAD_DOMAIN}\0${canonicalJson(binding)}`, "utf8");
}

export class AesGcmProviderHandleSealerV1 implements ProviderHandleSealerV1 {
  readonly #key: Buffer;

  constructor(key: Uint8Array) {
    if (key.byteLength !== 32) {
      throw new SandboxError("validation_failed", "Provider handle sealing key must be 32 bytes");
    }
    this.#key = Buffer.from(key);
  }

  seal(handle: OwnedProviderHandleV1): SealedProviderHandleV1 {
    assertOpaqueId(handle.resource_id, "handle.resource_id", "sbx");
    if (handle.provider_identity_sha256 !== providerHandleIdentityDigest(handle)) {
      throw new SandboxError("integrity_failed", "Provider handle identity digest mismatch");
    }
    const binding = providerHandleBinding(handle);
    const bindingSha256 = providerHandleBindingDigest(binding);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(providerHandleAad(binding));
    const encrypted = Buffer.concat([cipher.update(storageJson(handle), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const packed = Buffer.concat([Buffer.from([2]), iv, tag, encrypted]).toString("base64url");
    return {
      schema_version: "sandboxes.sealed-provider-handle/v1",
      resource_id: handle.resource_id,
      sealed_handle: packed,
      provider_handle_sha256: sha256(packed),
      binding_sha256: bindingSha256,
    };
  }

  open(
    sealed: SealedProviderHandleV1,
    expectedBinding: ProviderHandleBindingV1,
  ): OwnedProviderHandleV1 {
    assertOpaqueId(sealed.resource_id, "sealed_handle.resource_id", "sbx");
    assertDigest(sealed.provider_handle_sha256, "sealed_handle.provider_handle_sha256");
    assertDigest(sealed.binding_sha256, "sealed_handle.binding_sha256");
    if (sealed.schema_version !== "sandboxes.sealed-provider-handle/v1") {
      throw new SandboxError("protocol_incompatible", "Provider handle envelope schema mismatch");
    }
    const expectedBindingSha256 = providerHandleBindingDigest(expectedBinding);
    if (
      expectedBinding.resource_id !== sealed.resource_id ||
      sealed.binding_sha256 !== expectedBindingSha256
    ) {
      throw new SandboxError("integrity_failed", "Provider handle binding mismatch");
    }
    if (sha256(sealed.sealed_handle) !== sealed.provider_handle_sha256) {
      throw new SandboxError("integrity_failed", "Provider handle digest mismatch");
    }
    try {
      const packed = Buffer.from(sealed.sealed_handle, "base64url");
      if (packed.byteLength < 30 || packed[0] !== 2) throw new Error("invalid envelope");
      const iv = packed.subarray(1, 13);
      const tag = packed.subarray(13, 29);
      const encrypted = packed.subarray(29);
      const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
      decipher.setAAD(providerHandleAad(expectedBinding));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
      const handle = parseStorageJson<OwnedProviderHandleV1>(plaintext);
      if (handle.schema_version !== SCHEMA_VERSION || handle.resource_id !== sealed.resource_id) {
        throw new Error("binding mismatch");
      }
      assertOpaqueId(handle.resource_id, "handle.resource_id", "sbx");
      assertDigest(handle.immutable_fingerprint_sha256, "handle.immutable_fingerprint_sha256");
      assertDigest(handle.provider_identity_sha256, "handle.provider_identity_sha256");
      if (handle.provider_identity_sha256 !== providerHandleIdentityDigest(handle)) {
        throw new SandboxError("integrity_failed", "Provider handle identity digest mismatch");
      }
      if (providerHandleBindingDigest(providerHandleBinding(handle)) !== expectedBindingSha256) {
        throw new SandboxError("integrity_failed", "Provider handle plaintext binding mismatch");
      }
      return handle;
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError("integrity_failed", "Provider handle authentication failed");
    }
  }
}
