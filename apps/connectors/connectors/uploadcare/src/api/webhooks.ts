import type { UploadcareClient } from './client';
import type { UploadcareWebhook, UploadcareWebhookList } from '../types';

function webhookPath(id: string): string {
  return `/webhooks/${encodeURIComponent(id)}`;
}

export class WebhooksApi {
  constructor(private readonly client: UploadcareClient) {}

  async list(params?: {
    limit?: number;
    from?: string;
    to?: string;
    ordering?: string;
  }): Promise<UploadcareWebhookList> {
    return this.client.get<UploadcareWebhookList>('/webhooks', params);
  }

  async create(body: Record<string, unknown>): Promise<UploadcareWebhook> {
    return this.client.post<UploadcareWebhook>('/webhooks', body);
  }

  async update(id: string, body: Record<string, unknown>): Promise<UploadcareWebhook> {
    return this.client.put<UploadcareWebhook>(webhookPath(id), body);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(webhookPath(id));
  }
}
