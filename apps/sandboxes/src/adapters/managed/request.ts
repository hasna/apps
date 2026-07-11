import { canonicalSha256 } from "./canonical"
import type {
  Digest,
  ManagedProviderIdV1,
  ManagedProviderRequestV1,
  ProviderOperationV1,
} from "./types"

export function managedProviderRequestSha256(request: ManagedProviderRequestV1): Digest {
  return canonicalSha256({
    schema_version: "sandboxes.provider-request/v1",
    request,
  })
}

export function providerCreationTokenSha256(input: {
  resource_id: string
  resource_lease_id: string
  allocation_key_sha256: Digest
  spec_sha256: Digest
}): Digest {
  return canonicalSha256({
    schema_version: "sandboxes.provider-creation-token/v1",
    ...input,
  })
}

export function providerTargetFingerprintSha256(input: {
  adapter_id: ManagedProviderIdV1
  adapter_version: string
  installation_id: string
  provider_scope_ref: string
  resource_id: string
  resource_lease_id: string
  provider_creation_token_sha256: Digest
  spec_sha256: Digest
}): Digest {
  return canonicalSha256({
    schema_version: "sandboxes.provider-target-fingerprint/v1",
    adapter_id: input.adapter_id,
    adapter_version: input.adapter_version,
    installation_id: input.installation_id,
    provider_scope_ref: input.provider_scope_ref,
    resource_kind: "managed_sandbox",
    resource_id: input.resource_id,
    resource_lease_id: input.resource_lease_id,
    provider_creation_token_sha256: input.provider_creation_token_sha256,
    spec_sha256: input.spec_sha256,
  })
}

export function providerEffectTokenSha256(
  operation: Pick<ProviderOperationV1, "operation"> & {
    target: Pick<
      ProviderOperationV1["target"],
      "operation_id" | "operation_step_id" | "operation_digest" | "resource_id" | "provider_creation_token_sha256"
    >
  },
): Digest {
  return canonicalSha256({
    schema_version: "sandboxes.provider-effect-token/v1",
    operation_id: operation.target.operation_id,
    operation_step_id: operation.target.operation_step_id,
    operation_digest: operation.target.operation_digest,
    resource_id: operation.target.resource_id,
    provider_creation_token_sha256: operation.target.provider_creation_token_sha256,
  })
}
