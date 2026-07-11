import { createProductionManagedProviderAdapter } from "./adapter"
import { DAYTONA_SDK_PIN } from "./sdk-pins"
import type { ManagedAdapterDependenciesV1, ManagedProviderAdapterV1 } from "./types"

export function createDaytonaCloudAdapter(dependencies: ManagedAdapterDependenciesV1): ManagedProviderAdapterV1 {
  return createProductionManagedProviderAdapter(
    {
      provider: "daytona_cloud",
      sdkPackage: DAYTONA_SDK_PIN.package,
      sdkVersion: DAYTONA_SDK_PIN.version,
    },
    dependencies,
  )
}
