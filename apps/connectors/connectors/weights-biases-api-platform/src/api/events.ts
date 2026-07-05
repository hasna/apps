import type { EventsListResponse } from '../types';
import type { WeightsBiasesApiPlatformClient } from './client';

export interface ListEventsParams {
  itemId?: string;
  perPage?: number;
  [key: string]: string | number | boolean | undefined;
}

export class EventsApi {
  constructor(private readonly client: WeightsBiasesApiPlatformClient) {}

  list(params?: ListEventsParams): Promise<EventsListResponse> {
    return this.client.get<EventsListResponse>('/events', params);
  }
}
