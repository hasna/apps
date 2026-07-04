import type { ZenserpConfig } from '../types';
import { ZenserpClient } from './client';
import { SearchApi } from './search';

export class Zenserp {
  private readonly client: ZenserpClient;

  public readonly search: SearchApi;

  constructor(config: ZenserpConfig) {
    this.client = new ZenserpClient(config);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Zenserp {
    const apiKey = process.env.ZENSERP_API_KEY;
    if (!apiKey) {
      throw new Error('ZENSERP_API_KEY environment variable is required');
    }

    return new Zenserp({
      apiKey,
      baseUrl: process.env.ZENSERP_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ZenserpClient {
    return this.client;
  }
}

export { ZenserpClient } from './client';
export { SearchApi } from './search';
