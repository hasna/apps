/**
 * On-box SQLite transport for {@link FilesStore}. Delegates to the `db/*`
 * modules (the only place in the client that may touch `bun:sqlite`). Partial
 * ids passed by callers are resolved here so command handlers stay
 * transport-agnostic.
 */
import type {
  Collection,
  DuplicateGroup,
  FileWithTags,
  ListFilesOptions,
  Machine,
  Project,
  ProjectStatus,
  SearchResult,
  Source,
  Tag,
} from "../types/index.js";
import { createSource, deleteSource, getSource, listSources, updateSource } from "../db/sources.js";
import {
  annotateFile,
  computeStats,
  findDuplicates,
  getFile,
  getFileByPath,
  listConflicts,
  listFiles,
  moveFile,
  normalizeSource,
  purgeDeleted,
  recentFiles,
  renameFile,
  resolveConflict,
  restoreFile,
  softDeleteFile,
} from "../db/files.js";
import { searchFiles } from "../db/search.js";
import { deleteTag, listTags, tagFile, untagFile } from "../db/tags.js";
import { getCurrentMachine, listMachines } from "../db/machines.js";
import {
  addToCollection,
  autoPopulateCollection,
  createCollection,
  deleteCollection,
  getCollection,
  getOrCreateCollection,
  listCollections,
  removeFromCollection,
  updateCollection,
} from "../db/collections.js";
import {
  addToProject,
  createProject,
  deleteProject,
  getOrCreateProject,
  getProject,
  listProjects,
  removeFromProject,
  updateProject,
} from "../db/projects.js";
import { recordFeedback } from "../db/feedback.js";
import {
  completeEvidenceUpload,
  createEvidenceUploadIntent,
  linkEvidenceAsset,
  signEvidenceDownload,
  uploadEvidenceFile,
  verifyEvidenceAsset,
  type CreateEvidenceUploadInput,
  type EvidenceDownloadGrant,
  type EvidenceStorageOptions,
  type EvidenceUploadReceipt,
  type EvidenceUploadResult,
  type EvidenceVerifyResult,
  type SignEvidenceDownloadInput,
  type UploadEvidenceFileInput,
} from "../lib/evidence.js";
import {
  getFileAsset,
  listFileAccessEvents,
  listFileAssets,
  listFileLinks,
  type ListFileAssetsOptions,
} from "../db/evidence.js";
import type { CreateFileLinkInput, FileAccessEvent, FileAsset, FileLink } from "../types/index.js";
import { getAgent, listAgents, registerAgent, setAgentFocus, updateAgentHeartbeat } from "../db/agents.js";
import { getAgentActivity, getFileHistory, getSessionActivity, logActivity } from "../db/activity.js";
import { requireId, resolveId } from "../db/resolve.js";
import type { Agent, AgentActivity } from "../types/index.js";
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

export class LocalStore implements FilesStore {
  readonly transport = "local" as const;

  // ── sources ──────────────────────────────────────────────────────────────
  async listSources(machineId?: string): Promise<Source[]> {
    return listSources(machineId);
  }
  async createSource(input: CreateSourceInput): Promise<Source> {
    // machine_id is a LocalStore concern; stamp the on-box machine when the
    // caller omits it so no command needs a `currentMachine()` preflight.
    return createSource({ ...input, machine_id: input.machine_id ?? getCurrentMachine().id });
  }
  async getSource(id: string): Promise<Source | null> {
    const rid = resolveId(id, "sources");
    return rid ? getSource(rid) : null;
  }
  async updateSource(id: string, patch: UpdateSourceInput): Promise<Source | null> {
    return updateSource(requireId(id, "sources"), patch);
  }
  async deleteSource(id: string): Promise<boolean> {
    return deleteSource(requireId(id, "sources"));
  }

  // ── machines ───────────────────────────────────────────────────────────────
  async listMachines(): Promise<Machine[]> {
    return listMachines();
  }
  async currentMachine(): Promise<Machine> {
    return getCurrentMachine();
  }

  // ── files ────────────────────────────────────────────────────────────────
  async listFiles(opts: ListFilesOptions = {}): Promise<FileWithTags[]> {
    return listFiles(opts);
  }
  async getFile(id: string): Promise<FileWithTags | null> {
    const rid = resolveId(id, "files");
    return rid ? getFile(rid) : null;
  }
  async getFileByPath(sourceId: string, path: string): Promise<FileWithTags | null> {
    const rec = getFileByPath(requireId(sourceId, "sources"), path);
    return rec ? getFile(rec.id) : null;
  }
  async searchFiles(query: string, opts: Omit<ListFilesOptions, "query"> = {}): Promise<SearchResult[]> {
    return searchFiles(query, opts);
  }
  async recentFiles(agentId?: string, limit = 20): Promise<RecentFile[]> {
    return recentFiles(agentId, limit);
  }
  async findDuplicates(sourceId?: string): Promise<DuplicateGroup[]> {
    return findDuplicates(sourceId ? requireId(sourceId, "sources") : undefined);
  }
  async getStats(): Promise<Record<string, unknown>> {
    return computeStats();
  }
  async annotateFile(fileId: string, description: string): Promise<FileWithTags | null> {
    const id = requireId(fileId, "files");
    if (!annotateFile(id, description)) return null;
    return getFile(id);
  }
  async moveFile(fileId: string, destPath: string): Promise<boolean> {
    return moveFile(requireId(fileId, "files"), destPath);
  }
  async renameFile(fileId: string, newName: string, ext: string): Promise<string | null> {
    return renameFile(requireId(fileId, "files"), newName, ext);
  }
  async softDeleteFile(fileId: string): Promise<boolean> {
    return softDeleteFile(requireId(fileId, "files"));
  }
  async restoreFile(fileId: string): Promise<boolean> {
    return restoreFile(requireId(fileId, "files"));
  }
  async purgeDeleted(sourceId?: string, olderThan?: string): Promise<number> {
    return purgeDeleted(sourceId ? requireId(sourceId, "sources") : undefined, olderThan);
  }
  async normalizeSource(sourceId: string): Promise<number> {
    return normalizeSource(requireId(sourceId, "sources"));
  }
  async listConflicts(sourceId?: string, limit = 50): Promise<FileWithTags[]> {
    return listConflicts(sourceId ? requireId(sourceId, "sources") : undefined, limit);
  }
  async resolveConflict(fileId: string): Promise<boolean> {
    return resolveConflict(requireId(fileId, "files"));
  }

  // ── tags ─────────────────────────────────────────────────────────────────
  async listTags(): Promise<Tag[]> {
    return listTags();
  }
  async tagFile(fileId: string, tag: string): Promise<void> {
    tagFile(requireId(fileId, "files"), tag);
  }
  async untagFile(fileId: string, tag: string): Promise<void> {
    untagFile(requireId(fileId, "files"), tag);
  }
  async deleteTag(id: string): Promise<boolean> {
    return deleteTag(id);
  }

  // ── collections ────────────────────────────────────────────────────────────
  async listCollections(parentId?: string): Promise<Collection[]> {
    return listCollections(parentId);
  }
  async getCollection(id: string): Promise<CollectionDetail | null> {
    return getCollection(requireId(id, "collections"));
  }
  async createCollection(name: string, description?: string, opts?: CreateCollectionOptions): Promise<Collection> {
    return createCollection(name, description, opts);
  }
  async updateCollection(id: string, patch: UpdateCollectionInput): Promise<Collection | null> {
    return updateCollection(requireId(id, "collections"), patch);
  }
  async deleteCollection(id: string): Promise<boolean> {
    return deleteCollection(requireId(id, "collections"));
  }
  async getOrCreateCollection(name: string, description?: string): Promise<Collection> {
    return getOrCreateCollection(name, description);
  }
  async autoPopulateCollection(id: string): Promise<number> {
    return autoPopulateCollection(requireId(id, "collections"));
  }
  async addToCollection(collectionId: string, fileId: string): Promise<void> {
    addToCollection(requireId(collectionId, "collections"), requireId(fileId, "files"));
  }
  async removeFromCollection(collectionId: string, fileId: string): Promise<void> {
    removeFromCollection(requireId(collectionId, "collections"), requireId(fileId, "files"));
  }

  // ── projects ───────────────────────────────────────────────────────────────
  async listProjects(status?: ProjectStatus): Promise<Project[]> {
    return listProjects(status);
  }
  async getProject(id: string): Promise<ProjectDetail | null> {
    return getProject(requireId(id, "projects"));
  }
  async createProject(name: string, description?: string, opts?: CreateProjectOptions): Promise<Project> {
    return createProject(name, description, opts);
  }
  async updateProject(id: string, patch: UpdateProjectInput): Promise<Project | null> {
    return updateProject(requireId(id, "projects"), patch);
  }
  async deleteProject(id: string): Promise<boolean> {
    return deleteProject(requireId(id, "projects"));
  }
  async getOrCreateProject(name: string, description?: string): Promise<Project> {
    return getOrCreateProject(name, description);
  }
  async addToProject(projectId: string, fileId: string): Promise<void> {
    addToProject(requireId(projectId, "projects"), requireId(fileId, "files"));
  }
  async removeFromProject(projectId: string, fileId: string): Promise<void> {
    removeFromProject(requireId(projectId, "projects"), requireId(fileId, "files"));
  }

  // ── feedback ─────────────────────────────────────────────────────────────
  async recordFeedback(input: FeedbackInput): Promise<void> {
    recordFeedback(input);
  }

  // ── agents ─────────────────────────────────────────────────────────────
  async registerAgent(name: string, sessionId?: string): Promise<Agent> {
    return registerAgent(name, sessionId);
  }
  async heartbeatAgent(agentId: string): Promise<Agent | null> {
    return updateAgentHeartbeat(agentId);
  }
  async setAgentFocus(agentId: string, projectId?: string): Promise<Agent | null> {
    return setAgentFocus(agentId, projectId ? requireId(projectId, "projects") : undefined);
  }
  async getAgent(agentId: string): Promise<Agent | null> {
    return getAgent(agentId);
  }
  async listAgents(): Promise<Agent[]> {
    return listAgents();
  }

  // ── activity ─────────────────────────────────────────────────────────────
  async logActivity(input: LogActivityInput): Promise<void> {
    logActivity(input);
  }
  async getFileHistory(fileId: string, opts: ActivityQueryOptions = {}): Promise<AgentActivity[]> {
    return getFileHistory(requireId(fileId, "files"), opts);
  }
  async getAgentActivity(agentId: string, opts: ActivityQueryOptions = {}): Promise<AgentActivity[]> {
    return getAgentActivity(agentId, opts);
  }
  async getSessionActivity(sessionId: string, opts: ActivityQueryOptions = {}): Promise<AgentActivity[]> {
    return getSessionActivity(sessionId, opts);
  }

  // ── evidence ───────────────────────────────────────────────────────────────
  // Uses the default (sqlite) evidence DB seam; bytes on local disk / S3.
  async createEvidenceUploadIntent(input: CreateEvidenceUploadInput, storage?: EvidenceStorageOptions): Promise<EvidenceUploadResult> {
    return createEvidenceUploadIntent(input, storage);
  }
  async uploadEvidenceFile(input: UploadEvidenceFileInput, storage?: EvidenceStorageOptions): Promise<EvidenceUploadReceipt> {
    return uploadEvidenceFile(input, storage);
  }
  async completeEvidenceUpload(intentId: string, storage?: EvidenceStorageOptions): Promise<FileAsset> {
    return completeEvidenceUpload(intentId, storage);
  }
  async linkEvidenceAsset(input: CreateFileLinkInput): Promise<FileLink> {
    return linkEvidenceAsset(input);
  }
  async signEvidenceDownload(input: SignEvidenceDownloadInput, storage?: EvidenceStorageOptions): Promise<EvidenceDownloadGrant> {
    return signEvidenceDownload(input, storage);
  }
  async verifyEvidenceAsset(assetId: string, storage?: EvidenceStorageOptions): Promise<EvidenceVerifyResult> {
    return verifyEvidenceAsset(assetId, storage);
  }
  async listEvidenceAssets(opts: ListFileAssetsOptions = {}): Promise<FileAsset[]> {
    return listFileAssets(opts);
  }
  async getEvidenceAsset(id: string): Promise<FileAsset | null> {
    return getFileAsset(id);
  }
  async listEvidenceLinks(assetId: string): Promise<FileLink[]> {
    return listFileLinks(assetId);
  }
  async listEvidenceAccessEvents(assetId: string, limit = 50): Promise<FileAccessEvent[]> {
    return listFileAccessEvents(assetId, limit);
  }
}
