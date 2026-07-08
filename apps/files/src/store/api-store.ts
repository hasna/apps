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
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import { HasnaHttpError } from "@hasna/contracts/client";
import type {
  Agent,
  AgentActivity,
  Collection,
  DuplicateGroup,
  FileWithTags,
  ListFilesOptions,
  Machine,
  Project,
  SearchResult,
  Source,
  Tag,
} from "../types/index.js";
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

/** Map a 404 from a raw transport route to `null` (matches storage-client get). */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof HasnaHttpError && e.status === 404) return null;
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
    await this.client.delete("sources", id);
    return true;
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
    await this.client.delete("tags", id);
    return true;
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
    await this.client.delete("collections", id);
    return true;
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
    await this.client.delete("projects", id);
    return true;
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
}
