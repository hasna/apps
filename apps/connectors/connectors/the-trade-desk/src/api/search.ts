import type { ConnectorClient } from './client';
import type { JsonRecord } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(body: JsonRecord): Promise<JsonRecord> {
    return this.client.post<JsonRecord>('/search', body);
  }
}
