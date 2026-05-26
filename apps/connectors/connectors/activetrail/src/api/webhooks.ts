import type { ConnectorClient } from './client';
import type { Webhook, WebhookCreateParams, WebhookUpdateParams, ListParams } from '../types';

export class WebhooksApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<Webhook[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<Webhook[]>('/webhooks', queryParams);
  }

  async create(params: WebhookCreateParams): Promise<Webhook> {
    return this.client.post<Webhook>('/webhooks', params);
  }

  async update(webhookId: number, params: WebhookUpdateParams): Promise<void> {
    await this.client.put(`/webhooks/${webhookId}`, params);
  }

  async delete(webhookId: number): Promise<void> {
    await this.client.delete(`/webhooks/${webhookId}`);
  }

  async test(webhookId: number): Promise<unknown> {
    return this.client.post<unknown>(`/webhooks/${webhookId}/Test`);
  }
}
