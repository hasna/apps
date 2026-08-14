import type { Icons8Config } from '../types';
import { Icons8Client } from './client';
import { IconsApi } from './example';

/**
 * Main Icons8 connector class
 */
export class Icons8 {
  private readonly client: Icons8Client;

  // API modules
  public readonly icons: IconsApi;

  constructor(config: Icons8Config) {
    this.client = new Icons8Client(config);
    this.icons = new IconsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for ICONS8_API_KEY
   */
  static fromEnv(): Icons8 {
    const apiKey = process.env.ICONS8_API_KEY;

    if (!apiKey) {
      throw new Error('ICONS8_API_KEY environment variable is required');
    }
    return new Icons8({ apiKey });
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
  getClient(): Icons8Client {
    return this.client;
  }
}

export { Icons8Client } from './client';
export { IconsApi } from './example';
