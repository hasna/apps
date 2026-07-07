import type { ConnectorClient } from './client';
import type { JsonRecord, ListParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<JsonRecord> {
    return this.client.get<JsonRecord>('/events', params);
  }
}
