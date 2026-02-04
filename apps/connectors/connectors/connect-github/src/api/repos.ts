import type { GitHubClient } from './client';
import type {
  Repository,
  CreateRepoOptions,
  FileContent,
  CreateOrUpdateFileOptions,
  FileCommitResponse,
} from '../types';

/**
 * GitHub Repositories API
 */
export class ReposApi {
  constructor(private readonly client: GitHubClient) {}

  /**
   * Get a repository
   */
  async get(owner: string, repo: string): Promise<Repository> {
    return this.client.get<Repository>(`/repos/${owner}/${repo}`);
  }

  /**
   * List repositories for a user
   */
  async list(
    username: string,
    options?: {
      type?: 'all' | 'owner' | 'member';
      sort?: 'created' | 'updated' | 'pushed' | 'full_name';
      direction?: 'asc' | 'desc';
      per_page?: number;
      page?: number;
    }
  ): Promise<Repository[]> {
    return this.client.get<Repository[]>(`/users/${username}/repos`, options);
  }

  /**
   * List repositories for an organization
   */
  async listOrg(
    org: string,
    options?: {
      type?: 'all' | 'public' | 'private' | 'forks' | 'sources' | 'member';
      sort?: 'created' | 'updated' | 'pushed' | 'full_name';
      direction?: 'asc' | 'desc';
      per_page?: number;
      page?: number;
    }
  ): Promise<Repository[]> {
    return this.client.get<Repository[]>(`/orgs/${org}/repos`, options);
  }

  /**
   * List repositories for the authenticated user
   */
  async listForAuthenticatedUser(options?: {
    visibility?: 'all' | 'public' | 'private';
    affiliation?: string;
    type?: 'all' | 'owner' | 'public' | 'private' | 'member';
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    direction?: 'asc' | 'desc';
    per_page?: number;
    page?: number;
  }): Promise<Repository[]> {
    return this.client.get<Repository[]>('/user/repos', options);
  }

  /**
   * Create a repository for the authenticated user
   */
  async create(name: string, options?: CreateRepoOptions): Promise<Repository> {
    return this.client.post<Repository>('/user/repos', {
      name,
      ...options,
    });
  }

  /**
   * Create a repository in an organization
   */
  async createInOrg(org: string, name: string, options?: CreateRepoOptions): Promise<Repository> {
    return this.client.post<Repository>(`/orgs/${org}/repos`, {
      name,
      ...options,
    });
  }

  /**
   * Delete a repository
   */
  async delete(owner: string, repo: string): Promise<void> {
    await this.client.delete(`/repos/${owner}/${repo}`);
  }

  /**
   * Get repository content (file or directory)
   */
  async getContent(
    owner: string,
    repo: string,
    path: string,
    options?: { ref?: string }
  ): Promise<FileContent | FileContent[]> {
    return this.client.get<FileContent | FileContent[]>(
      `/repos/${owner}/${repo}/contents/${path}`,
      options
    );
  }

  /**
   * Create or update a file
   */
  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    options: CreateOrUpdateFileOptions
  ): Promise<FileCommitResponse> {
    return this.client.put<FileCommitResponse>(
      `/repos/${owner}/${repo}/contents/${path}`,
      options
    );
  }

  /**
   * Delete a file
   */
  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    options: { message: string; sha: string; branch?: string }
  ): Promise<FileCommitResponse> {
    return this.client.delete<FileCommitResponse>(
      `/repos/${owner}/${repo}/contents/${path}`,
      options as Record<string, string | undefined>
    );
  }

  /**
   * List repository topics
   */
  async listTopics(owner: string, repo: string): Promise<{ names: string[] }> {
    return this.client.get<{ names: string[] }>(`/repos/${owner}/${repo}/topics`);
  }

  /**
   * Replace all repository topics
   */
  async replaceTopics(owner: string, repo: string, names: string[]): Promise<{ names: string[] }> {
    return this.client.put<{ names: string[] }>(`/repos/${owner}/${repo}/topics`, { names });
  }
}
