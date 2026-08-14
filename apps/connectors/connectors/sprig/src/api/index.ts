import type { SprigConfig } from '../types';
import { SprigClient } from './client';
import { PurgeApi, ResponsesApi, SurveysApi, ThemesApi, UsersApi } from './resources';

export class Sprig {
  private readonly client: SprigClient;

  public readonly users: UsersApi;
  public readonly purge: PurgeApi;
  public readonly surveys: SurveysApi;
  public readonly responses: ResponsesApi;
  public readonly themes: ThemesApi;

  constructor(config: SprigConfig) {
    this.client = new SprigClient(config);
    this.users = new UsersApi(this.client);
    this.purge = new PurgeApi(this.client);
    this.surveys = new SurveysApi(this.client);
    this.responses = new ResponsesApi(this.client);
    this.themes = new ThemesApi(this.client);
  }

  static fromEnv(): Sprig {
    const apiKey = process.env.SPRIG_API_KEY;
    if (!apiKey) {
      throw new Error('SPRIG_API_KEY environment variable is required');
    }
    return new Sprig({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): SprigClient {
    return this.client;
  }
}

export { SprigClient } from './client';
export { UsersApi, PurgeApi, SurveysApi, ResponsesApi, ThemesApi } from './resources';
