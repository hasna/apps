import type { HedraClient } from './client';
import type { HedraProject, HedraProjectCreateParams } from '../types';

/**
 * Projects API - Manage Hedra video generation projects
 */
export class ProjectsApi {
  constructor(private readonly client: HedraClient) {}

  /**
   * List all projects
   */
  async list(): Promise<HedraProject[]> {
    return this.client.get<HedraProject[]>('/v1/projects');
  }

  /**
   * Get a single project by ID
   */
  async get(id: string): Promise<HedraProject> {
    return this.client.get<HedraProject>(`/v1/projects/${id}`);
  }

  /**
   * Create a new video project
   */
  async create(params: HedraProjectCreateParams): Promise<HedraProject> {
    return this.client.post<HedraProject>('/v1/projects', params);
  }

  /**
   * Delete a project
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/v1/projects/${id}`);
  }

  /**
   * Get project status (useful for polling during generation)
   */
  async getStatus(id: string): Promise<{ status: string; progress?: number; videoUrl?: string }> {
    return this.client.get(`/v1/projects/${id}/status`);
  }
}
