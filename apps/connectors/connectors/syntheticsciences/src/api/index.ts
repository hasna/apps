import type { SyntheticSciencesConfig } from '../types';
import { SyntheticSciencesClient } from './client';
import { ResearchApi } from './research';

/**
 * Synthetic Sciences API client.
 */
export class SyntheticSciences {
  private readonly client: SyntheticSciencesClient;

  // API modules
  public readonly research: ResearchApi;

  constructor(config: SyntheticSciencesConfig) {
    this.client = new SyntheticSciencesClient(config);
    this.research = new ResearchApi(this.client);
  }

  /**
   * Create a client from environment variables.
   * Reads SYNTHETICSCIENCES_API_KEY and optional SYNTHETICSCIENCES_BASE_URL.
   */
  static fromEnv(): SyntheticSciences {
    const apiKey = process.env.SYNTHETICSCIENCES_API_KEY;
    if (!apiKey) {
      throw new Error('SYNTHETICSCIENCES_API_KEY environment variable is required');
    }
    const baseUrl = process.env.SYNTHETICSCIENCES_BASE_URL;
    return new SyntheticSciences({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): SyntheticSciencesClient {
    return this.client;
  }
}

// Generic alias used across connectors.
export const Connector = SyntheticSciences;

export { SyntheticSciencesClient } from './client';
export { ResearchApi } from './research';
