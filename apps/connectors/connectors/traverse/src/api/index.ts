import type { TraverseConfig } from '../types';
import { TraverseClient } from './client';
import { EnvironmentsApi } from './environments';
import { EpisodesApi } from './episodes';
import { DatasetsApi } from './datasets';

export class Traverse {
  private readonly client: TraverseClient;

  public readonly environments: EnvironmentsApi;
  public readonly episodes: EpisodesApi;
  public readonly datasets: DatasetsApi;

  constructor(config: TraverseConfig) {
    this.client = new TraverseClient(config);
    this.environments = new EnvironmentsApi(this.client);
    this.episodes = new EpisodesApi(this.client);
    this.datasets = new DatasetsApi(this.client);
  }

  static fromEnv(): Traverse {
    const apiKey = process.env.TRAVERSE_API_KEY;
    if (!apiKey) {
      throw new Error('TRAVERSE_API_KEY environment variable is required');
    }
    return new Traverse({
      apiKey,
      baseUrl: process.env.TRAVERSE_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): TraverseClient {
    return this.client;
  }

  async rawRequest<T = unknown>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    return this.client.request<T>(path, options);
  }
}

export { TraverseClient, DEFAULT_BASE_URL } from './client';
export { EnvironmentsApi } from './environments';
export { EpisodesApi } from './episodes';
export { DatasetsApi } from './datasets';
