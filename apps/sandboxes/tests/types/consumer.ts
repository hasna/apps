import {
  createE2bAdapter,
  type ManagedAdapterDependenciesV1,
  type ManagedProviderAdapterV1,
} from "@hasna/sandboxes"

const factory: (dependencies: ManagedAdapterDependenciesV1) => ManagedProviderAdapterV1 =
  createE2bAdapter

void factory
