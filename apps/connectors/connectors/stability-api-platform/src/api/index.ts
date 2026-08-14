import type { ConnectorConfig, ListQueryParams, RawRequestOptions } from '../types';
import { StabilityApiPlatformClient } from './client';

export class StabilityApiPlatform {
  private readonly client: StabilityApiPlatformClient;

  constructor(config: ConnectorConfig) {
    this.client = new StabilityApiPlatformClient(config);
  }

  static fromEnv(): StabilityApiPlatform {
    const apiKey = process.env.STABILITY_API_PLATFORM_API_KEY;
    const baseUrl = process.env.STABILITY_API_PLATFORM_BASE_URL;

    if (!apiKey) {
      throw new Error('STABILITY_API_PLATFORM_API_KEY environment variable is required');
    }

    return new StabilityApiPlatform({ apiKey, baseUrl });
  }

  listItems(params?: ListQueryParams): Promise<unknown> {
    return this.client.listItems(params);
  }

  createItem(body: Record<string, unknown> | unknown[]): Promise<unknown> {
    return this.client.createItem(body);
  }

  getItem(itemId: string): Promise<unknown> {
    return this.client.getItem(itemId);
  }

  listEvents(params?: ListQueryParams): Promise<unknown> {
    return this.client.listEvents(params);
  }

  search(body: Record<string, unknown> | unknown[]): Promise<unknown> {
    return this.client.search(body);
  }

  rawRequest(options: RawRequestOptions): Promise<unknown> {
    return this.client.rawRequest(options);
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): StabilityApiPlatformClient {
    return this.client;
  }
}

export {
  ConnectorClient,
  StabilityApiPlatformClient,
  DEFAULT_BASE_URL,
  encodePathSegment,
} from './client';
