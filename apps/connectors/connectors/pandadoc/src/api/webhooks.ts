import type { PandaDocClient } from './client';
import type { Webhook, WebhookCreateParams, WebhookListResponse, WebhookSharedKeyResponse } from '../types';

export interface WebhookListOptions {
  count?: number;
  page?: number;
}

/**
 * Webhooks API - Manage PandaDoc webhooks
 */
export class WebhooksApi {
  constructor(private readonly client: PandaDocClient) {}

  /**
   * List webhooks
   */
  async list(options?: WebhookListOptions): Promise<WebhookListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options) {
      if (options.count) params.count = options.count;
      if (options.page) params.page = options.page;
    }

    return this.client.get<WebhookListResponse>('/webhook-subscriptions', params);
  }

  /**
   * Get webhook by UUID
   */
  async get(uuid: string): Promise<Webhook> {
    return this.client.get<Webhook>(`/webhook-subscriptions/${uuid}`);
  }

  /**
   * Create a new webhook
   */
  async create(params: WebhookCreateParams): Promise<Webhook> {
    return this.client.post<Webhook>('/webhook-subscriptions', params);
  }

  /**
   * Update a webhook
   */
  async update(uuid: string, params: Partial<WebhookCreateParams>): Promise<Webhook> {
    return this.client.patch<Webhook>(`/webhook-subscriptions/${uuid}`, params);
  }

  /**
   * Delete a webhook
   */
  async delete(uuid: string): Promise<void> {
    await this.client.delete(`/webhook-subscriptions/${uuid}`);
  }

  /**
   * Get webhook shared key for signature verification
   */
  async getSharedKey(): Promise<WebhookSharedKeyResponse> {
    return this.client.get<WebhookSharedKeyResponse>('/webhook-subscriptions/shared-key');
  }

  /**
   * Regenerate webhook shared key
   */
  async regenerateSharedKey(): Promise<WebhookSharedKeyResponse> {
    return this.client.post<WebhookSharedKeyResponse>('/webhook-subscriptions/shared-key');
  }

  /**
   * Available webhook events
   */
  static readonly EVENTS = [
    'document_state_changed',
    'recipient_completed',
    'document_updated',
    'document_deleted',
    'document_creation_failed',
  ] as const;
}
