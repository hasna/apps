import type { ConnectorClient } from './client';
import type { EventsListResponse, ListParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<EventsListResponse> {
    return this.client.get<EventsListResponse>('/events', params);
  }
}
