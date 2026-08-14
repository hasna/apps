import type { PandaDocClient } from './client';
import type { ContentLibraryItem, ContentLibraryItemDetails, ContentLibraryListResponse } from '../types';

export interface ContentLibraryListOptions {
  q?: string;         // Search query
  count?: number;
  page?: number;
  tag?: string;       // Filter by tag
  folder_uuid?: string;
  deleted?: boolean;
}

/**
 * Content Library API - Manage PandaDoc content library items
 */
export class ContentLibraryApi {
  constructor(private readonly client: PandaDocClient) {}

  /**
   * List content library items with optional filtering
   */
  async list(options?: ContentLibraryListOptions): Promise<ContentLibraryListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options) {
      if (options.q) params.q = options.q;
      if (options.count) params.count = options.count;
      if (options.page) params.page = options.page;
      if (options.tag) params.tag = options.tag;
      if (options.folder_uuid) params.folder_uuid = options.folder_uuid;
      if (options.deleted !== undefined) params.deleted = options.deleted;
    }

    return this.client.get<ContentLibraryListResponse>('/content-library-items', params);
  }

  /**
   * Get content library item by ID
   */
  async get(id: string): Promise<ContentLibraryItem> {
    return this.client.get<ContentLibraryItem>(`/content-library-items/${id}`);
  }

  /**
   * Get content library item details including pricing tables
   */
  async getDetails(id: string): Promise<ContentLibraryItemDetails> {
    return this.client.get<ContentLibraryItemDetails>(`/content-library-items/${id}/details`);
  }

  /**
   * Delete content library item
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/content-library-items/${id}`);
  }
}
