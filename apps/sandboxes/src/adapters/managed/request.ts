import { canonicalSha256 } from "./canonical"
import type { Digest, ManagedProviderRequestV1, ProviderOperationV1 } from "./types"

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
