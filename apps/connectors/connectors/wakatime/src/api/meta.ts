import type { WakatimeClient } from './client';

export class MetaApi {
  constructor(private readonly client: WakatimeClient) {}

  async get(): Promise<unknown> {
    return this.client.get('/meta');
  }
}
