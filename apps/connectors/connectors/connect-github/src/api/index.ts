import type { GitHubConfig } from '../types';
import { GitHubClient } from './client';
import { ReposApi } from './repos';
import { IssuesApi } from './issues';
import { PullsApi } from './pulls';
import { UsersApi } from './users';

/**
 * Main GitHub connector class
 */
export class GitHub {
  private readonly client: GitHubClient;

  // API modules
  public readonly repos: ReposApi;
  public readonly issues: IssuesApi;
  public readonly pulls: PullsApi;
  public readonly users: UsersApi;

  constructor(config: GitHubConfig) {
    this.client = new GitHubClient(config);
    this.repos = new ReposApi(this.client);
    this.issues = new IssuesApi(this.client);
    this.pulls = new PullsApi(this.client);
    this.users = new UsersApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for GITHUB_TOKEN
   */
  static fromEnv(): GitHub {
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    const baseUrl = process.env.GITHUB_BASE_URL;
    return new GitHub({ token, baseUrl });
  }

  /**
   * Get a preview of the token (for debugging)
   */
  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GitHubClient {
    return this.client;
  }
}

export { GitHubClient } from './client';
export { ReposApi } from './repos';
export { IssuesApi } from './issues';
export { PullsApi } from './pulls';
export { UsersApi } from './users';
