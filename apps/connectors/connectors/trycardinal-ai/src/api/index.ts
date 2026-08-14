import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { DocumentsApi } from './documents';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly documents: DocumentsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.documents = new DocumentsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TRYCARDINAL_AI_API_KEY;
    const baseUrl = process.env.TRYCARDINAL_AI_BASE_URL;

    if (!apiKey) {
      throw new Error('TRYCARDINAL_AI_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { DocumentsApi } from './documents';
