import type { ConnectorClient } from './client';
import type { EventListResponse, EventResponse, ListParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<EventListResponse> {
    return this.client.get<EventListResponse>('/events', params as Record<string, string | number>);
  }

  async get(id: string): Promise<EventResponse> {
    return this.client.get<EventResponse>(`/events/${encodeURIComponent(id)}`);
  }
}
