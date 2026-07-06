import type { TinybirdClient } from './client';

export class JobsApi {
  constructor(private readonly client: TinybirdClient) {}

  async list(options: { limit?: number; status?: string; kind?: string } = {}): Promise<unknown> {
    return this.client.request('/v0/jobs', { params: options });
  }

  async get(id: string): Promise<unknown> {
    return this.client.request(`/v0/jobs/${encodeURIComponent(id)}`);
  }

  async cancel(id: string): Promise<unknown> {
    return this.client.request(`/v0/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }
}
