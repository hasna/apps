import type { TinybirdConfig } from '../types';
import { TinybirdClient } from './client';
import { SqlApi } from './sql';
import { PipesApi } from './pipes';
import { DataSourcesApi } from './datasources';
import { EventsApi } from './events';
import { TokensApi } from './tokens';
import { JobsApi } from './jobs';

export class Tinybird {
  private readonly client: TinybirdClient;

  public readonly sql: SqlApi;
  public readonly pipes: PipesApi;
  public readonly datasources: DataSourcesApi;
  public readonly events: EventsApi;
  public readonly tokens: TokensApi;
  public readonly jobs: JobsApi;

  constructor(config: TinybirdConfig) {
    this.client = new TinybirdClient(config);
    this.sql = new SqlApi(this.client);
    this.pipes = new PipesApi(this.client);
    this.datasources = new DataSourcesApi(this.client);
    this.events = new EventsApi(this.client);
    this.tokens = new TokensApi(this.client);
    this.jobs = new JobsApi(this.client);
  }

  static fromEnv(): Tinybird {
    const apiToken =
      process.env.TINYBIRD_API_TOKEN ||
      process.env.CONNECTOR_API_KEY ||
      process.env.CONNECTOR_TOKEN;
    if (!apiToken) {
      throw new Error('TINYBIRD_API_TOKEN or CONNECTOR_API_KEY environment variable is required');
    }
    return new Tinybird({
      apiToken,
      baseUrl: process.env.TINYBIRD_HOST || process.env.CONNECTOR_BASE_URL,
    });
  }

  getClient(): TinybirdClient {
    return this.client;
  }
}

export { TinybirdClient, DEFAULT_BASE_URL } from './client';
export { SqlApi } from './sql';
export { PipesApi } from './pipes';
export { DataSourcesApi } from './datasources';
export { EventsApi } from './events';
export { TokensApi } from './tokens';
export { JobsApi } from './jobs';
