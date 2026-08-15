import { __testOnlyCreateManagedProviderAdapterCore } from "../../src/adapters/managed/adapter"
import { adapterError } from "../../src/adapters/managed/errors"
import type {
  ManagedAdapterDependenciesV1,
  ManagedProviderAdapterV1,
  ManagedProviderIdV1,
} from "../../src/adapters/managed/types"

/** Test-only construction kept outside the package's files/exports allowlist. */
export function createHermeticManagedProviderAdapterForTest(
  provider: ManagedProviderIdV1,
  dependencies: ManagedAdapterDependenciesV1,
): ManagedProviderAdapterV1 {
  const identity = {
    provider,
    sdkPackage: provider === "e2b" ? "e2b" : "@daytona/sdk",
    sdkVersion: provider === "e2b" ? "2.31.0" : "0.193.0",
  } as const
  return __testOnlyCreateManagedProviderAdapterCore(
    identity,
    dependencies,
    async (input) => {
      const checkedDependencies = input.dependencies
      if (
        !checkedDependencies.admission.admitted ||
        checkedDependencies.admission.evidence_kind !== "hermetic_conformance"
      ) {
        throw adapterError("unsupported_runtime_feature")
      }
      try {
        await checkedDependencies.admission_verifier.assertAdmitted({
          provider: input.identity.provider,
          sdk_version: input.identity.sdkVersion,
          adapter_build_sha256: checkedDependencies.adapter_build_sha256,
          evidence_sha256: checkedDependencies.admission.evidence_sha256,
          evidence_kind: checkedDependencies.admission.evidence_kind,
        })
      } catch {
        throw adapterError("unsupported_runtime_feature")
      }
    },
  )
}
