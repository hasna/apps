import type { PandaDocClient } from './client';
import type { Folder, FolderCreateParams, FolderListResponse } from '../types';

export interface FolderListOptions {
  parent_uuid?: string;
  count?: number;
  page?: number;
}

/**
 * Folders API - Manage PandaDoc document folders
 */
export class FoldersApi {
  constructor(private readonly client: PandaDocClient) {}

  /**
   * List folders with optional filtering
   */
  async list(options?: FolderListOptions): Promise<FolderListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options) {
      if (options.parent_uuid) params.parent_uuid = options.parent_uuid;
      if (options.count) params.count = options.count;
      if (options.page) params.page = options.page;
    }

    return this.client.get<FolderListResponse>('/documents/folders', params);
  }

  /**
   * Get folder by UUID
   */
  async get(uuid: string): Promise<Folder> {
    return this.client.get<Folder>(`/documents/folders/${uuid}`);
  }

  /**
   * Create a new folder
   */
  async create(params: FolderCreateParams): Promise<Folder> {
    return this.client.post<Folder>('/documents/folders', params);
  }

  /**
   * Rename a folder
   */
  async rename(uuid: string, name: string): Promise<Folder> {
    return this.client.patch<Folder>(`/documents/folders/${uuid}`, { name });
  }

  /**
   * Delete a folder
   */
  async delete(uuid: string): Promise<void> {
    await this.client.delete(`/documents/folders/${uuid}`);
  }
}
