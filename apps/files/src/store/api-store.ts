/**
 * Hosted HTTP transport for {@link FilesStore}. Routes every data-plane call to
 * the files service at `<API_URL>/v1` through the @hasna/contracts storage
 * client (bearer key in the transport only — never a database DSN, never
 * logged). The URL/key are the only difference between deployments — a
 * server-side tenancy concern, not a client one.
 *
 * The CRUD verbs (list/get/create/update/delete) cover top-level resources; the
 * transport escape hatch handles the sub-resource + action routes the CRUD
 * shape cannot express, matching the `/v1` route table in `src/server/v1.ts`.
 */
import { existsSync, readFileSync, statSync } from "fs";
import { basename } from "path";
import { lookup as mimeLookup } from "mime-types";
import type { FilesStorageClient } from "./client-types.js";
import { HasnaHttpError } from "@hasna/contracts/client";
import { sha256File } from "../lib/hasher.js";
import { FILES_API_MAX_PAGE_SIZE } from "../lib/api-pagination.js";
import type {
  Agent,
  AgentActivity,
  Collection,
  CreateFileLinkInput,
  DuplicateGroup,
  FileAccessEvent,
  FileAsset,
  FileLink,
  FileSearchDocument,
  FileSearchDocumentKind,
  FileWithTags,
  ListFileSearchDocumentsOptions,
  ListFilesOptions,
  Machine,
  Project,
  SearchMatchSource,
  SearchResult,
  Source,
  Tag,
  UpsertFileSearchDocumentInput,
  ExtractedTextResult,
} from "../types/index.js";
import type { AuthenticatedFilesFetch } from "../lib/cloud-storage.js";
import {
  redactEvidenceUploadCredentials,
  type CreateEvidenceUploadInput,
  type EvidenceCredentialOutputOptions,
  type EvidenceDownloadGrant,
  type EvidenceStorageOptions,
  type EvidenceUploadResult,
  type EvidenceVerifyResult,
  type SignEvidenceDownloadInput,
  type UploadEvidenceFileInput,
} from "../lib/evidence.js";
import type { ListFileAssetsOptions } from "../db/evidence.js";
import type {
  ActivityQueryOptions,
  CollectionDetail,
  CreateCollectionOptions,
  CreateFileUploadInput,
  CreateProjectOptions,
  CreateSourceInput,
  FeedbackInput,
  FileUploadIntent,
  FileUploadResult,
  FilesStore,
  LogActivityInput,
  ProjectDetail,
  RecentFile,
  UpdateCollectionInput,
  UpdateProjectInput,
  UpdateSourceInput,
  UploadFileInput,
} from "./types.js";

const seg = (value: string): string => encodeURIComponent(value);

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

/** A server search-result row: the file plus the optional per-row search fields. */
type RankedFilePayload = FileWithTags & {
  rank?: number;
  search_match_sources?: SearchMatchSource[];
  search_document_kinds?: FileSearchDocumentKind[];
  search_document_count?: number;
};

export class ApiStore implements FilesStore {
  readonly transport = "api" as const;

  constructor(
    private readonly client: FilesStorageClient,
    private readonly fetchContent?: AuthenticatedFilesFetch,
  ) {}

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
    // The cloud /v1/files endpoint now implements the full local filter surface:
    // collection/date/size/sort are part of the API contract (server-side
    // WHERE + ORDER BY), so they are forwarded — never dropped on the floor.
    const listPage = async (limit: number | undefined, offset: number | undefined) => (
      await this.client.list<FileWithTags>("files", {
        query: {
          source_id: opts.source_id,
          machine_id: opts.machine_id,
          project_id: opts.project_id,
          collection_id: opts.collection_id,
          tag: opts.tag,
          ext: opts.ext,
          status: opts.status,
          after: opts.after,
          before: opts.before,
          min_size: opts.min_size,
          max_size: opts.max_size,
          sort: opts.sort,
          sort_dir: opts.sort_dir,
          limit,
          offset,
        },
      })
    ).items;

    const requestedLimit = opts.limit;
    if (
      requestedLimit === undefined
      || !Number.isInteger(requestedLimit)
      || requestedLimit <= FILES_API_MAX_PAGE_SIZE
    ) {
      return listPage(requestedLimit, opts.offset);
    }

    // `/v1/files` is intentionally bounded per request. Older deployed
    // servers silently clamped an oversized page to 500; current servers
    // reject it. In both cases, asking once made a requested 1000-row logical
    // read either look complete at 500 or fail. Walk bounded pages here and
    // preserve the public result contract: callers still receive one array
    // containing at most the count they requested.
    const files: FileWithTags[] = [];
    let offset = opts.offset ?? 0;
    while (files.length < requestedLimit) {
      const pageLimit = Math.min(FILES_API_MAX_PAGE_SIZE, requestedLimit - files.length);
      const page = await listPage(pageLimit, offset);
      files.push(...page.slice(0, requestedLimit - files.length));
      if (page.length < pageLimit) break;
      offset += page.length;
    }
    return files;
  }
  async getFile(id: string): Promise<FileWithTags | null> {
    return this.client.get<FileWithTags>("files", id);
  }
  async getFileByPath(sourceId: string, path: string): Promise<FileWithTags | null> {
    return orNull(this.http.get<FileWithTags>("/files/by-path", { query: { source_id: sourceId, path } }));
  }
  async searchFiles(query: string, opts: Omit<ListFilesOptions, "query"> = {}): Promise<SearchResult[]> {
    // The cloud /v1/files endpoint serves ranked search over BOTH surfaces:
    // metadata (name/path/mime/canonical/description tsvector + ILIKE) and the
    // server-side derived-content index (file_search_documents tsvector). The
    // `search_scope` and every search filter reach the server; the server's
    // per-row rank and match sources pass through unchanged.
    const files = (await this.client.list<RankedFilePayload>("files", {
      query: {
        q: query,
        search_scope: opts.search_scope ?? "all",
        source_id: opts.source_id,
        machine_id: opts.machine_id,
        ext: opts.ext,
        tag: opts.tag,
        limit: opts.limit,
        offset: opts.offset,
      },
    })).items;
    return files.map((f) => ({
      ...f,
      // The server stamps rank + match sources per row. A row without them is
      // a truthful metadata-only result, never an implied content match.
      rank: f.rank ?? 0,
      search_match_sources: f.search_match_sources ?? ["metadata"],
    }));
  }

  async upsertSearchDocument(input: UpsertFileSearchDocumentInput): Promise<FileSearchDocument> {
    const { file_id, ...rest } = input;
    return this.http.post<FileSearchDocument>(`/files/${seg(file_id)}/search-documents`, rest);
  }
  async listSearchDocuments(opts: ListFileSearchDocumentsOptions = {}): Promise<FileSearchDocument[]> {
    return this.http.get<FileSearchDocument[]>("/search-documents", {
      query: {
        file_id: opts.file_id,
        kind: opts.kind,
        status: opts.status,
        limit: opts.limit,
        offset: opts.offset,
      },
    });
  }
  async deleteSearchDocument(id: string): Promise<boolean> {
    // The document id is opaque (fsd_...); the owning file cannot be derived
    // from it client-side, so the server route is id-only.
    return deletedOk(this.http.del(`/search-documents/${seg(id)}`));
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

  async downloadFileContent(
    fileId: string,
    write: (chunk: Uint8Array) => void | Promise<void>,
    options: { max_bytes?: number } = {},
  ): Promise<{ truncated: boolean; totalBytes?: number }> {
    if (!this.fetchContent) throw new Error("Authenticated file-content transport is unavailable.");
    const path = `/files/${seg(fileId)}/content`;
    const query = options.max_bytes !== undefined ? `?max_bytes=${Math.max(1, Math.floor(options.max_bytes))}` : "";
    const response = await this.fetchContent(path + query, { method: "GET" });
    if (!response.ok) throw await remoteContentError("GET", path, response);
    if (!response.body) throw new Error("The file-content response was empty.");

    const reader = response.body.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      await write(next.value);
    }

    const sizeHeader = response.headers?.get("x-files-size");
    return {
      truncated: response.headers?.get("x-files-truncated") === "1",
      totalBytes: sizeHeader !== null ? Number(sizeHeader) : undefined,
    };
  }

  async extractFileText(
    fileId: string,
    input: {
      max_bytes?: number;
      max_segment_chars?: number;
      redact_patterns?: string[];
    } = {},
  ): Promise<ExtractedTextResult> {
    return this.http.post<ExtractedTextResult>(`/files/${seg(fileId)}/extract-text`, input);
  }

  /** Server-signed S3 download URL for a hosted file (the server owns the
   *  object-store credentials; the client never touches S3 in api mode). */
  async signFileDownload(fileId: string, expiresIn = 3600): Promise<string> {
    const res = await this.http.post<{ url: string }>(`/files/${seg(fileId)}/sign-download`, { expires_in: expiresIn });
    return res.url;
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

  // ── ingestion (cloud file records) ────────────────────────────────────────
  /** Stage a hosted file record and sign a server-owned S3 PUT URL. */
  async createFileUploadIntent(input: CreateFileUploadInput): Promise<FileUploadIntent> {
    return this.http.post<FileUploadIntent>("/files", input);
  }
  /** Verify + finalize a staged upload, applying tags and the project link. */
  async completeFileUpload(
    fileId: string,
    input: { tags?: string[]; project_id?: string } = {},
  ): Promise<FileWithTags | null> {
    const res = await orNull(this.http.post<{ file: FileWithTags }>(`/files/${seg(fileId)}/complete`, input));
    return res ? res.file : null;
  }
  /** The seam ingestion: intent -> PUT bytes to the server-owned URL -> complete. */
  async uploadFile(input: UploadFileInput): Promise<FileUploadResult> {
    if (!existsSync(input.path)) throw new Error(`File not found: ${input.path}`);
    const stat = statSync(input.path);
    const name = input.name ?? basename(input.path);
    const mime = (mimeLookup(input.path) || "application/octet-stream").toString();
    const intent = await this.createFileUploadIntent({
      name,
      size: stat.size,
      mime,
      checksum: sha256File(input.path),
      checksum_algorithm: "sha256",
      tags: input.tags,
      project_id: input.project_id,
    });
    const res = await fetch(intent.upload_url, {
      method: intent.method,
      headers: intent.required_headers,
      body: readFileSync(input.path),
    });
    if (!res.ok) throw new Error(`File byte upload failed: ${res.status} ${res.statusText}`);
    const file = await this.completeFileUpload(intent.file_id, { tags: input.tags, project_id: input.project_id });
    if (!file) throw new Error("File upload completion returned no file");
    return { file, replayed: false };
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
  // Storage (S3 bucket/creds) is owned by the files service; the `storage`
  // overrides are intentionally NOT forwarded — a thin hosted client can never
  // redirect the shared vault. Bytes go to the server-signed URL directly.
  async createEvidenceUploadIntent(input: CreateEvidenceUploadInput, _storage?: EvidenceStorageOptions, output?: EvidenceCredentialOutputOptions): Promise<EvidenceUploadResult> {
    return this.http.post<EvidenceUploadResult>("/evidence/upload-intents", {
      ...input,
      ...(output?.includeUploadUrl ? { include_upload_url: true } : {}),
    });
  }
  async uploadEvidenceFile(input: UploadEvidenceFileInput, _storage?: EvidenceStorageOptions): Promise<EvidenceUploadResult> {
    if (!existsSync(input.path)) throw new Error(`File not found: ${input.path}`);
    const stat = statSync(input.path);
    const { path: _path, original_name, ...rest } = input;
    const created = await this.createEvidenceUploadIntent({
      ...rest,
      original_name: original_name ?? basename(input.path),
      content_type: (mimeLookup(input.path) || "application/octet-stream").toString(),
      size: stat.size,
      checksum: sha256File(input.path),
      checksum_algorithm: "sha256",
    }, undefined, { includeUploadUrl: true });
    if (created.replayed && created.asset.status === "verified") {
      return redactEvidenceUploadCredentials(created);
    }
    const { intent } = created;
    if (!intent.upload_url) throw new Error("Server did not return an evidence upload URL");
    const uploadUrl = intent.upload_url;
    const res = await fetch(uploadUrl, {
      method: intent.method,
      headers: intent.required_headers,
      body: readFileSync(input.path),
    });
    if (!res.ok) throw new Error(`Evidence byte upload failed: ${res.status} ${res.statusText}`);
    const asset = await this.completeEvidenceUpload(intent.id);
    return redactEvidenceUploadCredentials({ asset, intent, replayed: created.replayed });
  }
  async completeEvidenceUpload(intentId: string, _storage?: EvidenceStorageOptions): Promise<FileAsset> {
    return this.http.post<FileAsset>(`/evidence/upload-intents/${seg(intentId)}/complete`);
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
        provenance_type: opts.provenance_type,
        provenance_id: opts.provenance_id,
        provenance_ref: opts.provenance_ref,
        version: opts.version,
        classification: opts.classification,
        retention_policy: opts.retention_policy,
        external_reference: opts.external_reference,
        idempotency_key: opts.idempotency_key,
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

async function remoteContentError(method: string, path: string, response: Response): Promise<HasnaHttpError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Private file bytes and provider errors are never reflected into the CLI.
  }
  return new HasnaHttpError(method, path, response.status, body);
}
