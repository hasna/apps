import type { DockerClient } from './client';
import type { Repository, RepositoryListResponse, Tag, TagListResponse } from '../types';

/**
 * Docker Hub Repositories API
 */
export class RepositoriesApi {
  constructor(private readonly client: DockerClient) {}

  /**
   * List repositories for a namespace (user or organization)
   */
  async list(namespace: string, options?: { page?: number; pageSize?: number }): Promise<RepositoryListResponse> {
    return this.client.get<RepositoryListResponse>(`/repositories/${namespace}`, {
      page: options?.page,
      page_size: options?.pageSize,
    });
  }

  /**
   * Get a single repository
   */
  async get(namespace: string, repository: string): Promise<Repository> {
    return this.client.get<Repository>(`/repositories/${namespace}/${repository}`);
  }

  /**
   * List tags for a repository
   */
  async listTags(namespace: string, repository: string, options?: { page?: number; pageSize?: number }): Promise<TagListResponse> {
    return this.client.get<TagListResponse>(`/repositories/${namespace}/${repository}/tags`, {
      page: options?.page,
      page_size: options?.pageSize,
    });
  }

  /**
   * Get a specific tag
   */
  async getTag(namespace: string, repository: string, tag: string): Promise<Tag> {
    return this.client.get<Tag>(`/repositories/${namespace}/${repository}/tags/${tag}`);
  }

  /**
   * Delete a tag
   */
  async deleteTag(namespace: string, repository: string, tag: string): Promise<void> {
    await this.client.delete(`/repositories/${namespace}/${repository}/tags/${tag}`);
  }

  /**
   * Update repository description
   */
  async updateDescription(namespace: string, repository: string, description: string, fullDescription?: string): Promise<Repository> {
    return this.client.patch<Repository>(`/repositories/${namespace}/${repository}`, {
      description,
      full_description: fullDescription,
    });
  }

  /**
   * Set repository visibility
   */
  async setVisibility(namespace: string, repository: string, isPrivate: boolean): Promise<Repository> {
    return this.client.patch<Repository>(`/repositories/${namespace}/${repository}`, {
      is_private: isPrivate,
    });
  }

  /**
   * Delete a repository
   */
  async delete(namespace: string, repository: string): Promise<void> {
    await this.client.delete(`/repositories/${namespace}/${repository}`);
  }
}

// Export alias for backwards compatibility
export { RepositoriesApi as ExampleApi };
