import type { ConnectorClient } from './client';
import type { ListEventsParams, ListEventsResult } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params: ListEventsParams = {}): Promise<ListEventsResult> {
    return this.client.get<ListEventsResult>('/events', {
      limit: params.limit,
      offset: params.offset,
      type: params.type,
      since: params.since,
      siteId: params.siteId,
    });
  }
}
