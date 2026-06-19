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
