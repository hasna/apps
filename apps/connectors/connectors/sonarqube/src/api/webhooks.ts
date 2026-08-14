import type { SonarQubeClient } from './client';
import type { Webhook, WebhooksListResponse } from '../types';

export class WebhooksApi {
  constructor(private readonly client: SonarQubeClient) {}

  async list(project?: string): Promise<WebhooksListResponse> {
    return this.client.get<WebhooksListResponse>('/api/webhooks/list', project ? { project } : undefined);
  }

  async create(options: {
    name: string;
    url: string;
    project?: string;
    secret?: string;
  }): Promise<Webhook> {
    return this.client.post<Webhook>('/api/webhooks/create', options);
  }

  async delete(webhook: string): Promise<void> {
    await this.client.post('/api/webhooks/delete', { webhook });
  }
}
