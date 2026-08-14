import type { ListEventsParams } from '../types';
import { ConnectorClient } from './client';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: ListEventsParams): Promise<unknown> {
    return this.client.get<unknown>('/events', params);
  }
}
