import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { DocumentsApi } from './documents';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly documents: DocumentsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.documents = new DocumentsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.VECTOR_LEGAL_API_KEY;
    const baseUrl = process.env.VECTOR_LEGAL_API_BASE_URL;

    if (!apiKey) {
      throw new Error('VECTOR_LEGAL_API_KEY environment variable is required');
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
export { EventsApi } from './events';
export { SearchApi } from './search';
