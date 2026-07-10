import { canonicalDigest, type Digest } from "./canonical.js";
import type { AdapterDescriptorV1, OwnedProviderHandleV1 } from "./types.js";

export function providerTargetFingerprintDigest(input: {
  adapter_id: AdapterDescriptorV1["adapter_id"];
  adapter_version: string;
  installation_id: string;
  provider_scope_ref: string;
  resource_kind: string;
  resource_id: string;
  resource_lease_id: string;
  provider_creation_token_sha256: Digest;
  spec_sha256: Digest;
}): Digest {
  return canonicalDigest({
    schema_version: "sandboxes.provider-target-fingerprint/v1",
    ...input,
  });
}

export function providerHandleIdentityDigest(
  handle: Omit<OwnedProviderHandleV1, "provider_identity_sha256">,
): Digest {
  return canonicalDigest({
    schema_version: "sandboxes.provider-handle-identity/v1",
    adapter_id: handle.adapter_id,
    adapter_version: handle.adapter_version,
    installation_id: handle.installation_id,
    provider_scope_ref: handle.provider_scope_ref,
    resource_kind: handle.resource_kind,
    opaque_resource_id: handle.opaque_resource_id,
    ownership_nonce: handle.ownership_nonce,
    create_inert_operation_id: handle.create_inert_operation_id,
    provider_creation_token_sha256: handle.provider_creation_token_sha256,
    creation_receipt_sha256: handle.creation_receipt_sha256,
    provider_created_at: handle.provider_created_at,
    provider_resource_version: handle.provider_resource_version,
    immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
    resource_lease_id: handle.resource_lease_id,
    resource_id: handle.resource_id,
    spec_sha256: handle.spec_sha256,
  });
}
