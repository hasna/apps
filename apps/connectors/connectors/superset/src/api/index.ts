import type { SupersetConfig, CurrentUser, LoginResponse } from '../types';
import { SupersetClient } from './client';
import { DashboardsApi } from './dashboards';
import { ChartsApi } from './charts';
import { DatasetsApi } from './datasets';
import { DatabasesApi } from './databases';
import { SavedQueriesApi } from './savedQueries';
import { QueriesApi } from './queries';

/**
 * Main Apache Superset connector class.
 *
 * Provides access to Dashboards, Charts, Datasets, Databases, Saved Queries
 * and Query records through a self-hosted Superset REST API.
 */
export class Superset {
  private readonly client: SupersetClient;

  public readonly dashboards: DashboardsApi;
  public readonly charts: ChartsApi;
  public readonly datasets: DatasetsApi;
  public readonly databases: DatabasesApi;
  public readonly savedQueries: SavedQueriesApi;
  public readonly queries: QueriesApi;

  constructor(config: SupersetConfig) {
    this.client = new SupersetClient(config);
    this.dashboards = new DashboardsApi(this.client);
    this.charts = new ChartsApi(this.client);
    this.datasets = new DatasetsApi(this.client);
    this.databases = new DatabasesApi(this.client);
    this.savedQueries = new SavedQueriesApi(this.client);
    this.queries = new QueriesApi(this.client);
  }

  /**
   * Create a client from environment variables.
   * Looks for SUPERSET_BASE_URL (required), SUPERSET_USERNAME, SUPERSET_PASSWORD,
   * SUPERSET_PROVIDER, SUPERSET_ACCESS_TOKEN, SUPERSET_REFRESH_TOKEN.
   */
  static fromEnv(): Superset {
    const baseUrl = process.env.SUPERSET_BASE_URL;
    if (!baseUrl) {
      throw new Error('SUPERSET_BASE_URL environment variable is required');
    }

    return new Superset({
      baseUrl,
      username: process.env.SUPERSET_USERNAME,
      password: process.env.SUPERSET_PASSWORD,
      provider: (process.env.SUPERSET_PROVIDER as SupersetConfig['provider']) || 'db',
      accessToken: process.env.SUPERSET_ACCESS_TOKEN,
      refreshToken: process.env.SUPERSET_REFRESH_TOKEN,
    });
  }

  /** Authenticate with username/password and store the returned tokens. */
  async login(): Promise<LoginResponse> {
    return this.client.login();
  }

  /** Refresh the access token using the stored refresh token. */
  async refresh(): Promise<void> {
    return this.client.refreshAccessToken();
  }

  /** Get the currently authenticated user. */
  async me(): Promise<CurrentUser> {
    const response = await this.client.request<{ result: CurrentUser }>('/api/v1/me/');
    return response.result;
  }

  /** Get the underlying client for direct API access. */
  getClient(): SupersetClient {
    return this.client;
  }
}

export { SupersetClient } from './client';
export { DashboardsApi } from './dashboards';
export { ChartsApi } from './charts';
export { DatasetsApi } from './datasets';
export { DatabasesApi } from './databases';
export { SavedQueriesApi } from './savedQueries';
export { QueriesApi } from './queries';
