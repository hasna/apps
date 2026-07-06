import type { EventListParams } from '../types';
import type { TrueLayerClient } from './client';

export class EventsApi {
  constructor(private readonly client: TrueLayerClient) {}

  async listEvents(params?: EventListParams): Promise<unknown> {
    return this.client.request('/events', { params });
  }
}
