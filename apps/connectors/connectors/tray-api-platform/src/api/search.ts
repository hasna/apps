import type { JsonRecord } from '../types';
import type { ConnectorClient } from './client';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  search(body: JsonRecord): Promise<unknown> {
    return this.client.post('/search', body);
  }
}
