import type { TinybirdClient } from './client';

export class TokensApi {
  constructor(private readonly client: TinybirdClient) {}

  async list(): Promise<unknown> {
    return this.client.request('/v0/tokens');
  }

  async get(id: string): Promise<unknown> {
    return this.client.request(`/v0/tokens/${encodeURIComponent(id)}`);
  }

  async create(options: { name: string; scopes: string[]; description?: string }): Promise<unknown> {
    return this.client.request('/v0/tokens', {
      method: 'POST',
      body: {
        name: options.name,
        scopes: options.scopes,
        description: options.description,
      },
    });
  }

  async update(
    id: string,
    options: { name?: string; scopes?: string[]; description?: string },
  ): Promise<unknown> {
    return this.client.request(`/v0/tokens/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: options,
    });
  }

  async delete(id: string): Promise<unknown> {
    return this.client.request(`/v0/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
