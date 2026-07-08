/**
 * Cloud HTTP transport for {@link FilesStore}. Routes every data-plane call to
 * the self-hosted service at `https://files.hasna.xyz/v1` through the
 * @hasna/contracts storage client (bearer key in the transport only — never a
 * database DSN, never logged). Used identically for `self_hosted` and `cloud`
 * tiers; the only difference is the URL/key, which is a server-side tenancy
 * concern, not a client one.
 *
 * The CRUD verbs (list/get/create/delete) cover top-level resources; the
 * transport escape hatch is used for the two sub-resource routes the CRUD shape
 * cannot express (file tags and collection/project membership), matching the
 * `/v1` route table in `src/server/v1.ts`.
 */
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type {
  Collection,
  FileWithTags,
  ListFilesOptions,
  Machine,
  Project,
  Source,
  Tag,
} from "../types/index.js";
import type { CreateCollectionOptions, CreateProjectOptions, CreateSourceInput, FilesStore } from "./types.js";

const seg = (value: string): string => encodeURIComponent(value);

export class ApiStore implements FilesStore {
  readonly transport = "api" as const;

  constructor(private readonly client: HasnaStorageClient) {}

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
  async deleteSource(id: string): Promise<boolean> {
    await this.client.delete("sources", id);
    return true;
  }

  async listFiles(opts: ListFilesOptions = {}): Promise<FileWithTags[]> {
    // The cloud /v1/files endpoint filters on this subset; richer local-only
    // filters (tag/collection/project/date/size/sort) are not part of the API
    // contract and are intentionally omitted rather than silently ignored.
    return (await this.client.list<FileWithTags>("files", {
      query: {
        source_id: opts.source_id,
        machine_id: opts.machine_id,
        ext: opts.ext,
        limit: opts.limit,
        offset: opts.offset,
      },
    })).items;
  }
  async getFile(id: string): Promise<FileWithTags | null> {
    return this.client.get<FileWithTags>("files", id);
  }
  async tagFile(fileId: string, tag: string): Promise<void> {
    await this.client.transport.post(`/files/${seg(fileId)}/tags`, { tags: [tag] });
  }
  async untagFile(fileId: string, tag: string): Promise<void> {
    await this.client.transport.del(`/files/${seg(fileId)}/tags`, { tags: [tag] });
  }

  async listTags(): Promise<Tag[]> {
    return (await this.client.list<Tag>("tags")).items;
  }

  async listCollections(_parentId?: string): Promise<Collection[]> {
    // The cloud /v1/collections endpoint has no parent filter; it is a
    // LocalStore-only refinement and intentionally not forwarded.
    return (await this.client.list<Collection>("collections")).items;
  }
  async createCollection(name: string, description?: string, opts?: CreateCollectionOptions): Promise<Collection> {
    return this.client.create<Collection>("collections", {
      name,
      description,
      parent_id: opts?.parent_id,
      auto_rules: opts?.auto_rules,
    });
  }
  async addToCollection(collectionId: string, fileId: string): Promise<void> {
    await this.client.transport.post(`/collections/${seg(collectionId)}/files`, { file_id: fileId });
  }
  async removeFromCollection(collectionId: string, fileId: string): Promise<void> {
    await this.client.delete(`collections/${seg(collectionId)}/files`, fileId);
  }

  async listProjects(_status?: string): Promise<Project[]> {
    // The cloud /v1/projects endpoint has no status filter; LocalStore-only.
    return (await this.client.list<Project>("projects")).items;
  }
  async createProject(name: string, description?: string, opts?: CreateProjectOptions): Promise<Project> {
    return this.client.create<Project>("projects", { name, description, status: opts?.status });
  }
  async addToProject(projectId: string, fileId: string): Promise<void> {
    await this.client.transport.post(`/projects/${seg(projectId)}/files`, { file_id: fileId });
  }
  async removeFromProject(projectId: string, fileId: string): Promise<void> {
    await this.client.delete(`projects/${seg(projectId)}/files`, fileId);
  }

  async listMachines(): Promise<Machine[]> {
    return (await this.client.list<Machine>("machines")).items;
  }
}
