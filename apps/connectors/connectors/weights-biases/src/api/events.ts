import type { EventsListResponse } from '../types';
import type { WeightsBiasesClient } from './client';

export interface ListEventsParams {
  entity?: string;
  project?: string;
  runId?: string;
  perPage?: number;
  [key: string]: string | number | boolean | undefined;
}

export class EventsApi {
  constructor(private readonly client: WeightsBiasesClient) {}

  list(params?: ListEventsParams): Promise<EventsListResponse> {
    return this.client.get<EventsListResponse>('/events', params);
  }
}
