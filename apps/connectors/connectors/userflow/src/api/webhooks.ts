import type { UserflowClient } from './client';
import { assertNonEmptyEnabledEvents, encodeResourceId } from './helpers';

export class WebhooksApi {
  constructor(private readonly client: UserflowClient) {}

  async listWebhookEndpoints(): Promise<unknown> {
    return this.client.get('/v2/webhook_endpoints');
  }

  async createWebhookEndpoint(options: {
    url: string;
    enabled_events: string[];
    description?: string;
    disabled?: boolean;
  }): Promise<unknown> {
    const enabled_events = assertNonEmptyEnabledEvents(options.enabled_events);
    return this.client.post('/v2/webhook_endpoints', {
      ...options,
      enabled_events,
    });
  }

  async updateWebhookEndpoint(
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.client.post(`/v2/webhook_endpoints/${encodeResourceId(id)}`, data);
  }

  async deleteWebhookEndpoint(id: string): Promise<unknown> {
    return this.client.delete(`/v2/webhook_endpoints/${encodeResourceId(id)}`);
  }
}
