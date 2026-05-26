import type { PandaDocClient } from './client';
import type { Template, TemplateDetails, TemplateListResponse } from '../types';

export interface TemplateListOptions {
  q?: string;          // Search query
  count?: number;      // Results per page
  page?: number;       // Page number
  tag?: string;        // Filter by tag
  folder_uuid?: string; // Filter by folder
  deleted?: boolean;   // Include deleted templates
}

/**
 * Templates API - Manage PandaDoc templates
 */
export class TemplatesApi {
  constructor(private readonly client: PandaDocClient) {}

  /**
   * List templates with optional filtering
   */
  async list(options?: TemplateListOptions): Promise<TemplateListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options) {
      if (options.q) params.q = options.q;
      if (options.count) params.count = options.count;
      if (options.page) params.page = options.page;
      if (options.tag) params.tag = options.tag;
      if (options.folder_uuid) params.folder_uuid = options.folder_uuid;
      if (options.deleted !== undefined) params.deleted = options.deleted;
    }

    return this.client.get<TemplateListResponse>('/templates', params);
  }

  /**
   * Get template by ID
   */
  async get(id: string): Promise<Template> {
    const response = await this.client.get<TemplateListResponse>('/templates', { id });
    if (response.results && response.results.length > 0) {
      return response.results[0];
    }
    throw new Error(`Template ${id} not found`);
  }

  /**
   * Get template details including fields, tokens, roles
   */
  async getDetails(id: string): Promise<TemplateDetails> {
    return this.client.get<TemplateDetails>(`/templates/${id}/details`);
  }

  /**
   * Delete template
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/templates/${id}`);
  }
}
