import type { JsonApiDocument, ListWebhooksParams, CreateWebhookParams } from '../types';
import type { UnitClient } from './client';
import { jsonApiBody } from './client';

export class WebhooksApi {
  constructor(private readonly client: UnitClient) {}

  list(params: ListWebhooksParams = {}): Promise<JsonApiDocument> {
    return this.client.get('/webhooks', {
      'page[offset]': params.offset,
      'page[limit]': params.limit,
      'filter[type]': params.type,
    });
  }

  create(params: CreateWebhookParams): Promise<JsonApiDocument> {
    return this.client.post('/webhooks', jsonApiBody('webhook', {
      label: params.label,
      url: params.url,
      token: params.token,
      subscriptionType: params.subscriptionType,
      deliveryMode: params.deliveryMode,
      contentType: params.contentType,
    }));
  }

  delete(id: string): Promise<JsonApiDocument> {
    return this.client.delete(`/webhooks/${encodeURIComponent(id)}`);
  }
}
