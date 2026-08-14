import type { StageConfig } from '../types';
import { StageClient, type StageRequestOptions } from './client';
import { ReviewsApi } from './reviews';
import { PullRequestsApi } from './pullRequests';

/**
 * Main Stage Connector class
 * Provides access to the Stage code-review API services.
 */
export class Stage {
  private readonly client: StageClient;

  // Service APIs
  public readonly reviews: ReviewsApi;
  public readonly pullRequests: PullRequestsApi;

  constructor(config: StageConfig) {
    this.client = new StageClient(config);
    this.reviews = new ReviewsApi(this.client);
    this.pullRequests = new PullRequestsApi(this.client);
  }

  /**
   * Create a client from environment variables.
   * Looks for STAGE_API_KEY and optional STAGE_BASE_URL.
   */
  static fromEnv(): Stage {
    const apiKey = process.env.STAGE_API_KEY;

    if (!apiKey) {
      throw new Error('STAGE_API_KEY environment variable is required');
    }

    return new Stage({ apiKey, baseUrl: process.env.STAGE_BASE_URL });
  }

  /**
   * Perform a raw request against an arbitrary Stage API path.
   * Useful for endpoints not yet covered by a typed service.
   */
  async raw<T = unknown>(path: string, options: StageRequestOptions = {}): Promise<T> {
    return this.client.request<T>(path, options);
  }

  /**
   * Get a masked preview of the API key (for debugging).
   */
  getKeyPreview(): string {
    return this.client.getKeyPreview();
  }

  /**
   * Get the underlying client for direct API access.
   */
  getClient(): StageClient {
    return this.client;
  }
}

export { StageClient } from './client';
export { ReviewsApi } from './reviews';
export { PullRequestsApi } from './pullRequests';
