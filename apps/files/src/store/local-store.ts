/**
 * On-box SQLite transport for {@link FilesStore}. Delegates to the `db/*`
 * modules (the only place in the client that may touch `bun:sqlite`). Partial
 * ids passed by callers are resolved here so command handlers stay
 * transport-agnostic.
 */
import type {
  Collection,
  FileWithTags,
  ListFilesOptions,
  Machine,
  Project,
  ProjectStatus,
  Source,
  Tag,
} from "../types/index.js";
import { createSource, deleteSource, getSource, listSources } from "../db/sources.js";
import { getFile, listFiles } from "../db/files.js";
import { listTags, tagFile, untagFile } from "../db/tags.js";
import { addToCollection, createCollection, listCollections, removeFromCollection } from "../db/collections.js";
import { addToProject, createProject, listProjects, removeFromProject } from "../db/projects.js";
import { listMachines } from "../db/machines.js";
import { requireId, resolveId } from "../db/resolve.js";
import type { CreateCollectionOptions, CreateProjectOptions, CreateSourceInput, FilesStore } from "./types.js";

export class LocalStore implements FilesStore {
  readonly transport = "local" as const;

  async listSources(machineId?: string): Promise<Source[]> {
    return listSources(machineId);
  }
  async createSource(input: CreateSourceInput): Promise<Source> {
    return createSource(input);
  }
  async getSource(id: string): Promise<Source | null> {
    const rid = resolveId(id, "sources");
    return rid ? getSource(rid) : null;
  }
  async deleteSource(id: string): Promise<boolean> {
    return deleteSource(requireId(id, "sources"));
  }

  async listFiles(opts: ListFilesOptions = {}): Promise<FileWithTags[]> {
    return listFiles(opts);
  }
  async getFile(id: string): Promise<FileWithTags | null> {
    const rid = resolveId(id, "files");
    return rid ? getFile(rid) : null;
  }
  async tagFile(fileId: string, tag: string): Promise<void> {
    tagFile(requireId(fileId, "files"), tag);
  }
  async untagFile(fileId: string, tag: string): Promise<void> {
    untagFile(requireId(fileId, "files"), tag);
  }

  async listTags(): Promise<Tag[]> {
    return listTags();
  }

  async listCollections(parentId?: string): Promise<Collection[]> {
    return listCollections(parentId);
  }
  async createCollection(name: string, description?: string, opts?: CreateCollectionOptions): Promise<Collection> {
    return createCollection(name, description, opts);
  }
  async addToCollection(collectionId: string, fileId: string): Promise<void> {
    addToCollection(requireId(collectionId, "collections"), requireId(fileId, "files"));
  }
  async removeFromCollection(collectionId: string, fileId: string): Promise<void> {
    removeFromCollection(requireId(collectionId, "collections"), requireId(fileId, "files"));
  }

  async listProjects(status?: ProjectStatus): Promise<Project[]> {
    return listProjects(status);
  }
  async createProject(name: string, description?: string, opts?: CreateProjectOptions): Promise<Project> {
    return createProject(name, description, opts);
  }
  async addToProject(projectId: string, fileId: string): Promise<void> {
    addToProject(requireId(projectId, "projects"), requireId(fileId, "files"));
  }
  async removeFromProject(projectId: string, fileId: string): Promise<void> {
    removeFromProject(requireId(projectId, "projects"), requireId(fileId, "files"));
  }

  async listMachines(): Promise<Machine[]> {
    return listMachines();
  }
}
