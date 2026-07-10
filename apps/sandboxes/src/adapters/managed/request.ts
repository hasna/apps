import { canonicalSha256 } from "./canonical"
import type { Digest, ManagedProviderRequestV1 } from "./types"

export function managedProviderRequestSha256(request: ManagedProviderRequestV1): Digest {
  return canonicalSha256({
    schema_version: "sandboxes.provider-request/v1",
    request,
  })
}
