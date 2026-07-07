import type { WebexClient } from './client';
import type {
  PaginatedResponse,
  WebexWebhook,
  WebexWebhookCreateRequest,
  WebexWebhookUpdateRequest,
  ListWebhooksOptions,
} from '../types';

export class WebhooksApi {
  constructor(private readonly client: WebexClient) {}

  async list(options: ListWebhooksOptions = {}): Promise<WebexWebhook[]> {
    const response = await this.client.get<PaginatedResponse<WebexWebhook>>('/webhooks', {
      max: options.max,
    });
    return response.items ?? [];
  }

  async get(webhookId: string): Promise<WebexWebhook> {
    return this.client.get<WebexWebhook>(`/webhooks/${encodeURIComponent(webhookId)}`);
  }

  async create(webhook: WebexWebhookCreateRequest): Promise<WebexWebhook> {
    return this.client.post<WebexWebhook>('/webhooks', webhook);
  }

  async update(webhookId: string, updates: WebexWebhookUpdateRequest): Promise<WebexWebhook> {
    return this.client.put<WebexWebhook>(`/webhooks/${encodeURIComponent(webhookId)}`, updates);
  }

  async delete(webhookId: string): Promise<void> {
    await this.client.delete(`/webhooks/${encodeURIComponent(webhookId)}`);
  }
}
