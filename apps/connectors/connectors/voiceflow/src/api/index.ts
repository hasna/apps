import type { VoiceflowConfig } from '../types';
import type { RequestOptions } from './client';
import { VoiceflowClient } from './client';
import { ProjectsApi } from './projects';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class Voiceflow {
  private readonly client: VoiceflowClient;

  public readonly projects: ProjectsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: VoiceflowConfig) {
    this.client = new VoiceflowClient(config);
    this.projects = new ProjectsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Voiceflow {
    const apiKey = process.env.VOICEFLOW_API_KEY;
    if (!apiKey) {
      throw new Error('VOICEFLOW_API_KEY environment variable is required');
    }
    return new Voiceflow({
      apiKey,
      baseUrl: process.env.VOICEFLOW_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): VoiceflowClient {
    return this.client;
  }

  async rawRequest<T = unknown>(
    path: string,
    options: Omit<RequestOptions, 'params'> & { query?: Record<string, string | number | boolean | undefined> } = {}
  ): Promise<T> {
    const { query, ...rest } = options;
    return this.client.request<T>(path, { ...rest, params: query });
  }
}

export { VoiceflowClient, DEFAULT_BASE_URL, buildAuthHeader } from './client';
export { ProjectsApi } from './projects';
export { EventsApi } from './events';
export { SearchApi } from './search';
