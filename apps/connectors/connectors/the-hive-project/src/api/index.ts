import type { TheHiveProjectConfig, RawRequestOptions } from '../types';
import { TheHiveProjectClient } from './client';
import { CasesApi } from './cases';
import { CustomEventsApi } from './events';
import { QueryApi } from './query';
import { SearchApi } from './search';

export class TheHiveProject {
  private readonly client: TheHiveProjectClient;

  public readonly cases: CasesApi;
  public readonly customEvents: CustomEventsApi;
  public readonly events: CustomEventsApi;
  public readonly query: QueryApi;
  public readonly search: SearchApi;

  constructor(config: TheHiveProjectConfig) {
    this.client = new TheHiveProjectClient(config);
    this.cases = new CasesApi(this.client);
    this.customEvents = new CustomEventsApi(this.client);
    this.events = this.customEvents;
    this.query = new QueryApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): TheHiveProject {
    const apiKey = process.env.THE_HIVE_PROJECT_API_KEY;
    const baseUrl = process.env.THE_HIVE_PROJECT_BASE_URL;
    const organisation = process.env.THE_HIVE_PROJECT_ORGANISATION;

    if (!apiKey) {
      throw new Error('THE_HIVE_PROJECT_API_KEY environment variable is required');
    }
    if (!baseUrl) {
      throw new Error('THE_HIVE_PROJECT_BASE_URL environment variable is required');
    }

    return new TheHiveProject({ apiKey, baseUrl, organisation });
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

export { TheHiveProjectClient, API_PATH_PREFIX } from './client';
export { CasesApi } from './cases';
export { CustomEventsApi, EventsApi } from './events';
export { QueryApi } from './query';
export { SearchApi } from './search';
