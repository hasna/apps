/**
 * @hasna/files — the single client Store seam.
 *
 * Every CLI command, MCP tool, and SDK method that reads or writes the files
 * *data plane* (sources, files, tags, collections, projects, machines) routes
 * through a `FilesStore`. There are exactly two transports behind this one
 * interface:
 *
 *   - {@link LocalStore} — on-box SQLite at ~/.hasna/files/files.db (first-class).
 *   - {@link ApiStore}   — HTTPS `https://files.hasna.xyz/v1` + bearer key.
 *
 * `self_hosted` and `cloud` BOTH use the ApiStore (identical client code; only
 * the URL/key differ — that distinction is server-side tenancy, not a client
 * concern). Callers never branch on transport and never touch SQLite or a raw
 * HTTP client directly: that inline branching was the split-brain bug this seam
 * eliminates. A raw database DSN is NEVER used by the client.
 */
import type {
  AutoRules,
  Collection,
  FileWithTags,
  ListFilesOptions,
  Machine,
  Project,
  ProjectStatus,
  Source,
  SourceConfig,
  SourceType,
  Tag,
} from "../types/index.js";

/** Input to {@link FilesStore.createSource}. `machine_id` is honored by the
 *  LocalStore and dropped by the ApiStore (the cloud assigns the owner). */
export interface CreateSourceInput {
  name: string;
  type: SourceType;
  path?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  config?: SourceConfig;
  machine_id: string;
}

/** Optional metadata accepted when creating a collection. */
export interface CreateCollectionOptions {
  parent_id?: string;
  auto_rules?: AutoRules;
  metadata?: Record<string, unknown>;
}

/** Optional metadata accepted when creating a project. */
export interface CreateProjectOptions {
  status?: ProjectStatus;
  metadata?: Record<string, unknown>;
}

/**
 * The portable data-plane operations supported by BOTH transports. Local-only
 * concerns (filesystem indexing, extraction, Google Drive / S3 sync, evidence,
 * organization, ops snapshots) are not part of this interface — they are
 * implementation details of the on-box installation and never route to the
 * cloud API.
 */
export interface FilesStore {
  /** "local" for the SQLite transport, "api" for the cloud HTTP transport. */
  readonly transport: "local" | "api";

  // ── sources ──────────────────────────────────────────────────────────────
  listSources(machineId?: string): Promise<Source[]>;
  createSource(input: CreateSourceInput): Promise<Source>;
  getSource(id: string): Promise<Source | null>;
  deleteSource(id: string): Promise<boolean>;

  // ── files ────────────────────────────────────────────────────────────────
  listFiles(opts?: ListFilesOptions): Promise<FileWithTags[]>;
  getFile(id: string): Promise<FileWithTags | null>;
  tagFile(fileId: string, tag: string): Promise<void>;
  untagFile(fileId: string, tag: string): Promise<void>;

  // ── tags ─────────────────────────────────────────────────────────────────
  listTags(): Promise<Tag[]>;

  // ── collections ────────────────────────────────────────────────────────────
  /** `parentId` filters child collections on the LocalStore; the ApiStore
   *  ignores it (the cloud /v1/collections endpoint has no parent filter). */
  listCollections(parentId?: string): Promise<Collection[]>;
  createCollection(name: string, description?: string, opts?: CreateCollectionOptions): Promise<Collection>;
  addToCollection(collectionId: string, fileId: string): Promise<void>;
  removeFromCollection(collectionId: string, fileId: string): Promise<void>;

  // ── projects ───────────────────────────────────────────────────────────────
  /** `status` filters on the LocalStore; the ApiStore ignores it (the cloud
   *  /v1/projects endpoint has no status filter). */
  listProjects(status?: ProjectStatus): Promise<Project[]>;
  createProject(name: string, description?: string, opts?: CreateProjectOptions): Promise<Project>;
  addToProject(projectId: string, fileId: string): Promise<void>;
  removeFromProject(projectId: string, fileId: string): Promise<void>;

  // ── machines ───────────────────────────────────────────────────────────────
  listMachines(): Promise<Machine[]>;
}
