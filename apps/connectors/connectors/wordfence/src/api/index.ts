import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ScansApi } from './scans';
import { EventsApi } from './events';
import { SearchApi } from './search';

/**
 * Wordfence Connector
 * Provides access to scans, security events, and search APIs.
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly scans: ScansApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.scans = new ScansApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.WORDFENCE_API_KEY;
    if (!apiKey) {
      throw new Error('WORDFENCE_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.WORDFENCE_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { ScansApi } from './scans';
export { EventsApi } from './events';
export { SearchApi } from './search';
