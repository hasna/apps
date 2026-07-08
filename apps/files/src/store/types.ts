/**
 * @hasna/files — the single client Store seam.
 *
 * Every CLI command, MCP tool, and SDK method that reads or writes the files
 * *data plane* routes through a `FilesStore`. There are exactly two transports
 * behind this one interface:
 *
 *   - {@link LocalStore} — on-box SQLite at ~/.hasna/files/files.db (first-class).
 *   - {@link ApiStore}   — HTTPS `https://files.hasna.xyz/v1` + bearer key.
 *
 * `self_hosted` and `cloud` BOTH use the ApiStore (identical client code; only
 * the URL/key differ — that distinction is server-side tenancy, not a client
 * concern). Callers never branch on transport for data access and never touch
 * SQLite or a raw HTTP client directly: that inline branching was the
 * split-brain bug this seam eliminates. A raw database DSN is NEVER used by the
 * client.
 *
 * On-box *ingestion* capabilities (filesystem/S3/Google Drive indexing,
 * extraction, local file watching, evidence upload) are physical, machine-local
 * side effects — they only run under {@link LocalStore} and are refused in api
 * mode by the caller. Their DB effects, however, still flow through this seam.
 */
import type {
  ActionType,
  Agent,
  AgentActivity,
  AutoRules,
  Collection,
  DuplicateGroup,
  FileWithTags,
  ListFilesOptions,
  Machine,
  Project,
  ProjectStatus,
  SearchResult,
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

/** Patch accepted by {@link FilesStore.updateSource}. Static S3 credentials are
 *  never accepted here (the config is sanitized by both transports). */
export interface UpdateSourceInput {
  name?: string;
  enabled?: boolean;
  config?: SourceConfig;
  path?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
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

/** Patch accepted by {@link FilesStore.updateCollection}. */
export interface UpdateCollectionInput {
  name?: string;
  description?: string;
  parent_id?: string | null;
  auto_rules?: AutoRules;
  metadata?: Record<string, unknown>;
}

/** Patch accepted by {@link FilesStore.updateProject}. */
export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  metadata?: Record<string, unknown>;
}

/** A collection with derived counts + children. */
export type CollectionDetail = Collection & { file_count: number; children: Collection[] };
/** A project with a derived file count. */
export type ProjectDetail = Project & { file_count: number };
/** A file annotated with the timestamp it was last touched by an agent. */
export type RecentFile = FileWithTags & { last_touched?: string };

/** Feedback record accepted by {@link FilesStore.recordFeedback}. */
export interface FeedbackInput {
  message: string;
  email?: string;
  category?: string;
  version: string;
}

/** Input to {@link FilesStore.logActivity}. */
export interface LogActivityInput {
  agent_id: string;
  action: ActionType;
  file_id?: string;
  source_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
}

/** Filters accepted by the activity readers on {@link FilesStore}. */
export interface ActivityQueryOptions {
  after?: string;
  before?: string;
  action?: ActionType;
  limit?: number;
  offset?: number;
}

/**
 * The full portable data plane, supported by BOTH transports. Every reader and
 * writer of files/sources/tags/collections/projects/machines routes through
 * this interface — there is no second path to the data.
 */
export interface FilesStore {
  /** "local" for the SQLite transport, "api" for the cloud HTTP transport. */
  readonly transport: "local" | "api";

  // ── sources ──────────────────────────────────────────────────────────────
  listSources(machineId?: string): Promise<Source[]>;
  createSource(input: CreateSourceInput): Promise<Source>;
  getSource(id: string): Promise<Source | null>;
  updateSource(id: string, patch: UpdateSourceInput): Promise<Source | null>;
  deleteSource(id: string): Promise<boolean>;

  // ── machines ───────────────────────────────────────────────────────────────
  listMachines(): Promise<Machine[]>;
  /** The machine that owns this client (local host, or the cloud service row). */
  currentMachine(): Promise<Machine>;

  // ── files ────────────────────────────────────────────────────────────────
  listFiles(opts?: ListFilesOptions): Promise<FileWithTags[]>;
  getFile(id: string): Promise<FileWithTags | null>;
  getFileByPath(sourceId: string, path: string): Promise<FileWithTags | null>;
  searchFiles(query: string, opts?: Omit<ListFilesOptions, "query">): Promise<SearchResult[]>;
  recentFiles(agentId?: string, limit?: number): Promise<RecentFile[]>;
  findDuplicates(sourceId?: string): Promise<DuplicateGroup[]>;
  getStats(): Promise<Record<string, unknown>>;
  annotateFile(fileId: string, description: string): Promise<FileWithTags | null>;
  moveFile(fileId: string, destPath: string): Promise<boolean>;
  renameFile(fileId: string, newName: string, ext: string): Promise<string | null>;
  softDeleteFile(fileId: string): Promise<boolean>;
  restoreFile(fileId: string): Promise<boolean>;
  purgeDeleted(sourceId?: string, olderThan?: string): Promise<number>;
  normalizeSource(sourceId: string): Promise<number>;
  listConflicts(sourceId?: string, limit?: number): Promise<FileWithTags[]>;
  resolveConflict(fileId: string): Promise<boolean>;

  // ── tags ─────────────────────────────────────────────────────────────────
  listTags(): Promise<Tag[]>;
  tagFile(fileId: string, tag: string): Promise<void>;
  untagFile(fileId: string, tag: string): Promise<void>;
  deleteTag(id: string): Promise<boolean>;

  // ── collections ────────────────────────────────────────────────────────────
  /** `parentId` filters child collections on the LocalStore; the ApiStore
   *  ignores it (the cloud /v1/collections endpoint has no parent filter). */
  listCollections(parentId?: string): Promise<Collection[]>;
  getCollection(id: string): Promise<CollectionDetail | null>;
  createCollection(name: string, description?: string, opts?: CreateCollectionOptions): Promise<Collection>;
  updateCollection(id: string, patch: UpdateCollectionInput): Promise<Collection | null>;
  deleteCollection(id: string): Promise<boolean>;
  getOrCreateCollection(name: string, description?: string): Promise<Collection>;
  autoPopulateCollection(id: string): Promise<number>;
  addToCollection(collectionId: string, fileId: string): Promise<void>;
  removeFromCollection(collectionId: string, fileId: string): Promise<void>;

  // ── projects ───────────────────────────────────────────────────────────────
  /** `status` filters on the LocalStore; the ApiStore ignores it (the cloud
   *  /v1/projects endpoint has no status filter). */
  listProjects(status?: ProjectStatus): Promise<Project[]>;
  getProject(id: string): Promise<ProjectDetail | null>;
  createProject(name: string, description?: string, opts?: CreateProjectOptions): Promise<Project>;
  updateProject(id: string, patch: UpdateProjectInput): Promise<Project | null>;
  deleteProject(id: string): Promise<boolean>;
  getOrCreateProject(name: string, description?: string): Promise<Project>;
  addToProject(projectId: string, fileId: string): Promise<void>;
  removeFromProject(projectId: string, fileId: string): Promise<void>;

  // ── feedback ─────────────────────────────────────────────────────────────
  recordFeedback(input: FeedbackInput): Promise<void>;

  // ── agents ─────────────────────────────────────────────────────────────
  /** Register (or refresh) an agent session by name; also bumps last_seen_at. */
  registerAgent(name: string, sessionId?: string): Promise<Agent>;
  /** Bump last_seen_at for an agent. Returns null if the agent is unknown. */
  heartbeatAgent(agentId: string): Promise<Agent | null>;
  /** Set (or clear) the active project focus for an agent. */
  setAgentFocus(agentId: string, projectId?: string): Promise<Agent | null>;
  getAgent(agentId: string): Promise<Agent | null>;
  listAgents(): Promise<Agent[]>;

  // ── activity ─────────────────────────────────────────────────────────────
  /** Append an agent-activity record (telemetry for reads/writes). */
  logActivity(input: LogActivityInput): Promise<void>;
  getFileHistory(fileId: string, opts?: ActivityQueryOptions): Promise<AgentActivity[]>;
  getAgentActivity(agentId: string, opts?: ActivityQueryOptions): Promise<AgentActivity[]>;
  getSessionActivity(sessionId: string, opts?: ActivityQueryOptions): Promise<AgentActivity[]>;
}
