import type { ConnectorClient } from './client';
import type { Event, ListEventsParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  /** GET /events */
  async list(params?: ListEventsParams): Promise<Event[] | Record<string, unknown>> {
    return this.client.get('/events', params as Record<string, string | number | boolean | undefined>);
  }
}
