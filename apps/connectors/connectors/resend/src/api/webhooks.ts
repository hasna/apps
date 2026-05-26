import type { ResendClient } from './client';
import type {
  Webhook,
  CreateWebhookParams,
  UpdateWebhookParams,
  ListResponse,
} from '../types';

/**
 * Webhooks API - Create, list, get, update, and delete webhook subscriptions
 * https://resend.com/docs/api-reference/webhooks
 */
export class WebhooksApi {
  constructor(private readonly client: ResendClient) {}

  /**
   * Create a new webhook subscription
   * POST /webhooks
   */
  async create(params: CreateWebhookParams): Promise<Webhook> {
    return this.client.post<Webhook>('/webhooks', params);
  }

  /**
   * List all webhooks
   * GET /webhooks
   */
  async list(): Promise<ListResponse<Webhook>> {
    return this.client.get<ListResponse<Webhook>>('/webhooks');
  }

  /**
   * Get a single webhook by ID
   * GET /webhooks/:id
   */
  async get(webhookId: string): Promise<Webhook> {
    return this.client.get<Webhook>(`/webhooks/${webhookId}`);
  }

  /**
   * Update a webhook
   * PUT /webhooks/:id
   */
  async update(webhookId: string, params: UpdateWebhookParams): Promise<Webhook> {
    return this.client.put<Webhook>(`/webhooks/${webhookId}`, params);
  }

  /**
   * Delete a webhook
   * DELETE /webhooks/:id
   */
  async delete(webhookId: string): Promise<{ deleted: boolean; id: string }> {
    return this.client.delete<{ deleted: boolean; id: string }>(`/webhooks/${webhookId}`);
  }
}
