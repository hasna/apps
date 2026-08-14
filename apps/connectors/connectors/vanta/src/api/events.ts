import type { VantaClient } from './client';
import type { EventLog, ListEventsParams, PaginatedResponse } from '../types';

export class EventsApi {
  constructor(private readonly client: VantaClient) {}

  list(params: ListEventsParams = {}): Promise<PaginatedResponse<EventLog>> {
    return this.client.get<PaginatedResponse<EventLog>>('/event-logs', {
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
      startDate: params.startDate,
    });
  }
}
