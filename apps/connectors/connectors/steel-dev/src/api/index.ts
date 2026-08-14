import type { SteelDevConfig } from '../types';
import { SteelDevClient } from './client';
import { SearchApi, SessionsApi } from './sessions';

export class SteelDev {
  private readonly client: SteelDevClient;

  public readonly sessions: SessionsApi;
  public readonly search: SearchApi;

  constructor(config: SteelDevConfig) {
    this.client = new SteelDevClient(config);
    this.sessions = new SessionsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): SteelDev {
    const apiKey = process.env.STEEL_API_KEY || process.env.STEEL_DEV_API_KEY;
    const baseUrl = process.env.STEEL_DEV_BASE_URL || process.env.STEEL_BASE_URL;

    if (!apiKey) {
      throw new Error('STEEL_API_KEY environment variable is required');
    }

    return new SteelDev({ apiKey, baseUrl });
  }

  getClient(): SteelDevClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }
}

export { SteelDevClient } from './client';
export { SessionsApi, SearchApi } from './sessions';
