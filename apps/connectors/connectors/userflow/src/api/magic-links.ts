import type { UserflowClient } from './client';

export class MagicLinksApi {
  constructor(private readonly client: UserflowClient) {}

  async createMagicLink(options: {
    user_id: string;
    expires_at?: string;
  }): Promise<unknown> {
    return this.client.post('/v2/magic_links', options);
  }
}
