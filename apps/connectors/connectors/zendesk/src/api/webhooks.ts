import type { ZendeskClient } from './client';
import type {
  ZendeskWebhook,
  ZendeskWebhookResponse,
  ZendeskWebhooksResponse,
  CreateWebhookRequest,
  UpdateWebhookRequest,
  WebhookListParams,
  WebhookInvocation,
} from '../types';

/**
 * Zendesk Webhooks API
 * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/
 */
export class WebhooksApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all webhooks
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#list-webhooks
   */
  async list(params?: WebhookListParams): Promise<ZendeskWebhook[]> {
    const response = await this.client.get<ZendeskWebhooksResponse>('/webhooks.json', {
      page: params?.page,
      per_page: params?.per_page,
      filter: params?.filter,
      sort: params?.sort,
    });
    return response.webhooks;
  }

  /**
   * Get a webhook by ID
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#show-webhook
   */
  async get(webhookId: string): Promise<ZendeskWebhook> {
    const response = await this.client.get<ZendeskWebhookResponse>(`/webhooks/${webhookId}.json`);
    return response.webhook;
  }

  /**
   * Create a new webhook
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#create-or-clone-webhook
   */
  async create(data: CreateWebhookRequest): Promise<ZendeskWebhook> {
    const response = await this.client.post<ZendeskWebhookResponse>('/webhooks.json', data);
    return response.webhook;
  }

  /**
   * Update a webhook
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#update-webhook
   */
  async update(webhookId: string, data: UpdateWebhookRequest): Promise<ZendeskWebhook> {
    const response = await this.client.patch<ZendeskWebhookResponse>(`/webhooks/${webhookId}.json`, data);
    return response.webhook;
  }

  /**
   * Delete a webhook
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#delete-webhook
   */
  async delete(webhookId: string): Promise<void> {
    await this.client.delete(`/webhooks/${webhookId}.json`);
  }

  /**
   * Clone a webhook
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#create-or-clone-webhook
   */
  async clone(webhookId: string): Promise<ZendeskWebhook> {
    const response = await this.client.post<ZendeskWebhookResponse>('/webhooks.json', {
      webhook: { clone_webhook_id: webhookId },
    });
    return response.webhook;
  }

  /**
   * Test a webhook
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#test-webhook
   */
  async test(webhookId: string, request: { request: unknown }): Promise<{ webhook_invocation: WebhookInvocation }> {
    return this.client.post(`/webhooks/${webhookId}/test.json`, request);
  }

  /**
   * Get webhook signing secret
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#show-webhook-signing-secret
   */
  async getSigningSecret(webhookId: string): Promise<{ signing_secret: { secret: string } }> {
    return this.client.get(`/webhooks/${webhookId}/signing_secret.json`);
  }

  /**
   * Reset webhook signing secret
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#reset-webhook-signing-secret
   */
  async resetSigningSecret(webhookId: string): Promise<{ signing_secret: { secret: string } }> {
    return this.client.post(`/webhooks/${webhookId}/signing_secret.json`);
  }

  /**
   * List webhook invocations (history)
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#list-webhook-invocations
   */
  async listInvocations(webhookId: string, params?: { page?: number; per_page?: number }): Promise<{ invocations: WebhookInvocation[] }> {
    return this.client.get(`/webhooks/${webhookId}/invocations.json`, params);
  }

  /**
   * Get a webhook invocation attempt
   * @see https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/#show-webhook-invocation-attempt
   */
  async getInvocationAttempt(webhookId: string, invocationId: string): Promise<{ invocation_attempt: WebhookInvocation }> {
    return this.client.get(`/webhooks/${webhookId}/invocations/${invocationId}/attempts.json`);
  }
}
