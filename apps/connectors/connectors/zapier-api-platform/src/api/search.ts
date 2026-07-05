import type { ConnectorClient } from './client';
import type { SearchParams } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(body: SearchParams): Promise<unknown> {
    return this.client.post('/search', body);
  }
}
