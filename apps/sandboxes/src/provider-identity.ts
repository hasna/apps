import { canonicalDigest, type Digest } from "./canonical.js";
import type {
  AdapterDescriptorV1,
  AdapterAdmissionReceiptV1,
  OwnedProviderHandleV1,
  ProviderHandleBindingV1,
  ProviderNonAcceptanceProofV1,
} from "./types.js";

export function adapterAdmissionReceiptDigest(
  receipt: Omit<AdapterAdmissionReceiptV1, "receipt_sha256" | "signature"> |
    AdapterAdmissionReceiptV1,
): Digest {
  return canonicalDigest({
    schema_version: receipt.schema_version,
    registry_id: receipt.registry_id,
    adapter_id: receipt.adapter_id,
    adapter_version: receipt.adapter_version,
    build_sha256: receipt.build_sha256,
    descriptor_sha256: receipt.descriptor_sha256,
    installation_id: receipt.installation_id,
    provider_scope_ref: receipt.provider_scope_ref,
    status: receipt.status,
    conformance_manifest_sha256: receipt.conformance_manifest_sha256,
    issued_at: receipt.issued_at,
    expires_at: receipt.expires_at,
    issuer_principal: receipt.issuer_principal,
    signing_key_id: receipt.signing_key_id,
  });
}

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
    supported_architectures: descriptor.supported_architectures,
    isolation_evidence_sha256: descriptor.isolation_evidence_sha256,
    guest_kernel_boundary_evidence_sha256:
      descriptor.guest_kernel_boundary_evidence_sha256,
    network_modes: descriptor.network_modes,
    network_enforcement_evidence_sha256:
      descriptor.network_enforcement_evidence_sha256,
    exact_operation_lookup: descriptor.exact_operation_lookup,
    inert_create: descriptor.inert_create,
    whole_scope_cancel: descriptor.whole_scope_cancel,
    native_bounded_files: descriptor.native_bounded_files,
    read_only_workspace_enforcement: descriptor.read_only_workspace_enforcement,
    atomic_incarnation_bound_delete: descriptor.atomic_incarnation_bound_delete,
    ownership_reconciliation: descriptor.ownership_reconciliation,
    destructive_operation_semantics: descriptor.destructive_operation_semantics,
    provider_hard_ttl_semantics: descriptor.provider_hard_ttl_semantics,
    output_framing: descriptor.output_framing,
    max_ttl_ms: descriptor.max_ttl_ms,
    resource_limits: descriptor.resource_limits,
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
    adapter_id: handle.adapter_id,
    adapter_version: handle.adapter_version,
    installation_id: handle.installation_id,
    provider_scope_ref: handle.provider_scope_ref,
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
  proof: Omit<ProviderNonAcceptanceProofV1, "proof_sha256" | "signature"> |
    ProviderNonAcceptanceProofV1,
): Digest {
  return canonicalDigest({
    schema_version: proof.schema_version,
    target: proof.target,
    operation_execution_epoch: proof.operation_execution_epoch,
    request_sha256: proof.request_sha256,
    provider_receipt_sha256: proof.provider_receipt_sha256,
    proof_kind: proof.proof_kind,
    observed_at: proof.observed_at,
    expires_at: proof.expires_at,
    issuer_principal: proof.issuer_principal,
    signing_key_id: proof.signing_key_id,
  });
}
