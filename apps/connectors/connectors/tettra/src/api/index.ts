import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { PagesApi } from './pages';
import { EventsApi } from './events';
import { SearchApi } from './search';

/**
 * Tettra REST API v1 Connector
 * @see https://api.tettra.co/v1
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly pages: PagesApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.pages = new PagesApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TETTRA_API_KEY;

    if (!apiKey) {
      throw new Error('TETTRA_API_KEY environment variable is required');
    }

    return new Connector({
      apiKey,
      baseUrl: process.env.TETTRA_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { PagesApi } from './pages';
export { EventsApi } from './events';
export { SearchApi } from './search';
