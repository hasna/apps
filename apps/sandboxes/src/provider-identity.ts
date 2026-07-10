import { canonicalDigest, type Digest } from "./canonical.js";
import type {
  AdapterDescriptorV1,
  OwnedProviderHandleV1,
  ProviderHandleBindingV1,
  ProviderNonAcceptanceProofV1,
} from "./types.js";

/** Core-owned digest over every closed descriptor fact except the digest itself. */
export function adapterDescriptorDigest(
  descriptor: Omit<AdapterDescriptorV1, "descriptor_sha256">,
): Digest {
  return canonicalDigest({
    schema_version: "sandboxes.adapter-descriptor/v1",
    runtime_schema_version: descriptor.schema_version,
    adapter_id: descriptor.adapter_id,
    adapter_version: descriptor.adapter_version,
    build_sha256: descriptor.build_sha256,
    installation_id: descriptor.installation_id,
    provider_scope_ref: descriptor.provider_scope_ref,
    status: descriptor.status,
    runtime_class: descriptor.runtime_class,
    network_modes: descriptor.network_modes,
    exact_operation_lookup: descriptor.exact_operation_lookup,
    inert_create: descriptor.inert_create,
    whole_scope_cancel: descriptor.whole_scope_cancel,
    native_bounded_files: descriptor.native_bounded_files,
    atomic_incarnation_bound_delete: descriptor.atomic_incarnation_bound_delete,
  });
}

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

export function providerHandleBinding(
  handle: Pick<
    OwnedProviderHandleV1,
    | "adapter_id"
    | "adapter_version"
    | "installation_id"
    | "provider_scope_ref"
    | "resource_kind"
    | "resource_id"
    | "resource_lease_id"
    | "resource_lifecycle_generation"
    | "provider_creation_token_sha256"
    | "immutable_fingerprint_sha256"
    | "provider_identity_sha256"
    | "spec_sha256"
  >,
): ProviderHandleBindingV1 {
  return {
    schema_version: "sandboxes.provider-handle-binding/v1",
    adapter_id: handle.adapter_id,
    adapter_version: handle.adapter_version,
    installation_id: handle.installation_id,
    provider_scope_ref: handle.provider_scope_ref,
    resource_kind: handle.resource_kind,
    resource_id: handle.resource_id,
    resource_lease_id: handle.resource_lease_id,
    resource_lifecycle_generation: handle.resource_lifecycle_generation,
    provider_creation_token_sha256: handle.provider_creation_token_sha256,
    immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
    provider_identity_sha256: handle.provider_identity_sha256,
    spec_sha256: handle.spec_sha256,
  };
}

export function providerHandleBindingDigest(binding: ProviderHandleBindingV1): Digest {
  return canonicalDigest(binding);
}

export function providerNonAcceptanceProofDigest(
  proof: Omit<ProviderNonAcceptanceProofV1, "proof_sha256"> | ProviderNonAcceptanceProofV1,
): Digest {
  return canonicalDigest({
    schema_version: "sandboxes.provider-non-acceptance-proof-digest/v1",
    proof_schema_version: proof.schema_version,
    adapter_id: proof.adapter_id,
    adapter_version: proof.adapter_version,
    installation_id: proof.installation_id,
    provider_scope_ref: proof.provider_scope_ref,
    operation_id: proof.operation_id,
    operation_step_id: proof.operation_step_id,
    operation_execution_epoch: proof.operation_execution_epoch,
    request_sha256: proof.request_sha256,
    dispatch_anchor_sha256: proof.dispatch_anchor_sha256,
    target: proof.target,
    observed_at: proof.observed_at,
    expires_at: proof.expires_at,
    provider_evidence_sha256: proof.provider_evidence_sha256,
  });
}
