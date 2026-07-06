import type { TheHiveProjectConfig, RawRequestOptions } from '../types';
import { TheHiveProjectClient } from './client';
import { CasesApi } from './cases';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class TheHiveProject {
  private readonly client: TheHiveProjectClient;

  public readonly cases: CasesApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: TheHiveProjectConfig) {
    this.client = new TheHiveProjectClient(config);
    this.cases = new CasesApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): TheHiveProject {
    const apiKey = process.env.THE_HIVE_PROJECT_API_KEY;
    const baseUrl = process.env.THE_HIVE_PROJECT_BASE_URL;

    if (!apiKey) {
      throw new Error('THE_HIVE_PROJECT_API_KEY environment variable is required');
    }

    return new TheHiveProject({ apiKey, baseUrl });
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request<unknown>(path, { method, params, body, headers });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): TheHiveProjectClient {
    return this.client;
  }
}

export { TheHiveProjectClient, DEFAULT_BASE_URL } from './client';
export { CasesApi } from './cases';
export { EventsApi } from './events';
export { SearchApi } from './search';
