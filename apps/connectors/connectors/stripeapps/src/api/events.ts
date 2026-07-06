import type { StripeAppsClient } from './client';
import type { EventListParams, EventListResponse } from '../types';

/**
 * Events API - list account events.
 */
export class EventsApi {
  constructor(private readonly client: StripeAppsClient) {}

  /** List events (GET /events). */
  list(params: EventListParams = {}): Promise<EventListResponse> {
    return this.client.get<EventListResponse>('/events', {
      limit: params.limit,
      cursor: params.cursor,
      type: params.type,
    });
  }
}
