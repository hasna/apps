import type { VeoConfig, RawRequestOptions } from '../types';
import { VeoClient } from './client';
import { VideosApi } from './videos';
import { UsersApi } from './users';
import { GroupsApi } from './groups';

export class Veo {
  private readonly client: VeoClient;

  public readonly videos: VideosApi;
  public readonly users: UsersApi;
  public readonly groups: GroupsApi;

  constructor(config: VeoConfig) {
    this.client = new VeoClient(config);
    this.videos = new VideosApi(this.client);
    this.users = new UsersApi(this.client);
    this.groups = new GroupsApi(this.client);
  }

  static fromEnv(): Veo {
    const apiKey = process.env.VEO_API_KEY;
    if (!apiKey) {
      throw new Error('VEO_API_KEY environment variable is required');
    }
    return new Veo({
      apiKey,
      baseUrl: process.env.VEO_BASE_URL,
    });
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): VeoClient {
    return this.client;
  }
}

export const Connector = Veo;

export { VeoClient, encodePathSegment, DEFAULT_BASE_URL } from './client';
export { VideosApi } from './videos';
export { UsersApi } from './users';
export { GroupsApi } from './groups';
