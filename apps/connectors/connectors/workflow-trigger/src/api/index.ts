import type { ConnectorConfig, RawRequestParams } from '../types';
import { ConnectorClient } from './client';
import { TriggersApi } from './triggers';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class Connector {
  private readonly client: ConnectorClient;
  public readonly triggers: TriggersApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.triggers = new TriggersApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.WORKFLOW_TRIGGER_API_KEY || process.env.WORKFLOW_TRIGGER_TOKEN;
    const baseUrl = process.env.WORKFLOW_TRIGGER_BASE_URL;

    if (!apiKey) {
      throw new Error('WORKFLOW_TRIGGER_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  async rawRequest<T = unknown>(params: RawRequestParams): Promise<T> {
    return this.client.rawRequest<T>(params);
  }
}

export { ConnectorClient } from './client';
export { TriggersApi } from './triggers';
export { EventsApi } from './events';
export { SearchApi } from './search';
