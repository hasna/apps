import type { MercuryClient } from './client';
import type {
  Webhook,
  WebhookListResponse,
  WebhookCreateParams,
  WebhookEvent,
} from '../types';

/**
 * Mercury Webhooks API
 * Manage webhook subscriptions
 */
export class WebhooksApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List all webhooks
   */
  async list(params?: { limit?: number; offset?: number }): Promise<WebhookListResponse> {
    return this.client.get<WebhookListResponse>('/webhooks', {
      limit: params?.limit,
      offset: params?.offset,
    });
  }

  /**
   * Get a single webhook
   */
  async get(webhookId: string): Promise<Webhook> {
    return this.client.get<Webhook>(`/webhooks/${webhookId}`);
  }

  /**
   * Create a new webhook
   */
  async create(params: WebhookCreateParams): Promise<Webhook> {
    return this.client.post<Webhook>('/webhooks', params);
  }

  /**
   * Update a webhook
   */
  async update(webhookId: string, params: Partial<WebhookCreateParams & { status?: 'active' | 'disabled' }>): Promise<Webhook> {
    return this.client.post<Webhook>(`/webhooks/${webhookId}`, params);
  }

  /**
   * Delete a webhook
   */
  async delete(webhookId: string): Promise<void> {
    await this.client.delete(`/webhooks/${webhookId}`);
  }

  /**
   * Enable a webhook
   */
  async enable(webhookId: string): Promise<Webhook> {
    return this.update(webhookId, { status: 'active' });
  }

  /**
   * Disable a webhook
   */
  async disable(webhookId: string): Promise<Webhook> {
    return this.update(webhookId, { status: 'disabled' });
  }

  /**
   * Regenerate webhook secret
   */
  async regenerateSecret(webhookId: string): Promise<Webhook> {
    return this.client.post<Webhook>(`/webhooks/${webhookId}/regenerate-secret`);
  }

  /**
   * Test a webhook by sending a test event
   */
  async test(webhookId: string, event?: WebhookEvent): Promise<{ success: boolean; statusCode: number }> {
    return this.client.post<{ success: boolean; statusCode: number }>(`/webhooks/${webhookId}/test`, {
      event: event || 'transaction.created',
    });
  }

  /**
   * Verify a webhook endpoint
   */
  async verify(webhookId: string): Promise<{ verified: boolean }> {
    return this.client.post<{ verified: boolean }>(`/webhooks/${webhookId}/verify`);
  }
}
