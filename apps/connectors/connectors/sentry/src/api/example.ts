import type { SentryClient } from './client';
import type { ExampleResource, ExampleListResponse, ExampleCreateParams } from '../types';

/**
 * Example API module - demonstrates the pattern for API modules
 * TODO: Replace with your actual API endpoints
 */
export class ExampleApi {
  constructor(private readonly client: SentryClient) {}

  /**
   * List resources with optional pagination
   */
  async list(options?: { maxResults?: number; pageToken?: string }): Promise<ExampleListResponse> {
    return this.client.get<ExampleListResponse>('/resources', {
      max_results: options?.maxResults,
      page_token: options?.pageToken,
    });
  }

  /**
   * Get a single resource by ID
   */
  async get(id: string): Promise<ExampleResource> {
    return this.client.get<ExampleResource>(`/resources/${id}`);
  }

  /**
   * Create a new resource
   */
  async create(params: ExampleCreateParams): Promise<ExampleResource> {
    return this.client.post<ExampleResource>('/resources', params);
  }

  /**
   * Update an existing resource
   */
  async update(id: string, params: Partial<ExampleCreateParams>): Promise<ExampleResource> {
    return this.client.patch<ExampleResource>(`/resources/${id}`, params);
  }

  /**
   * Delete a resource
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/resources/${id}`);
  }
}
