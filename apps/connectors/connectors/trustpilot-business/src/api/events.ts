import type { TrustpilotBusinessClient } from './client';
import type { WebhooksListResponse } from '../types';

export class EventsApi {
  constructor(private readonly client: TrustpilotBusinessClient) {}

  listWebhooks(): Promise<WebhooksListResponse> {
    return this.client.get<WebhooksListResponse>('/private/webhooks', undefined, {
      privateAuth: true,
    });
  }
}
