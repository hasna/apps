import type { ConnectorConfig, RawRequestOptions } from '../types';
import { ConnectorClient } from './client';
import { WebhooksApi } from './webhooks';
import { EventsApi } from './events';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly webhooks: WebhooksApi;
  public readonly events: EventsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.webhooks = new WebhooksApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_WEBHOOKS_ADVANCED_API_KEY;
    const apiSecret = process.env.STRIPE_WEBHOOKS_ADVANCED_API_SECRET;

    if (!apiKey) {
      throw new Error('STRIPE_WEBHOOKS_ADVANCED_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, apiSecret });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body } = options;
    return this.client.request<T>(path, { method, params, body });
  }
}

export { ConnectorClient } from './client';
export { WebhooksApi } from './webhooks';
export { EventsApi } from './events';
export { verifyWebhookSignature, constructTestSignature } from './verify';
