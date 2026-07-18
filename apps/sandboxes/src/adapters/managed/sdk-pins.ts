import type {
  CreateSandboxFromImageParams,
  Daytona,
  ListSandboxesQuery,
  Resources,
  Sandbox as DaytonaSandbox,
} from "@daytona/sdk"
import type { Sandbox, SandboxInfo, SandboxListOpts, SandboxOpts } from "e2b"
import type { Digest, ManagedProviderIdV1 } from "./types"

export const E2B_SDK_PIN = Object.freeze({ package: "e2b", version: "2.31.0" } as const)
export const DAYTONA_SDK_PIN = Object.freeze({ package: "@daytona/sdk", version: "0.193.0" } as const)

export type E2bOfficialSdkSurfaceV1 = Pick<
  typeof Sandbox,
  "create" | "connect" | "getInfo" | "kill" | "list" | "pause" | "updateNetwork"
>

export type E2bOfficialSandboxInfoV1 = SandboxInfo

export type DaytonaOfficialSdkSurfaceV1 = Pick<
  Daytona,
  "create" | "delete" | "get" | "list" | "start" | "stop"
>

export type DaytonaOfficialSandboxSurfaceV1 = Pick<
  DaytonaSandbox,
  | "delete"
  | "fs"
  | "pause"
  | "process"
  | "refreshData"
  | "start"
  | "stop"
  | "updateNetworkSettings"
>

export interface OwnershipMetadataV1 {
  installation_sha256: Digest
  provider_scope_ref_sha256: Digest
  ownership_nonce_sha256: Digest
  creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
}

function ownershipLabels(metadata: OwnershipMetadataV1): Record<string, string> {
  return {
    "hasna.installation_sha256": metadata.installation_sha256,
    "hasna.provider_scope_ref_sha256": metadata.provider_scope_ref_sha256,
    "hasna.ownership_nonce_sha256": metadata.ownership_nonce_sha256,
    "hasna.creation_token_sha256": metadata.creation_token_sha256,
    "hasna.immutable_fingerprint_sha256": metadata.immutable_fingerprint_sha256,
  }
}

function creationLabels(metadata: OwnershipMetadataV1, networkPolicySha256: Digest): Record<string, string> {
  return {
    ...ownershipLabels(metadata),
    "hasna.network_policy_sha256": networkPolicySha256,
  }
}

export function buildE2bExactOwnershipListOptions(metadata: OwnershipMetadataV1): SandboxListOpts {
  return { query: { metadata: ownershipLabels(metadata) }, limit: 100 }
}

export function buildDaytonaExactOwnershipListQuery(metadata: OwnershipMetadataV1): ListSandboxesQuery {
  return { labels: ownershipLabels(metadata), limit: 100 }
}

export interface E2bCreateMappingInputV1 {
  template: string
  metadata: OwnershipMetadataV1
  network_policy_sha256: Digest
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
      ...creationLabels(input.metadata, input.network_policy_sha256),
      "hasna.e2b_max_runtime_ms": String(input.max_runtime_ms),
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
  image: string
  labels: OwnershipMetadataV1
  network_policy_sha256: Digest
  resources: Resources
}

export function buildDaytonaCreateParams(input: DaytonaCreateMappingInputV1): CreateSandboxFromImageParams {
  return {
    image: input.image,
    user: "daytona",
    resources: input.resources,
    labels: creationLabels(input.labels, input.network_policy_sha256),
    envVars: {},
    public: false,
    autoStopInterval: 0,
    autoDeleteInterval: -1,
    ephemeral: false,
    networkBlockAll: true,
  }
}

export type OfficialSdkContractGapV1 =
  | "create_stopped_unavailable_in_pinned_sdk"
  | "creation_metadata_filter_consistency_live_evidence"
  | "distributed_lifecycle_lock_coverage_live_evidence"
  | "fixed_broker_bootstrap_and_transport_live_evidence"
  | "atomic_file_precondition_live_evidence"
  | "whole_guest_cancel_live_evidence"
  | "pause_preserves_filesystem_live_evidence"
  | "delete_absence_consistency_live_evidence"
  | "conditional_destroy_unavailable_in_pinned_sdk"
  | "authenticated_broker_attestation_and_replay_evidence"
  | "broker_only_network_semantics_live_evidence"
  | "strong_vm_live_evidence"

export type OfficialSdkCompensationV1 =
  | "creation_token_metadata_plus_exact_lookup_plus_lifecycle_lock"
  | "fixed_bootstrap_plus_typed_guest_broker_frames"

export interface OfficialApiEvidenceV1 {
  url: string
  observation: string
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

export const OFFICIAL_SDK_CONTRACT_GAPS: Readonly<
  Record<
    ManagedProviderIdV1,
    {
      admission: "disabled"
      compensated_in_adapter: readonly OfficialSdkCompensationV1[]
      gaps: readonly OfficialSdkContractGapV1[]
      official_api_evidence: readonly OfficialApiEvidenceV1[]
    }
  >
> = deepFreeze({
  e2b: {
    admission: "disabled",
    compensated_in_adapter: [
      "creation_token_metadata_plus_exact_lookup_plus_lifecycle_lock",
      "fixed_bootstrap_plus_typed_guest_broker_frames",
    ],
    gaps: [
      "create_stopped_unavailable_in_pinned_sdk",
      "creation_metadata_filter_consistency_live_evidence",
      "distributed_lifecycle_lock_coverage_live_evidence",
      "fixed_broker_bootstrap_and_transport_live_evidence",
      "atomic_file_precondition_live_evidence",
      "whole_guest_cancel_live_evidence",
      "pause_preserves_filesystem_live_evidence",
      "delete_absence_consistency_live_evidence",
      "conditional_destroy_unavailable_in_pinned_sdk",
      "authenticated_broker_attestation_and_replay_evidence",
      "broker_only_network_semantics_live_evidence",
      "strong_vm_live_evidence",
    ],
    official_api_evidence: [
      {
        url: "https://e2b.dev/docs/sandbox/list",
        observation: "The official list surface exposes metadata filtering/readback, but no atomic uniqueness constraint for a creation-token metadata value.",
      },
      {
        url: "https://e2b.dev/docs/api-reference/sandboxes/get-sandbox",
        observation: "The official get surface supports identity and network readback used by the adapter; live consistency and isolation still require conformance evidence.",
      },
    ],
  },
  daytona_cloud: {
    admission: "disabled",
    compensated_in_adapter: [
      "creation_token_metadata_plus_exact_lookup_plus_lifecycle_lock",
      "fixed_bootstrap_plus_typed_guest_broker_frames",
    ],
    gaps: [
      "create_stopped_unavailable_in_pinned_sdk",
      "creation_metadata_filter_consistency_live_evidence",
      "distributed_lifecycle_lock_coverage_live_evidence",
      "fixed_broker_bootstrap_and_transport_live_evidence",
      "atomic_file_precondition_live_evidence",
      "whole_guest_cancel_live_evidence",
      "pause_preserves_filesystem_live_evidence",
      "delete_absence_consistency_live_evidence",
      "conditional_destroy_unavailable_in_pinned_sdk",
      "authenticated_broker_attestation_and_replay_evidence",
      "broker_only_network_semantics_live_evidence",
      "strong_vm_live_evidence",
    ],
    official_api_evidence: [
      {
        url: "https://www.daytona.io/docs/en/typescript-sdk/",
        observation: "The official TypeScript SDK exposes labels, lifecycle, process, and filesystem surfaces, but not an atomic uniqueness constraint for a creation-token label.",
      },
      {
        url: "https://www.daytona.io/docs/en/sandboxes/",
        observation: "The official sandbox lifecycle is the basis for locked readback/delete compensation; live isolation and consistency still require conformance evidence.",
      },
    ],
  },
})
