import type { QuoClient } from './client';
import type { Webhook, WebhookListResponse, CreateWebhookParams, MessageWebhookEvent, CallWebhookEvent, CallSummaryWebhookEvent, CallTranscriptWebhookEvent } from '../types';

export type WebhookType = 'messages' | 'calls' | 'call-summaries' | 'call-transcripts';

/**
 * Webhooks API module
 * Create and manage webhook subscriptions
 */
export class WebhooksApi {
  constructor(private readonly client: QuoClient) {}

  /**
   * List all webhooks
   */
  async list(): Promise<WebhookListResponse> {
    return this.client.get<WebhookListResponse>('/webhooks');
  }

  /**
   * Get a webhook by ID
   */
  async get(webhookId: string): Promise<{ data: Webhook }> {
    return this.client.get<{ data: Webhook }>(`/webhooks/${webhookId}`);
  }

  /**
   * Delete a webhook by ID
   */
  async delete(webhookId: string): Promise<void> {
    await this.client.delete(`/webhooks/${webhookId}`);
  }

  /**
   * Create a new webhook for messages
   */
  async createForMessages(params: {
    url: string;
    events: MessageWebhookEvent[];
    label?: string;
    status?: 'enabled' | 'disabled';
    resourceIds?: string[];
    userId?: string;
  }): Promise<{ data: Webhook }> {
    return this.client.post<{ data: Webhook }>('/webhooks/messages', params);
  }

  /**
   * Create a new webhook for calls
   */
  async createForCalls(params: {
    url: string;
    events: CallWebhookEvent[];
    label?: string;
    status?: 'enabled' | 'disabled';
    resourceIds?: string[];
    userId?: string;
  }): Promise<{ data: Webhook }> {
    return this.client.post<{ data: Webhook }>('/webhooks/calls', params);
  }

  /**
   * Create a new webhook for call summaries
   */
  async createForCallSummaries(params: {
    url: string;
    events: CallSummaryWebhookEvent[];
    label?: string;
    status?: 'enabled' | 'disabled';
    resourceIds?: string[];
    userId?: string;
  }): Promise<{ data: Webhook }> {
    return this.client.post<{ data: Webhook }>('/webhooks/call-summaries', params);
  }

  /**
   * Create a new webhook for call transcripts
   */
  async createForCallTranscripts(params: {
    url: string;
    events: CallTranscriptWebhookEvent[];
    label?: string;
    status?: 'enabled' | 'disabled';
    resourceIds?: string[];
    userId?: string;
  }): Promise<{ data: Webhook }> {
    return this.client.post<{ data: Webhook }>('/webhooks/call-transcripts', params);
  }

  /**
   * Create a webhook with auto-detection of type based on events
   */
  async create(params: CreateWebhookParams): Promise<{ data: Webhook }> {
    const events = params.events;

    // Determine webhook type based on events
    if (events.some(e => e.startsWith('message.'))) {
      return this.createForMessages({
        ...params,
        events: events as MessageWebhookEvent[],
      });
    } else if (events.some(e => e === 'call.summary.completed')) {
      return this.createForCallSummaries({
        ...params,
        events: events as CallSummaryWebhookEvent[],
      });
    } else if (events.some(e => e === 'call.transcript.completed')) {
      return this.createForCallTranscripts({
        ...params,
        events: events as CallTranscriptWebhookEvent[],
      });
    } else if (events.some(e => e.startsWith('call.'))) {
      return this.createForCalls({
        ...params,
        events: events as CallWebhookEvent[],
      });
    }

    throw new Error('Unable to determine webhook type from events');
  }
}
