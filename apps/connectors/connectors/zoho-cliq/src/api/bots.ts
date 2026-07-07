import type { ZohoCliqClient } from './client';

export class BotsApi {
  constructor(private readonly client: ZohoCliqClient) {}

  async list(): Promise<unknown> {
    return this.client.get('/bots');
  }
}
