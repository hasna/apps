import type { GoogleCloudClient } from './client';
import type { Project, ProjectListResponse, ProjectCreateParams } from '../types';

/**
 * Google Cloud Projects API
 * Manages GCP projects via the Resource Manager API
 */
export class ProjectsApi {
  constructor(private readonly client: GoogleCloudClient) {}

  /**
   * List all projects accessible to the authenticated user
   */
  async list(options?: { pageSize?: number; pageToken?: string; filter?: string }): Promise<ProjectListResponse> {
    return this.client.get<ProjectListResponse>('/projects', {
      pageSize: options?.pageSize,
      pageToken: options?.pageToken,
      filter: options?.filter,
    });
  }

  /**
   * Get a single project by ID
   */
  async get(projectId: string): Promise<Project> {
    return this.client.get<Project>(`/projects/${projectId}`);
  }

  /**
   * Create a new project
   */
  async create(params: ProjectCreateParams): Promise<Project> {
    return this.client.post<Project>('/projects', {
      projectId: params.projectId,
      name: params.name,
      labels: params.labels,
      parent: params.parent,
    });
  }

  /**
   * Update an existing project
   */
  async update(projectId: string, params: Partial<ProjectCreateParams>): Promise<Project> {
    return this.client.put<Project>(`/projects/${projectId}`, params);
  }

  /**
   * Delete a project (moves to DELETE_REQUESTED state)
   */
  async delete(projectId: string): Promise<void> {
    await this.client.delete(`/projects/${projectId}`);
  }

  /**
   * Undelete a project (restore from DELETE_REQUESTED state)
   */
  async undelete(projectId: string): Promise<void> {
    await this.client.post(`/projects/${projectId}:undelete`);
  }

  /**
   * Get IAM policy for a project
   */
  async getIamPolicy(projectId: string): Promise<unknown> {
    return this.client.post(`/projects/${projectId}:getIamPolicy`, {});
  }

  /**
   * Set IAM policy for a project
   */
  async setIamPolicy(projectId: string, policy: unknown): Promise<unknown> {
    return this.client.post(`/projects/${projectId}:setIamPolicy`, { policy });
  }
}
