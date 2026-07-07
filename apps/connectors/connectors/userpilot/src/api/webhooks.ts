import type { CreateWebhookOptions } from '../types';
import type { UserpilotClient } from './client';

export class WebhooksApi {
  constructor(private readonly client: UserpilotClient) {}

  create(options: CreateWebhookOptions): Promise<unknown> {
    return this.client.post('/webhooks', options);
  }

  list(): Promise<unknown> {
    return this.client.get('/webhooks');
  }

  delete(id: string): Promise<unknown> {
    return this.client.delete(`/webhooks/${encodeURIComponent(id)}`);
  }
}
