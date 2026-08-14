import type { DiscordClient } from './client';
import type {
  DiscordWebhook,
  DiscordMessage,
  Snowflake,
  ExecuteWebhookOptions,
  EditMessageOptions,
} from '../types';

export class WebhooksApi {
  constructor(private readonly client: DiscordClient) {}

  /**
   * Get a webhook by ID
   */
  async get(webhookId: Snowflake): Promise<DiscordWebhook> {
    return this.client.get<DiscordWebhook>(`/webhooks/${webhookId}`);
  }

  /**
   * Get a webhook with token (no auth required)
   */
  async getWithToken(webhookId: Snowflake, token: string): Promise<DiscordWebhook> {
    return this.client.get<DiscordWebhook>(`/webhooks/${webhookId}/${token}`);
  }

  /**
   * Modify a webhook
   */
  async modify(
    webhookId: Snowflake,
    options: {
      name?: string;
      avatar?: string | null;
      channel_id?: Snowflake;
    },
    reason?: string
  ): Promise<DiscordWebhook> {
    return this.client.patch<DiscordWebhook>(`/webhooks/${webhookId}`, options, reason);
  }

  /**
   * Modify a webhook with token (no auth required)
   */
  async modifyWithToken(
    webhookId: Snowflake,
    token: string,
    options: {
      name?: string;
      avatar?: string | null;
    }
  ): Promise<DiscordWebhook> {
    return this.client.patch<DiscordWebhook>(`/webhooks/${webhookId}/${token}`, options);
  }

  /**
   * Delete a webhook
   */
  async delete(webhookId: Snowflake, reason?: string): Promise<void> {
    return this.client.delete(`/webhooks/${webhookId}`, reason);
  }

  /**
   * Delete a webhook with token (no auth required)
   */
  async deleteWithToken(webhookId: Snowflake, token: string): Promise<void> {
    return this.client.delete(`/webhooks/${webhookId}/${token}`);
  }

  /**
   * Execute a webhook
   */
  async execute(
    webhookId: Snowflake,
    token: string,
    options: ExecuteWebhookOptions,
    queryParams?: { wait?: boolean; thread_id?: Snowflake }
  ): Promise<DiscordMessage | void> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (queryParams?.wait) params.wait = queryParams.wait;
    if (queryParams?.thread_id) params.thread_id = queryParams.thread_id;

    return this.client.request<DiscordMessage | void>(`/webhooks/${webhookId}/${token}`, {
      method: 'POST',
      body: options,
      params,
    });
  }

  /**
   * Execute a Slack-compatible webhook
   */
  async executeSlack(
    webhookId: Snowflake,
    token: string,
    options: Record<string, unknown>,
    queryParams?: { wait?: boolean; thread_id?: Snowflake }
  ): Promise<void> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (queryParams?.wait) params.wait = queryParams.wait;
    if (queryParams?.thread_id) params.thread_id = queryParams.thread_id;

    return this.client.request(`/webhooks/${webhookId}/${token}/slack`, {
      method: 'POST',
      body: options,
      params,
    });
  }

  /**
   * Execute a GitHub-compatible webhook
   */
  async executeGitHub(
    webhookId: Snowflake,
    token: string,
    options: Record<string, unknown>,
    queryParams?: { wait?: boolean; thread_id?: Snowflake }
  ): Promise<void> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (queryParams?.wait) params.wait = queryParams.wait;
    if (queryParams?.thread_id) params.thread_id = queryParams.thread_id;

    return this.client.request(`/webhooks/${webhookId}/${token}/github`, {
      method: 'POST',
      body: options,
      params,
    });
  }

  /**
   * Get webhook message
   */
  async getMessage(
    webhookId: Snowflake,
    token: string,
    messageId: Snowflake,
    threadId?: Snowflake
  ): Promise<DiscordMessage> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (threadId) params.thread_id = threadId;

    return this.client.get<DiscordMessage>(
      `/webhooks/${webhookId}/${token}/messages/${messageId}`,
      params
    );
  }

  /**
   * Edit webhook message
   */
  async editMessage(
    webhookId: Snowflake,
    token: string,
    messageId: Snowflake,
    options: EditMessageOptions,
    threadId?: Snowflake
  ): Promise<DiscordMessage> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (threadId) params.thread_id = threadId;

    return this.client.request<DiscordMessage>(
      `/webhooks/${webhookId}/${token}/messages/${messageId}`,
      {
        method: 'PATCH',
        body: options,
        params,
      }
    );
  }

  /**
   * Delete webhook message
   */
  async deleteMessage(
    webhookId: Snowflake,
    token: string,
    messageId: Snowflake,
    threadId?: Snowflake
  ): Promise<void> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (threadId) params.thread_id = threadId;

    return this.client.request(`/webhooks/${webhookId}/${token}/messages/${messageId}`, {
      method: 'DELETE',
      params,
    });
  }
}
