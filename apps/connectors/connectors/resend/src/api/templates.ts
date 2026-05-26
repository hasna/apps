import type { ResendClient } from './client';
import type {
  Template,
  CreateTemplateParams,
  UpdateTemplateParams,
  DuplicateTemplateParams,
  ListResponse,
} from '../types';

/**
 * Templates API - Create, update, delete, and manage email templates
 * https://resend.com/docs/api-reference/templates
 * Note: Templates require the Resend Emails plan
 */
export class TemplatesApi {
  constructor(private readonly client: ResendClient) {}

  /**
   * Create a new template
   * POST /templates
   */
  async create(params: CreateTemplateParams): Promise<Template> {
    return this.client.post<Template>('/templates', params);
  }

  /**
   * List all templates
   * GET /templates
   */
  async list(): Promise<ListResponse<Template>> {
    return this.client.get<ListResponse<Template>>('/templates');
  }

  /**
   * Get a single template by ID
   * GET /templates/:id
   */
  async get(templateId: string): Promise<Template> {
    return this.client.get<Template>(`/templates/${templateId}`);
  }

  /**
   * Update a template
   * PATCH /templates/:id
   */
  async update(templateId: string, params: UpdateTemplateParams): Promise<Template> {
    return this.client.patch<Template>(`/templates/${templateId}`, params);
  }

  /**
   * Delete a template
   * DELETE /templates/:id
   */
  async delete(templateId: string): Promise<{ deleted: boolean; id: string }> {
    return this.client.delete<{ deleted: boolean; id: string }>(`/templates/${templateId}`);
  }

  /**
   * Duplicate a template
   * POST /templates/:id/duplicate
   */
  async duplicate(templateId: string, params?: DuplicateTemplateParams): Promise<Template> {
    return this.client.post<Template>(`/templates/${templateId}/duplicate`, params || {});
  }
}
