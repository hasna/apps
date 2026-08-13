export type ProviderId = "huggingface" | "github-release" | string;
export type EntityKind = "model" | "dataset" | "space" | "collection" | "artifact";

export interface ProviderRef {
  provider: ProviderId;
  entityKind: EntityKind;
  repoId: string;
  revision: string;
}

export interface CatalogEntry {
  provider: ProviderId;
  entityKind: EntityKind;
  repoId: string;
  revision: string;
  canonicalUrl: string;
  title: string;
  author?: string | null;
  task?: string | null;
  libraryName?: string | null;
  license?: string | null;
  gated: boolean;
  private: boolean;
  downloads?: number | null;
  likes?: number | null;
  tags: string[];
  lastModified?: string | null;
  metadata: Record<string, unknown>;
}

export interface RemoteFileEntry {
  provider: ProviderId;
  entityKind: EntityKind;
  repoId: string;
  revision: string;
  path: string;
  size: number | null;
  oid?: string | null;
  lfsOid?: string | null;
  format?: string | null;
  downloadUrl: string;
  metadata: Record<string, unknown>;
}

export interface SearchInput {
  query?: string;
  entityKind?: EntityKind;
  task?: string;
  license?: string;
  tags?: string[];
  limit?: number;
  sort?: "downloads" | "likes" | "lastModified" | "createdAt" | "trendingScore";
  direction?: "asc" | "desc";
}

export interface DownloadPlan {
  ref: ProviderRef;
  files: RemoteFileEntry[];
  totalBytes: number | null;
  unknownSizeFiles: string[];
  destinationRoot: string;
  exceedsMaxBytes: boolean;
  maxBytes: number | null;
}

export interface InstalledArtifact {
  id: string;
  provider: ProviderId;
  entityKind: EntityKind;
  repoId: string;
  revision: string;
  installPath: string;
  bytes: number;
  files: string[];
  status: "installed" | "planned" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface AuthStatus {
  provider: ProviderId;
  available: boolean;
  source: "env" | "config" | "secrets" | "none";
  secretKey?: string;
}

export interface DoctorReport {
  ok: boolean;
  dataDir: string;
  dbPath: string;
  providers: AuthStatus[];
  checks: Array<{
    id: string;
    status: "ok" | "warn" | "fail";
    detail: string;
  }>;
}

export const MODEL_CAPABILITY_SCHEMA_VERSION = "hasna.model-capability.v1" as const;

export type CapabilitySupport = "yes" | "no" | "partial";
export type CapabilityModality = "text" | "image" | "audio" | "video" | "embedding";
export type CapabilityLatencyClass = "low" | "standard" | "batch" | "local";
export type CapabilityRuntimeKind = "hosted" | "openai-compatible" | "ollama" | "lm-studio" | "huggingface-artifact";
export type ProviderHealthStatus = "available" | "degraded" | "unavailable" | "unknown";
export type PrivacyRetentionClass = "none" | "ephemeral" | "provider-retained" | "unknown";

export interface ModelPricing {
  currency: "USD" | string;
  inputPerMillionTokens: number | null;
  outputPerMillionTokens: number | null;
  cacheReadPerMillionTokens?: number | null;
  cacheWritePerMillionTokens?: number | null;
  effectiveAt: string;
}

export interface ModelRuntimeRequirements {
  kind: CapabilityRuntimeKind;
  endpointEnv?: string | null;
  packageName?: string | null;
  minimumRamGb?: number | null;
  minimumVramGb?: number | null;
  quantization?: string | null;
  fileFormats: string[];
  notes?: string | null;
}

export interface ModelCapability {
  schemaVersion: typeof MODEL_CAPABILITY_SCHEMA_VERSION;
  capabilityVersion: string;
  provider: ProviderId;
  modelId: string;
  aliases: string[];
  displayName?: string | null;
  contextWindowTokens: number;
  maxOutputTokens: number;
  modalities: {
    input: CapabilityModality[];
    output: CapabilityModality[];
  };
  toolUse: CapabilitySupport;
  functionCalling: CapabilitySupport;
  structuredOutput: CapabilitySupport;
  jsonMode: CapabilitySupport;
  pricing: ModelPricing;
  latencyClass: CapabilityLatencyClass;
  safetyLabels: string[];
  privacy: {
    retention: PrivacyRetentionClass;
    usedForTraining: boolean | null;
    zeroRetentionAvailable: boolean | null;
  };
  runtime: ModelRuntimeRequirements;
  providerHealth: {
    status: ProviderHealthStatus;
    checkedAt: string;
    region?: string | null;
    detail?: string | null;
  };
  source: {
    type: "fixture" | "manual" | "provider";
    url?: string | null;
    retrievedAt: string;
  };
  updatedAt: string;
  metadata: Record<string, unknown>;
}
