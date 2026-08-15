import { createProductionManagedProviderAdapter } from "./adapter"
import { E2B_SDK_PIN } from "./sdk-pins"
import type { ManagedAdapterDependenciesV1, ManagedProviderAdapterV1 } from "./types"

export function createE2bAdapter(dependencies: ManagedAdapterDependenciesV1): ManagedProviderAdapterV1 {
  return createProductionManagedProviderAdapter(
    {
      provider: "e2b",
      sdkPackage: E2B_SDK_PIN.package,
      sdkVersion: E2B_SDK_PIN.version,
    },
    dependencies,
  )
}
