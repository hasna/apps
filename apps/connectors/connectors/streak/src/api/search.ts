import type { ConnectorClient } from './client';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(query: string): Promise<unknown> {
    return this.client.get<unknown>('/search', { query });
  }
}
