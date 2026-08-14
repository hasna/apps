import type { ConnectorClient } from './client';
import type { Webhook, WebhookCreateParams, ListParams } from '../types';

export class WebhooksApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.offset) queryParams.offset = params.offset;
    return this.client.get<unknown>('/webhooks', queryParams);
  }

  async get(webhookId: string): Promise<{ webhook: Webhook }> {
    return this.client.get<{ webhook: Webhook }>(`/webhooks/${webhookId}`);
  }

  async create(params: WebhookCreateParams): Promise<{ webhook: Webhook }> {
    return this.client.post<{ webhook: Webhook }>('/webhooks', { webhook: params });
  }

  async update(webhookId: string, params: Partial<WebhookCreateParams>): Promise<{ webhook: Webhook }> {
    return this.client.put<{ webhook: Webhook }>(`/webhooks/${webhookId}`, { webhook: params });
  }

  async delete(webhookId: string): Promise<void> {
    await this.client.delete(`/webhooks/${webhookId}`);
  }
}
