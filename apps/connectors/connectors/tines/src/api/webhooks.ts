import type { TinesClient } from './client';

export class WebhooksApi {
  constructor(private readonly client: TinesClient) {}

  send(path: string, secret: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.client.sendWebhook(path, secret, payload);
  }
}
