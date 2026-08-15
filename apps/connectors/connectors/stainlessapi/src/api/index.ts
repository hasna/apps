import type { StainlessConfig } from '../types';
import { StainlessClient } from './client';
import { BuildsApi } from './builds';
import { ProjectsApi } from './projects';
import { OrgsApi } from './orgs';
import { UserApi } from './user';

/**
 * Stainless API client.
 *
 * Wraps the public Stainless REST API (https://api.stainless.com, /v0) with
 * typed resource modules for builds, projects, orgs, and the current user.
 */
export class Stainless {
  private readonly client: StainlessClient;

  public readonly builds: BuildsApi;
  public readonly projects: ProjectsApi;
  public readonly orgs: OrgsApi;
  public readonly user: UserApi;

  constructor(config: StainlessConfig) {
    this.client = new StainlessClient(config);
    this.builds = new BuildsApi(this.client, config.project);
    this.projects = new ProjectsApi(this.client, config.project);
    this.orgs = new OrgsApi(this.client);
    this.user = new UserApi(this.client);
  }

  /**
   * Create a client from environment variables.
   * Reads STAINLESS_API_KEY, and optionally STAINLESS_PROJECT / STAINLESS_BASE_URL.
   */
  static fromEnv(): Stainless {
    const apiKey = process.env.STAINLESS_API_KEY;
    if (!apiKey) {
      throw new Error('STAINLESS_API_KEY environment variable is required');
    }
    return new Stainless({
      apiKey,
      project: process.env.STAINLESS_PROJECT,
      baseUrl: process.env.STAINLESS_BASE_URL,
    });
  }

  /** Redacted preview of the API key (for debugging). */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /** Access the underlying HTTP client for direct API calls. */
  getClient(): StainlessClient {
    return this.client;
  }
}

// Alias for cross-connector consistency.
export const Connector = Stainless;

export { StainlessClient } from './client';
export { BuildsApi } from './builds';
export { ProjectsApi, BranchesApi } from './projects';
export { OrgsApi } from './orgs';
export { UserApi } from './user';
