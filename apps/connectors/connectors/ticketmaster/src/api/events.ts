import type { ConnectorClient } from './client';
import type { EventsSearchParams, EventsSearchResponse, DiscoveryEvent } from '../types';

function toQueryParams(params: EventsSearchParams): Record<string, string | number | boolean | undefined> {
  return { ...params };
}

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(params?: EventsSearchParams): Promise<EventsSearchResponse> {
    return this.client.get<EventsSearchResponse>('/events.json', toQueryParams(params ?? {}));
  }

  async get(id: string): Promise<DiscoveryEvent> {
    const encodedId = encodeURIComponent(id);
    return this.client.get<DiscoveryEvent>(`/events/${encodedId}.json`);
  }
}
