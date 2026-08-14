import type { SquarespaceClient } from './client';
import type { WebhookSubscription } from '../types';

export interface WebhooksListResponse {
  webhookSubscriptions: WebhookSubscription[];
}

export class WebhooksApi {
  constructor(private readonly client: SquarespaceClient) {}

  async list(): Promise<WebhooksListResponse> {
    return this.client.request<WebhooksListResponse>('/webhook_subscriptions');
  }

  async create(endpointUrl: string, topics: string[]): Promise<WebhookSubscription> {
    return this.client.request<WebhookSubscription>('/webhook_subscriptions', {
      method: 'POST',
      body: { endpointUrl, topics },
    });
  }

  async delete(id: string): Promise<void> {
    await this.client.request<void>(`/webhook_subscriptions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async rotateSecret(id: string): Promise<WebhookSubscription> {
    return this.client.request<WebhookSubscription>(
      `/webhook_subscriptions/${encodeURIComponent(id)}/actions/rotateSecret`,
      { method: 'POST' },
    );
  }
}
