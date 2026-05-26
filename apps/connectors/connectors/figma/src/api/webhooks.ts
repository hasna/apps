import type { FigmaClient } from './client';
import type {
  Webhook,
  WebhookRequest,
  WebhooksResponse,
  WebhookEventType,
  WebhookStatus,
  WebhookRequestsResponse,
} from '../types';

/**
 * Figma Webhooks API
 */
export class WebhooksApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * Get team webhooks
   * @param teamId - The team ID
   */
  async getTeamWebhooks(teamId: string): Promise<WebhooksResponse> {
    return this.client.request<WebhooksResponse>(`/teams/${teamId}/webhooks`);
  }

  /**
   * Create a webhook
   * @param teamId - The team ID
   * @param options - Webhook configuration
   */
  async createWebhook(
    teamId: string,
    options: {
      event_type: WebhookEventType;
      endpoint: string;
      passcode: string;
      status?: WebhookStatus;
      description?: string;
    }
  ): Promise<Webhook> {
    const body: WebhookRequest = {
      ...options,
      team_id: teamId,
    };

    return this.client.request<Webhook>('/webhooks', {
      method: 'POST',
      body,
    });
  }

  /**
   * Get a specific webhook
   * @param webhookId - The webhook ID
   */
  async getWebhook(webhookId: string): Promise<Webhook> {
    return this.client.request<Webhook>(`/webhooks/${webhookId}`);
  }

  /**
   * Update a webhook
   * @param webhookId - The webhook ID
   * @param options - Fields to update
   */
  async updateWebhook(
    webhookId: string,
    options: {
      event_type?: WebhookEventType;
      endpoint?: string;
      passcode?: string;
      status?: WebhookStatus;
      description?: string;
    }
  ): Promise<Webhook> {
    return this.client.request<Webhook>(`/webhooks/${webhookId}`, {
      method: 'PUT',
      body: options,
    });
  }

  /**
   * Delete a webhook
   * @param webhookId - The webhook ID
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    await this.client.request<void>(`/webhooks/${webhookId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get webhook requests (history)
   * @param webhookId - The webhook ID
   */
  async getWebhookRequests(webhookId: string): Promise<WebhookRequestsResponse> {
    return this.client.request<WebhookRequestsResponse>(`/webhooks/${webhookId}/requests`);
  }
}
