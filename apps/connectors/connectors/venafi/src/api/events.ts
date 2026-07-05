import type { ConnectorClient } from './client';
import type { EventListParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  /** GET /events */
  async list(params?: EventListParams): Promise<unknown> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit !== undefined) query.limit = params.limit;
    if (params?.offset !== undefined) query.offset = params.offset;
    return this.client.get('/events', query);
  }
}
