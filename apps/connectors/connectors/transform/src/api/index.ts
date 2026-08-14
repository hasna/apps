import type { TransformConfig } from '../types';
import { TransformClient } from './client';
import { PipelinesApi } from './pipelines';
import { EventsApi } from './events';
import { SearchApi } from './search';
import { RawApi } from './raw';

export class Transform {
  private readonly client: TransformClient;

  public readonly pipelines: PipelinesApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;
  public readonly raw: RawApi;

  constructor(config: TransformConfig) {
    this.client = new TransformClient(config);
    this.pipelines = new PipelinesApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
    this.raw = new RawApi(this.client);
  }

  static fromApiKey(apiKey: string, options?: Omit<TransformConfig, 'apiKey'>): Transform {
    return new Transform({ apiKey, ...options });
  }

  static fromEnv(): Transform {
    const apiKey = process.env.TRANSFORM_API_KEY;
    const baseUrl = process.env.TRANSFORM_BASE_URL;

    if (!apiKey) {
      throw new Error('TRANSFORM_API_KEY environment variable is required');
    }

    return new Transform({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): TransformClient {
    return this.client;
  }
}

export { TransformClient } from './client';
export { PipelinesApi } from './pipelines';
export { EventsApi } from './events';
export { SearchApi } from './search';
export { RawApi } from './raw';
