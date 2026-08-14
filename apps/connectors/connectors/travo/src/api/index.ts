import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { PropertiesApi } from './properties';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly properties: PropertiesApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.properties = new PropertiesApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TRAVO_API_KEY;

    if (!apiKey) {
      throw new Error('TRAVO_API_KEY environment variable is required');
    }

    return new Connector({
      apiKey,
      baseUrl: process.env.TRAVO_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
export { PropertiesApi } from './properties';
