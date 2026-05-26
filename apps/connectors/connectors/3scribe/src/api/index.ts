import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { JobsApi } from './jobs';

/**
 * 3Scribe Connector class
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly jobs: JobsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.jobs = new JobsApi(this.client);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Connector {
    const apiKey = process.env.THREESCRIBE_API_KEY;

    if (!apiKey) {
      throw new Error('THREESCRIBE_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { JobsApi } from './jobs';
