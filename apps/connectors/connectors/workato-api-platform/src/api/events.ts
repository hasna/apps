import type { ListQueryParams } from '../types';
import type { ConnectorClient } from './client';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: ListQueryParams): Promise<unknown> {
    return this.client.get('/events', params);
  }
}
