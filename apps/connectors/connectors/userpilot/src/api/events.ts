import type { ListEventsOptions } from '../types';
import type { UserpilotClient } from './client';

export class EventsApi {
  constructor(private readonly client: UserpilotClient) {}

  list(options: ListEventsOptions = {}): Promise<unknown> {
    return this.client.get('/events', options);
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/events/${encodeURIComponent(id)}`);
  }
}
