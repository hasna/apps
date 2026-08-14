import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { WideframeApi } from './wideframe';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly wideframe: WideframeApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.wideframe = new WideframeApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.WIDEFRAME_API_KEY;

    if (!apiKey) {
      throw new Error('WIDEFRAME_API_KEY environment variable is required');
    }

    return new Connector({
      apiKey,
      baseUrl: process.env.WIDEFRAME_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL, encodePathSegment, bodyFromArgs } from './client';
export { WideframeApi } from './wideframe';
