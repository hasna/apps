import { StableBrowseClient, type StableBrowseClientConfig, type RequestOptions } from './client';
import { TasksApi } from './tasks';
import { SessionsApi } from './sessions';
import { EndUsersApi } from './endusers';
import { DesignApi } from './design';

/**
 * Main StableBrowse Connector class.
 * Provides access to all StableBrowse API endpoints.
 */
export class StableBrowse {
  private readonly client: StableBrowseClient;

  // API modules
  public readonly tasks: TasksApi;
  public readonly sessions: SessionsApi;
  public readonly endUsers: EndUsersApi;
  public readonly design: DesignApi;

  constructor(config: StableBrowseClientConfig) {
    this.client = new StableBrowseClient(config);
    this.tasks = new TasksApi(this.client);
    this.sessions = new SessionsApi(this.client);
    this.endUsers = new EndUsersApi(this.client);
    this.design = new DesignApi(this.client);
  }

  /**
   * Create a client from environment variables.
   * Looks for STABLEBROWSE_API_KEY and optionally STABLEBROWSE_BASE_URL.
   */
  static fromEnv(): StableBrowse {
    const apiKey = process.env.STABLEBROWSE_API_KEY;
    const baseUrl = process.env.STABLEBROWSE_BASE_URL;

    if (!apiKey) {
      throw new Error('STABLEBROWSE_API_KEY environment variable is required');
    }

    return new StableBrowse({ apiKey, baseUrl });
  }

  /**
   * Escape hatch: issue an arbitrary authenticated request against the API.
   * Useful for endpoints not yet wrapped by a dedicated module.
   */
  async raw<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.client.request<T>(path, options);
  }

  /**
   * Get a masked API key preview (for debugging).
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the configured base URL.
   */
  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  /**
   * Get the underlying client for direct API access.
   */
  getClient(): StableBrowseClient {
    return this.client;
  }
}

export { StableBrowseClient } from './client';
export type { StableBrowseClientConfig, RequestOptions } from './client';
export { TasksApi } from './tasks';
export { SessionsApi } from './sessions';
export { EndUsersApi } from './endusers';
export { DesignApi } from './design';
