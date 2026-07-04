import type { ZohoCliqClient } from './client';

export class BuddiesApi {
  constructor(private readonly client: ZohoCliqClient) {}

  async list(options?: { limit?: number; offset?: number }): Promise<unknown> {
    return this.client.get('/buddies', {
      limit: options?.limit,
      offset: options?.offset,
    });
  }
}
