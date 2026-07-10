import type { CreateSandboxFromSnapshotParams, Resources } from "@daytona/sdk"
import type { Sandbox, SandboxInfo, SandboxOpts } from "e2b"
import type { Digest, ManagedProviderIdV1 } from "./types"

export const E2B_SDK_PIN = { package: "e2b", version: "2.31.0" } as const
export const DAYTONA_SDK_PIN = { package: "@daytona/sdk", version: "0.193.0" } as const

export type E2bOfficialSdkSurfaceV1 = Pick<
  typeof Sandbox,
  "create" | "connect" | "getInfo" | "kill" | "list" | "pause" | "updateNetwork"
>

export type E2bOfficialSandboxInfoV1 = SandboxInfo

export interface OwnershipMetadataV1 {
  installation_sha256: Digest
  creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
}

export interface E2bCreateMappingInputV1 {
  template: string
  metadata: OwnershipMetadataV1
  max_runtime_ms: number
}

export type SafeE2bCreateOptionsV1 = Omit<
  SandboxOpts,
  "apiKey" | "headers" | "apiHeaders" | "envs" | "mcp" | "volumeMounts" | "sandboxUrl"
> & {
  envs: Record<string, never>
}

export function buildE2bCreateOptions(input: E2bCreateMappingInputV1): SafeE2bCreateOptionsV1 {
  const options = {
    template: input.template,
    metadata: {
      "hasna.installation_sha256": input.metadata.installation_sha256,
      "hasna.creation_token_sha256": input.metadata.creation_token_sha256,
      "hasna.immutable_fingerprint_sha256": input.metadata.immutable_fingerprint_sha256,
    },
    envs: {},
    timeoutMs: input.max_runtime_ms,
    secure: true,
    allowInternetAccess: false,
    network: {
      denyOut: ["0.0.0.0/0"],
      allowPublicTraffic: false,
    },
    lifecycle: {
      onTimeout: { action: "pause", keepMemory: false },
      autoResume: false,
    },
  } satisfies SandboxOpts
  return options
}

export interface DaytonaCreateMappingInputV1 {
  snapshot: string
  labels: OwnershipMetadataV1
  resources: Resources
}

export function buildDaytonaCreateParams(input: DaytonaCreateMappingInputV1): CreateSandboxFromSnapshotParams {
  return {
    snapshot: input.snapshot,
    labels: {
      "hasna.installation_sha256": input.labels.installation_sha256,
      "hasna.creation_token_sha256": input.labels.creation_token_sha256,
      "hasna.immutable_fingerprint_sha256": input.labels.immutable_fingerprint_sha256,
    },
    envVars: {},
    public: false,
    autoStopInterval: 0,
    autoDeleteInterval: -1,
    ephemeral: false,
    networkBlockAll: true,
  }
}

export type OfficialSdkContractGapV1 =
  | "atomic_creation_token"
  | "create_stopped"
  | "typed_argv_exec"
  | "atomic_file_precondition"
  | "whole_guest_cancel"
  | "conditional_destroy"
  | "broker_only_network_semantics"
  | "strong_vm_live_evidence"

export const OFFICIAL_SDK_CONTRACT_GAPS: Readonly<
  Record<ManagedProviderIdV1, { admission: "disabled"; gaps: readonly OfficialSdkContractGapV1[] }>
> = {
  e2b: {
    admission: "disabled",
    gaps: [
      "atomic_creation_token",
      "create_stopped",
      "typed_argv_exec",
      "atomic_file_precondition",
      "whole_guest_cancel",
      "conditional_destroy",
      "broker_only_network_semantics",
      "strong_vm_live_evidence",
    ],
  },
  daytona_cloud: {
    admission: "disabled",
    gaps: [
      "atomic_creation_token",
      "create_stopped",
      "typed_argv_exec",
      "atomic_file_precondition",
      "whole_guest_cancel",
      "conditional_destroy",
      "broker_only_network_semantics",
      "strong_vm_live_evidence",
    ],
  },
}
