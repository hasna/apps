import type { WufooClient } from './client';
import { encodeResourceId } from './client';
import type {
  WufooWebhookDeleteResponse,
  WufooWebhookPutParams,
  WufooWebhookPutResponse,
} from '../types';

export class WebhooksApi {
  constructor(private readonly client: WufooClient) {}

  async add(formId: string, params: WufooWebhookPutParams): Promise<WufooWebhookPutResponse> {
    const id = encodeResourceId(formId);
    const formBody: Record<string, string | number | boolean | undefined> = {
      url: params.url,
    };
    if (params.handshakeKey !== undefined) {
      formBody.handshakeKey = params.handshakeKey;
    }
    if (params.metadata !== undefined) {
      formBody.metadata = String(params.metadata);
    }
    return this.client.putForm<WufooWebhookPutResponse>(`/forms/${id}/webhooks.json`, formBody);
  }

  async delete(formId: string, webhookHash: string): Promise<WufooWebhookDeleteResponse> {
    const id = encodeResourceId(formId);
    const hash = encodeResourceId(webhookHash);
    return this.client.delete<WufooWebhookDeleteResponse>(`/forms/${id}/webhooks/${hash}.json`);
  }
}
