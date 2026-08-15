import type { HedraConfig } from '../types';
import { HedraClient } from './client';
import { CharactersApi } from './characters';
import { VoicesApi } from './voices';
import { ProjectsApi } from './projects';

/**
 * Main Hedra API client
 * Provides access to all Hedra API endpoints for AI video generation
 */
export class Hedra {
  private readonly client: HedraClient;

  // API modules
  public readonly characters: CharactersApi;
  public readonly voices: VoicesApi;
  public readonly projects: ProjectsApi;

  constructor(config: HedraConfig) {
    this.client = new HedraClient(config);
    this.characters = new CharactersApi(this.client);
    this.voices = new VoicesApi(this.client);
    this.projects = new ProjectsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for HEDRA_API_KEY
   */
  static fromEnv(): Hedra {
    const apiKey = process.env.HEDRA_API_KEY;

    if (!apiKey) {
      throw new Error('HEDRA_API_KEY environment variable is required');
    }
    return new Hedra({ apiKey });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): HedraClient {
    return this.client;
  }
}

export { HedraClient } from './client';
export { CharactersApi } from './characters';
export { VoicesApi } from './voices';
export { ProjectsApi } from './projects';
