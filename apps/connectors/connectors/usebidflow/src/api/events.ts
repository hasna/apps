import type { UsebidflowClient } from './client';
import type { EventListResponse, SearchParams, SearchResponse } from '../types';

export class EventsApi {
  constructor(private readonly client: UsebidflowClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<EventListResponse> {
    return this.client.get<EventListResponse>('/events', params);
  }

  search(body: SearchParams): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', body);
  }
}
