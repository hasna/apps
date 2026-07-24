import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { SpecsApi } from './specs';
import { BuildsApi } from './builds';
import { PullRequestsApi } from './pull-requests';
import { TasksApi } from './tasks';
import { RawApi } from './raw';

/**
 * Syntropy API Connector class.
 * Groups the spec-driven builds, pull-requests, tasks, and raw API surfaces.
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules
  public readonly specs: SpecsApi;
  public readonly builds: BuildsApi;
  public readonly pullRequests: PullRequestsApi;
  public readonly tasks: TasksApi;
  public readonly raw: RawApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.specs = new SpecsApi(this.client);
    this.builds = new BuildsApi(this.client);
    this.pullRequests = new PullRequestsApi(this.client);
    this.tasks = new TasksApi(this.client);
    this.raw = new RawApi(this.client);
  }

  /**
   * Create a client from environment variables.
   * Looks for SYNTROPY_API_KEY (required) and SYNTROPY_BASE_URL (optional).
   */
  static fromEnv(): Connector {
    const apiKey = process.env.SYNTROPY_API_KEY;

    if (!apiKey) {
      throw new Error('SYNTROPY_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl: process.env.SYNTROPY_BASE_URL });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the resolved base URL in use.
   */
  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ConnectorClient {
    return this.client;
  }
}

// Export client and all API classes
export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { SpecsApi } from './specs';
export { BuildsApi } from './builds';
export { PullRequestsApi } from './pull-requests';
export { TasksApi } from './tasks';
export { RawApi } from './raw';
