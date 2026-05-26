import type { FigmaClient } from './client';
import type { TeamProjectsResponse } from '../types';

/**
 * Figma Teams API
 */
export class TeamsApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * Get team projects
   * @param teamId - The team ID
   */
  async getProjects(teamId: string): Promise<TeamProjectsResponse> {
    return this.client.request<TeamProjectsResponse>(`/teams/${teamId}/projects`);
  }
}
