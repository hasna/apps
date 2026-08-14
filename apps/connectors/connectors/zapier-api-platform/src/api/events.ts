import type { ConnectorClient } from './client';
import type { EventListParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: EventListParams): Promise<unknown> {
    return this.client.get('/events', params as Record<string, string | number | boolean | undefined>);
  }
}
