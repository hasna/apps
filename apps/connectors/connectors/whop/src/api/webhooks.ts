import type { WhopClient } from './client';
import type {
  CreateWebhookParams,
  Webhook,
  WebhookListParams,
  WhopListResponse,
} from '../types';

export class WebhooksApi {
  constructor(
    private readonly client: WhopClient,
    private readonly defaultCompanyId?: string
  ) {}

  list(params: WebhookListParams = {}): Promise<WhopListResponse<Webhook>> {
    return this.client.get('/webhooks', {
      company_id: params.company_id ?? this.defaultCompanyId,
      after: params.after,
      before: params.before,
      first: params.first,
      last: params.last,
      resource_types: params.resource_types,
    });
  }

  get(id: string): Promise<Webhook> {
    return this.client.get(`/webhooks/${encodeURIComponent(id)}`);
  }

  create(body: CreateWebhookParams): Promise<Webhook> {
    return this.client.post('/webhooks', {
      ...body,
      company_id: body.company_id ?? this.defaultCompanyId,
    });
  }

  delete(id: string): Promise<void> {
    return this.client.delete(`/webhooks/${encodeURIComponent(id)}`);
  }
}
