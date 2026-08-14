import type { ConnectorClient } from './client';
import type { SearchParams } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(data: SearchParams): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/search', data);
  }
}
