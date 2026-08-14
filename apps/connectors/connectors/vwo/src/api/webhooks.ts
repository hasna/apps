import type { ConnectorClient } from './client';
import type { Webhook, WebhookCreateParams } from '../types';

export class WebhooksApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<unknown> {
    return this.client.get('/webhooks');
  }

  async create(data: WebhookCreateParams): Promise<Webhook> {
    return this.client.post<Webhook>('/webhooks', data);
  }

  async update(id: string | number, data: Record<string, unknown>): Promise<Webhook> {
    return this.client.patch<Webhook>(`/webhooks/${encodeURIComponent(String(id))}`, data);
  }

  async delete(id: string | number): Promise<unknown> {
    return this.client.delete(`/webhooks/${encodeURIComponent(String(id))}`);
  }
}
