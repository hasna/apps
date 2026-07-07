import type { ConnectorClient } from './client';
import type { EventListResponse } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<EventListResponse> {
    return this.client.get<EventListResponse>('/events', params);
  }
}
