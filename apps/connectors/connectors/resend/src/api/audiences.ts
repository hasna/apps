import type { ResendClient } from './client';
import type {
  Audience,
  CreateAudienceParams,
  ListResponse,
} from '../types';

/**
 * Audiences API - Create, list, get, and delete audiences
 * https://resend.com/docs/api-reference/audiences
 */
export class AudiencesApi {
  constructor(private readonly client: ResendClient) {}

  /**
   * Create a new audience
   * POST /audiences
   */
  async create(params: CreateAudienceParams): Promise<Audience> {
    return this.client.post<Audience>('/audiences', params);
  }

  /**
   * List all audiences
   * GET /audiences
   */
  async list(): Promise<ListResponse<Audience>> {
    return this.client.get<ListResponse<Audience>>('/audiences');
  }

  /**
   * Get a single audience by ID
   * GET /audiences/:id
   */
  async get(audienceId: string): Promise<Audience> {
    return this.client.get<Audience>(`/audiences/${audienceId}`);
  }

  /**
   * Delete an audience
   * DELETE /audiences/:id
   */
  async delete(audienceId: string): Promise<{ deleted: boolean; id: string }> {
    return this.client.delete<{ deleted: boolean; id: string }>(`/audiences/${audienceId}`);
  }
}
