import type { FigmaClient } from './client';
import type {
  TeamProjectsResponse,
  ProjectFilesResponse,
} from '../types';

/**
 * Figma Projects API
 */
export class ProjectsApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * Get team projects
   * @param teamId - The team ID
   */
  async getTeamProjects(teamId: string): Promise<TeamProjectsResponse> {
    return this.client.request<TeamProjectsResponse>(`/teams/${teamId}/projects`);
  }

  /**
   * Get files in a project
   * @param projectId - The project ID
   * @param options - Optional parameters
   */
  async getProjectFiles(
    projectId: string,
    options: {
      branch_data?: boolean;
    } = {}
  ): Promise<ProjectFilesResponse> {
    return this.client.request<ProjectFilesResponse>(`/projects/${projectId}/files`, {
      params: options as Record<string, string | number | boolean | undefined>,
    });
  }
}
