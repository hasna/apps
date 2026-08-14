import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { LookupApi } from './lookup';
import { CreditsApi } from './credits';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly lookup: LookupApi;
  public readonly credits: CreditsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.lookup = new LookupApi(this.client);
    this.credits = new CreditsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.WAPPALYZER_API_KEY;

    if (!apiKey) {
      throw new Error('WAPPALYZER_API_KEY environment variable is required');
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

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { LookupApi } from './lookup';
export { CreditsApi } from './credits';
