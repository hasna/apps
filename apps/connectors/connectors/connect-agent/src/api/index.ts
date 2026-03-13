import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ActionsApi } from './actions';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly actions: ActionsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.actions = new ActionsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.AGENT_AI_API_KEY;

    if (!apiKey) {
      throw new Error('AGENT_AI_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { ActionsApi } from './actions';
