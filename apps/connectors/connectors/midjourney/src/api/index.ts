import type { MidjourneyConfig } from '../types';
import { MidjourneyClient } from './client';
import { ImagineApi } from './imagine';

/**
 * Main Midjourney connector class
 */
export class Midjourney {
  private readonly client: MidjourneyClient;

  // API modules
  public readonly imagine: ImagineApi;

  constructor(config: MidjourneyConfig) {
    this.client = new MidjourneyClient(config);
    this.imagine = new ImagineApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for MIDJOURNEY_API_KEY and optionally DISCORD_TOKEN
   */
  static fromEnv(): Midjourney {
    const apiKey = process.env.MIDJOURNEY_API_KEY;
    const discordToken = process.env.DISCORD_TOKEN;
    const baseUrl = process.env.MIDJOURNEY_BASE_URL;

    if (!apiKey) {
      throw new Error('MIDJOURNEY_API_KEY environment variable is required');
    }
    return new Midjourney({ apiKey, discordToken, baseUrl });
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
  getClient(): MidjourneyClient {
    return this.client;
  }
}

export { MidjourneyClient } from './client';
export { ImagineApi } from './imagine';
