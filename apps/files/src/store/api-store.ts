/**
 * Cloud HTTP transport for {@link FilesStore}. Routes every data-plane call to
 * the self-hosted service at `https://files.hasna.xyz/v1` through the
 * @hasna/contracts storage client (bearer key in the transport only — never a
 * database DSN, never logged). Used identically for `self_hosted` and `cloud`
 * tiers; the only difference is the URL/key, which is a server-side tenancy
 * concern, not a client one.
 *
 * The CRUD verbs (list/get/create/update/delete) cover top-level resources; the
 * transport escape hatch handles the sub-resource + action routes the CRUD
 * shape cannot express, matching the `/v1` route table in `src/server/v1.ts`.
 */
import { existsSync, readFileSync } from "fs";
import { basename } from "path";
import { lookup as mimeLookup } from "mime-types";
import { z } from "zod";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import { HasnaHttpError } from "@hasna/contracts/client";
import { sha256Buffer } from "../lib/hasher.js";
import type {
  Agent,
  AgentActivity,
  Collection,
  CreateFileLinkInput,
  DuplicateGroup,
  FileAccessEvent,
  FileAsset,
  FileUploadIntent,
  FileLink,
  FileWithTags,
  ListFilesOptions,
  Machine,
  Project,
  SearchResult,
  Source,
  Tag,
} from "../types/index.js";
import type {
  CreateEvidenceUploadInput,
  EvidenceDownloadGrant,
  EvidenceStorageOptions,
  EvidenceUploadResult,
  EvidenceVerifyResult,
  SignEvidenceDownloadInput,
  UploadEvidenceFileInput,
} from "../lib/evidence.js";
import { DEFAULT_EVIDENCE_S3_BUCKET, sanitizeEvidenceTransportError, withoutEvidenceUploadTransport } from "../lib/evidence.js";
import type { ListFileAssetsOptions } from "../db/evidence.js";
import type {
  ActivityQueryOptions,
  CollectionDetail,
  CreateCollectionOptions,
  CreateProjectOptions,
  CreateSourceInput,
  FeedbackInput,
  FilesStore,
  LogActivityInput,
  ProjectDetail,
  RecentFile,
  UpdateCollectionInput,
  UpdateProjectInput,
  UpdateSourceInput,
} from "./types.js";

const seg = (value: string): string => encodeURIComponent(value);
const ASSET_ID_PATTERN = /^asset_[a-f0-9]{16}$/;
const INTENT_ID_PATTERN = /^upl_[A-Za-z0-9_-]{12}$/;
const SAFE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;
const safeTimestampSchema = z.string().regex(SAFE_TIMESTAMP_PATTERN);

const fileAssetSchema = z.object({
  id: z.string().regex(ASSET_ID_PATTERN),
  org_id: z.string().min(1),
  company_id: z.string().min(1).optional(),
  app: z.string().min(1),
  kind: z.string().min(1),
  classification: z.string().min(1),
  original_name: z.string().min(1),
  content_type: z.string().min(1),
  size: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  checksum_algorithm: z.string().min(1),
  storage_provider: z.enum(["s3", "local"]),
  bucket: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  object_key: z.string().min(1),
  quarantine_key: z.string().min(1).optional(),
  status: z.enum(["pending_upload", "uploaded", "verified", "archived", "deleted"]),
  scan_status: z.enum(["pending", "clean", "skipped", "suspicious", "blocked"]),
  retention_until: z.string().min(1).optional(),
  retention_policy: z.string().min(1).optional(),
  storage_class: z.string().min(1).optional(),
  legal_hold: z.boolean(),
  immutable: z.boolean(),
  metadata: z.record(z.unknown()),
  created_at: safeTimestampSchema,
  updated_at: safeTimestampSchema,
  verified_at: safeTimestampSchema.optional(),
}).strict();

const uploadIntentSchema = z.object({
  id: z.string().regex(INTENT_ID_PATTERN),
  asset_id: z.string().regex(ASSET_ID_PATTERN),
  method: z.literal("PUT"),
  upload_url: z.string().min(1),
  expires_at: safeTimestampSchema,
  status: z.enum(["pending", "completed", "expired", "cancelled"]),
  expected_checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  expected_checksum_algorithm: z.string().min(1),
  expected_size: z.number().int().nonnegative(),
  required_headers: z.record(z.string()),
  metadata: z.record(z.unknown()),
  created_at: safeTimestampSchema,
  completed_at: safeTimestampSchema.optional(),
}).strict();

const createEvidenceUploadResultSchema = z.object({
  asset: fileAssetSchema,
  intent: uploadIntentSchema,
}).strict();

/** Map a 404 from a raw transport route to `null` (matches storage-client get). */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof HasnaHttpError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Resolve a DELETE to a truthful boolean: `true` when the server confirmed the
 * removal, `false` on 404 (the record — or the route — was absent). The
 * @hasna/contracts `client.delete` helper *swallows* a 404 and returns void,
 * which made every delete report a false "removed" even when nothing was
 * deleted; the raw transport `del` throws on 404 so we can tell the difference.
 */
async function deletedOk(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return true;
  } catch (e) {
    if (e instanceof HasnaHttpError && e.status === 404) return false;
    throw e;
  }
}

export class ApiStore implements FilesStore {
  readonly transport = "api" as const;

  constructor(private readonly client: HasnaStorageClient) {}

  private get http() {
    return this.client.transport;
  }

  // ── sources ──────────────────────────────────────────────────────────────
  async listSources(machineId?: string): Promise<Source[]> {
    return (await this.client.list<Source>("sources", { query: machineId ? { machine_id: machineId } : undefined })).items;
  }
  async createSource(input: CreateSourceInput): Promise<Source> {
    // The cloud owns the machine registry, so the local machine id is dropped
    // and the server assigns the owning machine.
    return this.client.create<Source>("sources", { ...input, machine_id: undefined });
  }
  async getSource(id: string): Promise<Source | null> {
    return this.client.get<Source>("sources", id);
  }
  async updateSource(id: string, patch: UpdateSourceInput): Promise<Source | null> {
    return orNull(this.client.update<Source>("sources", id, patch));
  }
  async deleteSource(id: string): Promise<boolean> {
    return deletedOk(this.http.del(`/sources/${seg(id)}`));
  }

  // ── machines ───────────────────────────────────────────────────────────────
  async listMachines(): Promise<Machine[]> {
    return (await this.client.list<Machine>("machines")).items;
  }
  async currentMachine(): Promise<Machine> {
    return this.http.get<Machine>("/machines/current");
  }

  // ── files ────────────────────────────────────────────────────────────────
  async listFiles(opts: ListFilesOptions = {}): Promise<FileWithTags[]> {
    // The cloud /v1/files endpoint filters on this subset; richer local-only
    // filters (tag/collection/project/date/size/sort) are not part of the API
    // contract and are intentionally omitted rather than silently ignored.
    return (await this.client.list<FileWithTags>("files", {
      query: {
        source_id: opts.source_id,
        machine_id: opts.machine_id,
        ext: opts.ext,
        status: opts.status,
        limit: opts.limit,
        offset: opts.offset,
      },
    })).items;
  }
  async getFile(id: string): Promise<FileWithTags | null> {
    return this.client.get<FileWithTags>("files", id);
  }
  async getFileByPath(sourceId: string, path: string): Promise<FileWithTags | null> {
    return orNull(this.http.get<FileWithTags>("/files/by-path", { query: { source_id: sourceId, path } }));
  }
  async searchFiles(query: string, opts: Omit<ListFilesOptions, "query"> = {}): Promise<SearchResult[]> {
    // The cloud /v1/files endpoint exposes a substring `q` filter; results are
    // returned as SearchResult (rank defaulted — FTS ranking is local-only).
    const files = (await this.client.list<FileWithTags>("files", {
      query: {
        q: query,
        source_id: opts.source_id,
        machine_id: opts.machine_id,
        ext: opts.ext,
        limit: opts.limit,
        offset: opts.offset,
      },
    })).items;
    return files.map((f) => ({ ...f, rank: 0 }));
  }
  async recentFiles(agentId?: string, limit = 20): Promise<RecentFile[]> {
    return this.http.get<RecentFile[]>("/files/recent", { query: { agent_id: agentId, limit } });
  }
  async findDuplicates(sourceId?: string): Promise<DuplicateGroup[]> {
    return this.http.get<DuplicateGroup[]>("/files/duplicates", { query: { source_id: sourceId } });
  }
  async getStats(): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>("/stats");
  }
  async annotateFile(fileId: string, description: string): Promise<FileWithTags | null> {
    return orNull(this.http.patch<FileWithTags>(`/files/${seg(fileId)}`, { description }));
  }
  async moveFile(fileId: string, destPath: string): Promise<boolean> {
    await this.http.post(`/files/${seg(fileId)}/move`, { dest_path: destPath });
    return true;
  }
  async renameFile(fileId: string, newName: string, ext: string): Promise<string | null> {
    const res = await orNull(this.http.post<{ ok: boolean; canonical: string }>(`/files/${seg(fileId)}/rename`, { new_name: newName, ext }));
    return res ? res.canonical : null;
  }
  async softDeleteFile(fileId: string): Promise<boolean> {
    await this.http.del(`/files/${seg(fileId)}`);
    return true;
  }
  async restoreFile(fileId: string): Promise<boolean> {
    return (await orNull(this.http.post(`/files/${seg(fileId)}/restore`))) !== null;
  }
  async purgeDeleted(sourceId?: string, olderThan?: string): Promise<number> {
    const res = await this.http.post<{ purged: number }>("/files/purge", { source_id: sourceId, older_than: olderThan });
    return res.purged;
  }
  async normalizeSource(sourceId: string): Promise<number> {
    const res = await this.http.post<{ normalized: number }>(`/sources/${seg(sourceId)}/normalize`);
    return res.normalized;
  }
  async listConflicts(sourceId?: string, limit = 50): Promise<FileWithTags[]> {
    return this.http.get<FileWithTags[]>("/files/conflicts", { query: { source_id: sourceId, limit } });
  }
  async resolveConflict(fileId: string): Promise<boolean> {
    return (await orNull(this.http.post(`/files/${seg(fileId)}/resolve-conflict`))) !== null;
  }

  // ── tags ─────────────────────────────────────────────────────────────────
  async listTags(): Promise<Tag[]> {
    return (await this.client.list<Tag>("tags")).items;
  }
  async tagFile(fileId: string, tag: string): Promise<void> {
    await this.http.post(`/files/${seg(fileId)}/tags`, { tags: [tag] });
  }
  async untagFile(fileId: string, tag: string): Promise<void> {
    await this.http.del(`/files/${seg(fileId)}/tags`, { tags: [tag] });
  }
  async deleteTag(id: string): Promise<boolean> {
    return deletedOk(this.http.del(`/tags/${seg(id)}`));
  }

  // ── collections ────────────────────────────────────────────────────────────
  async listCollections(_parentId?: string): Promise<Collection[]> {
    // The cloud /v1/collections endpoint has no parent filter; it is a
    // LocalStore-only refinement and intentionally not forwarded.
    return (await this.client.list<Collection>("collections")).items;
  }
  async getCollection(id: string): Promise<CollectionDetail | null> {
    return this.client.get<CollectionDetail>("collections", id);
  }
  async createCollection(name: string, description?: string, opts?: CreateCollectionOptions): Promise<Collection> {
    return this.client.create<Collection>("collections", {
      name,
      description,
      parent_id: opts?.parent_id,
      auto_rules: opts?.auto_rules,
    });
  }
  async updateCollection(id: string, patch: UpdateCollectionInput): Promise<Collection | null> {
    return orNull(this.client.update<Collection>("collections", id, patch));
  }
  async deleteCollection(id: string): Promise<boolean> {
    return deletedOk(this.http.del(`/collections/${seg(id)}`));
  }
  async getOrCreateCollection(name: string, description?: string): Promise<Collection> {
    return this.http.post<Collection>("/collections/get-or-create", { name, description });
  }
  async autoPopulateCollection(id: string): Promise<number> {
    const res = await this.http.post<{ added: number }>(`/collections/${seg(id)}/auto-populate`);
    return res.added;
  }
  async addToCollection(collectionId: string, fileId: string): Promise<void> {
    await this.http.post(`/collections/${seg(collectionId)}/files`, { file_id: fileId });
  }
  async removeFromCollection(collectionId: string, fileId: string): Promise<void> {
    await this.client.delete(`collections/${seg(collectionId)}/files`, fileId);
  }

  // ── projects ───────────────────────────────────────────────────────────────
  async listProjects(_status?: string): Promise<Project[]> {
    // The cloud /v1/projects endpoint has no status filter; LocalStore-only.
    return (await this.client.list<Project>("projects")).items;
  }
  async getProject(id: string): Promise<ProjectDetail | null> {
    return this.client.get<ProjectDetail>("projects", id);
  }
  async createProject(name: string, description?: string, opts?: CreateProjectOptions): Promise<Project> {
    return this.client.create<Project>("projects", { name, description, status: opts?.status });
  }
  async updateProject(id: string, patch: UpdateProjectInput): Promise<Project | null> {
    return orNull(this.client.update<Project>("projects", id, patch));
  }
  async deleteProject(id: string): Promise<boolean> {
    return deletedOk(this.http.del(`/projects/${seg(id)}`));
  }
  async getOrCreateProject(name: string, description?: string): Promise<Project> {
    return this.http.post<Project>("/projects/get-or-create", { name, description });
  }
  async addToProject(projectId: string, fileId: string): Promise<void> {
    await this.http.post(`/projects/${seg(projectId)}/files`, { file_id: fileId });
  }
  async removeFromProject(projectId: string, fileId: string): Promise<void> {
    await this.client.delete(`projects/${seg(projectId)}/files`, fileId);
  }

  // ── feedback ─────────────────────────────────────────────────────────────
  async recordFeedback(input: FeedbackInput): Promise<void> {
    await this.http.post("/feedback", input);
  }

  // ── agents ─────────────────────────────────────────────────────────────
  async registerAgent(name: string, sessionId?: string): Promise<Agent> {
    return this.http.post<Agent>("/agents", { name, session_id: sessionId });
  }
  async heartbeatAgent(agentId: string): Promise<Agent | null> {
    return orNull(this.http.post<Agent>(`/agents/${seg(agentId)}/heartbeat`));
  }
  async setAgentFocus(agentId: string, projectId?: string): Promise<Agent | null> {
    return orNull(this.http.post<Agent>(`/agents/${seg(agentId)}/focus`, { project_id: projectId ?? null }));
  }
  async getAgent(agentId: string): Promise<Agent | null> {
    return this.client.get<Agent>("agents", agentId);
  }
  async listAgents(): Promise<Agent[]> {
    return (await this.client.list<Agent>("agents")).items;
  }

  // ── activity ─────────────────────────────────────────────────────────────
  async logActivity(input: LogActivityInput): Promise<void> {
    await this.http.post("/activity", input);
  }
  async getFileHistory(fileId: string, opts: ActivityQueryOptions = {}): Promise<AgentActivity[]> {
    return this.http.get<AgentActivity[]>(`/files/${seg(fileId)}/history`, { query: this.activityQuery(opts) });
  }
  async getAgentActivity(agentId: string, opts: ActivityQueryOptions = {}): Promise<AgentActivity[]> {
    return this.http.get<AgentActivity[]>(`/agents/${seg(agentId)}/activity`, { query: this.activityQuery(opts) });
  }
  async getSessionActivity(sessionId: string, opts: ActivityQueryOptions = {}): Promise<AgentActivity[]> {
    return this.http.get<AgentActivity[]>(`/sessions/${seg(sessionId)}/activity`, { query: this.activityQuery(opts) });
  }

  private activityQuery(opts: ActivityQueryOptions): Record<string, string | number | undefined> {
    return { after: opts.after, before: opts.before, action: opts.action, limit: opts.limit, offset: opts.offset };
  }

  // ── evidence ───────────────────────────────────────────────────────────────
  // Storage (S3 bucket/creds) is owned by the self-hosted service; the `storage`
  // overrides are intentionally NOT forwarded — a thin api client can never
  // redirect the shared vault. Bytes go to the server-signed URL directly.
  async createEvidenceUploadIntent(input: CreateEvidenceUploadInput, _storage?: EvidenceStorageOptions): Promise<EvidenceUploadResult> {
    try {
      const raw = await this.http.post<unknown>("/evidence/upload-intents", input);
      return parseCreateEvidenceUploadResult(raw, input);
    } catch (error) {
      throw sanitizeEvidenceTransportError(error);
    }
  }
  async uploadEvidenceFile(input: UploadEvidenceFileInput, _storage?: EvidenceStorageOptions): Promise<EvidenceUploadResult> {
    try {
      if (!existsSync(input.path)) throw new Error(`File not found: ${input.path}`);
      const bytes = readFileSync(input.path);
      const { path: _path, original_name, ...rest } = input;
      const created = await this.createEvidenceUploadIntent({
        ...rest,
        original_name: original_name ?? basename(input.path),
        content_type: (mimeLookup(input.path) || "application/octet-stream").toString(),
        size: bytes.byteLength,
        checksum: sha256Buffer(bytes),
        checksum_algorithm: "sha256",
      });
      const { asset: createdAsset, intent } = created;
      if (!intent.upload_url) throw new Error("Server did not return an evidence upload URL");
      let res: Response;
      try {
        res = await fetch(intent.upload_url, {
          method: intent.method,
          headers: intent.required_headers,
          body: bytes,
          redirect: "error",
        });
      } catch {
        // Fetch implementations can echo rejected header values and URLs. Do
        // not replay the external exception across an agent-facing boundary.
        throw new Error("Evidence byte upload transport failed before completion");
      }
      if (!res.ok) throw new Error(`Evidence byte upload failed with HTTP ${res.status}`);
      const completedAsset = await this.completeEvidenceUpload(intent.id);
      assertCompletedEvidenceBinding(createdAsset, intent, completedAsset);
      return withoutEvidenceUploadTransport({
        asset: completedAsset,
        intent: {
          ...intent,
          status: "completed",
          completed_at: completedAsset.verified_at ?? completedAsset.updated_at,
        },
      });
    } catch (error) {
      throw sanitizeEvidenceTransportError(error);
    }
  }
  async completeEvidenceUpload(intentId: string, _storage?: EvidenceStorageOptions): Promise<FileAsset> {
    try {
      const raw = await this.http.post<unknown>(`/evidence/upload-intents/${seg(intentId)}/complete`);
      return parseCompletedEvidenceAsset(raw);
    } catch (error) {
      throw sanitizeEvidenceTransportError(error);
    }
  }
  async linkEvidenceAsset(input: CreateFileLinkInput): Promise<FileLink> {
    const { asset_id, ...rest } = input;
    return this.http.post<FileLink>(`/evidence/assets/${seg(asset_id)}/links`, rest);
  }
  async signEvidenceDownload(input: SignEvidenceDownloadInput, _storage?: EvidenceStorageOptions): Promise<EvidenceDownloadGrant> {
    const { asset_id, ...rest } = input;
    return this.http.post<EvidenceDownloadGrant>(`/evidence/assets/${seg(asset_id)}/sign-download`, rest);
  }
  async verifyEvidenceAsset(assetId: string, _storage?: EvidenceStorageOptions): Promise<EvidenceVerifyResult> {
    return this.http.post<EvidenceVerifyResult>(`/evidence/assets/${seg(assetId)}/verify`);
  }
  async listEvidenceAssets(opts: ListFileAssetsOptions = {}): Promise<FileAsset[]> {
    return this.http.get<FileAsset[]>("/evidence/assets", {
      query: {
        org_id: opts.org_id,
        company_id: opts.company_id,
        app: opts.app,
        kind: opts.kind,
        status: opts.status,
        checksum: opts.checksum,
        limit: opts.limit,
        offset: opts.offset,
      },
    });
  }
  async getEvidenceAsset(id: string): Promise<FileAsset | null> {
    return orNull(this.http.get<FileAsset>(`/evidence/assets/${seg(id)}`));
  }
  async listEvidenceLinks(assetId: string): Promise<FileLink[]> {
    return this.http.get<FileLink[]>(`/evidence/assets/${seg(assetId)}/links`);
  }
  async listEvidenceAccessEvents(assetId: string, limit = 50): Promise<FileAccessEvent[]> {
    return this.http.get<FileAccessEvent[]>(`/evidence/assets/${seg(assetId)}/access-events`, { query: { limit } });
  }
}

function parseCreateEvidenceUploadResult(raw: unknown, input: CreateEvidenceUploadInput): EvidenceUploadResult {
  const parsed = createEvidenceUploadResultSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid evidence upload intent response");
  const result = parsed.data as EvidenceUploadResult;
  const { asset, intent } = result;
  const expectedAlgorithm = input.checksum_algorithm ?? "sha256";
  const expectedClassification = input.classification ?? "evidence";
  const expectedContentType = input.content_type ?? (mimeLookup(input.original_name) || "application/octet-stream").toString();
  const requestedLifetimeMs = (input.expires_in_seconds ?? 600) * 1000;

  if (
    asset.status !== "pending_upload"
    || asset.scan_status !== "pending"
    || asset.org_id !== input.org_id
    || asset.company_id !== input.company_id
    || asset.app !== input.app
    || asset.kind !== input.kind
    || asset.classification !== expectedClassification
    || asset.original_name !== input.original_name
    || asset.content_type !== expectedContentType
    || asset.size !== input.size
    || asset.checksum !== input.checksum
    || asset.checksum_algorithm !== expectedAlgorithm
    || asset.storage_provider !== "s3"
    || !asset.bucket
    || !asset.region
    || !asset.quarantine_key
    || !isSafeS3ObjectKey(asset.object_key)
    || !isSafeS3ObjectKey(asset.quarantine_key)
    || asset.retention_until !== input.retention_until
    || asset.retention_policy !== input.retention_policy
    || asset.storage_class !== input.storage_class
    || asset.legal_hold !== (input.legal_hold ?? false)
    || asset.immutable !== (input.immutable ?? false)
    || !sameJson(asset.metadata, input.metadata ?? {})
    || !isTimestamp(asset.created_at)
    || !isTimestamp(asset.updated_at)
    || Date.parse(asset.updated_at) < Date.parse(asset.created_at)
    || intent.asset_id !== asset.id
    || intent.status !== "pending"
    || intent.expected_size !== input.size
    || intent.expected_checksum !== input.checksum
    || intent.expected_checksum_algorithm !== expectedAlgorithm
    || Object.keys(intent.metadata).length !== 0
    || intent.completed_at !== undefined
    || !isTimestamp(intent.created_at)
    || !isFutureTimestamp(intent.expires_at)
    || Date.parse(intent.expires_at) <= Date.parse(intent.created_at)
    || Date.parse(intent.expires_at) - Date.parse(intent.created_at) > requestedLifetimeMs + 5_000
    || !isPermittedUploadUrl(intent.upload_url!, asset)
  ) {
    throw new Error("Invalid evidence upload intent response");
  }

  validateEvidenceUploadHeaders(intent.required_headers, asset);
  return result;
}

function parseCompletedEvidenceAsset(raw: unknown): FileAsset {
  const parsed = fileAssetSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid evidence upload completion response");
  const asset = parsed.data as FileAsset;
  if (
    asset.status !== "verified"
    || (asset.scan_status !== "clean" && asset.scan_status !== "skipped")
    || !asset.verified_at
    || !isTimestamp(asset.created_at)
    || !isTimestamp(asset.updated_at)
    || !isTimestamp(asset.verified_at)
    || Date.parse(asset.updated_at) < Date.parse(asset.created_at)
    || Date.parse(asset.verified_at) < Date.parse(asset.created_at)
  ) {
    throw new Error("Invalid evidence upload completion response");
  }
  return asset;
}

function assertCompletedEvidenceBinding(created: FileAsset, intent: FileUploadIntent, completed: FileAsset): void {
  if (
    completed.id !== intent.asset_id
    || completed.id !== created.id
    || completed.org_id !== created.org_id
    || completed.company_id !== created.company_id
    || completed.app !== created.app
    || completed.kind !== created.kind
    || completed.classification !== created.classification
    || completed.original_name !== created.original_name
    || completed.content_type !== created.content_type
    || completed.size !== intent.expected_size
    || completed.size !== created.size
    || completed.checksum !== intent.expected_checksum
    || completed.checksum !== created.checksum
    || completed.checksum_algorithm !== intent.expected_checksum_algorithm
    || completed.checksum_algorithm !== created.checksum_algorithm
    || completed.storage_provider !== created.storage_provider
    || completed.bucket !== created.bucket
    || completed.region !== created.region
    || completed.object_key !== created.object_key
    || completed.quarantine_key !== created.quarantine_key
    || completed.retention_until !== created.retention_until
    || completed.retention_policy !== created.retention_policy
    || completed.storage_class !== created.storage_class
    || completed.legal_hold !== created.legal_hold
    || completed.immutable !== created.immutable
    || !sameJson(completed.metadata, created.metadata)
    || completed.created_at !== created.created_at
  ) {
    throw new Error("Invalid evidence upload completion response");
  }
}

function validateEvidenceUploadHeaders(headers: Record<string, string>, asset: FileAsset): void {
  const expected = new Map<string, string>([
    ["content-type", asset.content_type],
    ["x-amz-checksum-sha256", Buffer.from(asset.checksum, "hex").toString("base64")],
    ["x-amz-meta-asset-id", asset.id],
    ["x-amz-meta-org-id", asset.org_id],
    ["x-amz-meta-app", asset.app],
    ["x-amz-meta-kind", asset.kind],
    ["x-amz-meta-checksum", asset.checksum],
    ["x-amz-meta-checksum-algorithm", asset.checksum_algorithm],
  ]);
  const received = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (
      received.has(normalized)
      || !expected.has(normalized)
      || typeof value !== "string"
      || value.length > 4096
      || /[\0\r\n]/.test(value)
      || value !== expected.get(normalized)
    ) {
      throw new Error("Invalid evidence upload intent response");
    }
    received.set(normalized, value);
  }
  if (received.size !== expected.size) throw new Error("Invalid evidence upload intent response");
}

function isPermittedUploadUrl(value: string, asset: FileAsset): boolean {
  if (value.length > 8192 || /[\0\r\n]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (!asset.bucket || !asset.region || !asset.quarantine_key) return false;
    const bucket = asset.bucket.toLowerCase();
    if (asset.bucket !== bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return false;
    if (!configuredEvidenceUploadBuckets().has(bucket)) return false;
    if (!/^[a-z0-9-]{3,32}$/.test(asset.region)) return false;
    const decodedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const key = asset.quarantine_key;
    const directPath = decodedPath === key;
    const pathStyle = decodedPath === `${bucket}/${key}`;
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    const configured = configuredEvidenceUploadOrigins();
    if (configured.has(url.origin)) {
      if (url.protocol === "https:") return directPath || pathStyle;
      return url.protocol === "http:"
        && loopback
        && allowInsecureEvidenceLoopback()
        && (directPath || pathStyle);
    }
    if (url.protocol !== "https:") return false;
    if (url.port) return false;
    const host = url.hostname.toLowerCase();
    const domain = asset.region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
    const virtualHosts = new Set([
      `${bucket}.s3.${asset.region}.${domain}`,
      `${bucket}.s3-${asset.region}.${domain}`,
      `${bucket}.s3.dualstack.${asset.region}.${domain}`,
      `${bucket}.s3.${domain}`,
    ]);
    if (virtualHosts.has(host)) return directPath;
    const pathHosts = new Set([
      `s3.${asset.region}.${domain}`,
      `s3-${asset.region}.${domain}`,
      `s3.dualstack.${asset.region}.${domain}`,
      `s3.${domain}`,
    ]);
    return pathHosts.has(host) && pathStyle;
  } catch {
    return false;
  }
}

function configuredEvidenceUploadOrigins(): Set<string> {
  const raw = process.env.HASNA_FILES_EVIDENCE_UPLOAD_ORIGINS ?? process.env.FILES_EVIDENCE_UPLOAD_ORIGINS ?? "";
  const origins = new Set<string>();
  for (const candidate of raw.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:") origins.add(url.origin);
      else if (
        url.protocol === "http:"
        && allowInsecureEvidenceLoopback()
        && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ) origins.add(url.origin);
    } catch {}
  }
  return origins;
}

function configuredEvidenceUploadBuckets(): Set<string> {
  const raw = [
    DEFAULT_EVIDENCE_S3_BUCKET,
    process.env.HASNA_FILES_EVIDENCE_UPLOAD_BUCKETS,
    process.env.FILES_EVIDENCE_UPLOAD_BUCKETS,
    process.env.HASNA_FILES_S3_BUCKET,
    process.env.FILES_S3_BUCKET,
    process.env.HASNA_FILES_EVIDENCE_BUCKET,
    process.env.FILES_EVIDENCE_BUCKET,
  ].filter(Boolean).join(",");
  return new Set(raw.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

function allowInsecureEvidenceLoopback(): boolean {
  return (process.env.HASNA_FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK
    ?? process.env.FILES_EVIDENCE_ALLOW_INSECURE_LOOPBACK) === "1";
}

function isFutureTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function isTimestamp(value: string): boolean {
  return SAFE_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function isSafeS3ObjectKey(value: string): boolean {
  if (!value || value.length > 1024 || value.startsWith("/") || /[\0\r\n]/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }
  return value;
}
