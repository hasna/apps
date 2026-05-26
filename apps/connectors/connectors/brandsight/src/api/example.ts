import { {{SERVICE_NAME_PASCAL}}Client } from './client';
// Import your types from '../types' as needed

/**
 * Example API module - rename and customize for your {{SERVICE_NAME}} resources
 *
 * This is a template showing common patterns for API modules.
 * Copy and modify this file for each resource type in your connector.
 */
export class ExampleApi {
  constructor(private readonly client: {{SERVICE_NAME_PASCAL}}Client) {}

  /**
   * Get a single resource by ID
   */
  async get(id: string): Promise<unknown> {
    return this.client.get(`/examples/${id}`);
  }

  /**
   * List resources with optional pagination
   */
  async list(params?: { page?: number; limit?: number }): Promise<{ data: unknown[]; hasMore: boolean }> {
    const response = await this.client.get<{ data: unknown[]; _hasMore?: boolean }>('/examples', params as Record<string, string | number | boolean | undefined>);
    return {
      data: response.data || [],
      hasMore: !!response._hasMore,
    };
  }

  /**
   * Count resources
   */
  async count(): Promise<number> {
    const response = await this.client.get<{ count: number }>('/examples/count');
    return response.count || 0;
  }

  /**
   * Create a new resource
   */
  async create(data: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/examples', data);
  }

  /**
   * Update an existing resource
   */
  async update(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.client.put(`/examples/${id}`, data);
  }

  /**
   * Delete a resource
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/examples/${id}`);
  }
}
