import type { ConnectorClient } from './client';
import type { Event, ListEventsParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params: ListEventsParams = {}): Promise<Event[] | Record<string, unknown>> {
    return this.client.get<Event[] | Record<string, unknown>>('/events', params);
  }
}
