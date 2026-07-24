import type { JsonApiDocument, ListEventsParams } from '../types';
import type { UnitClient } from './client';

export class EventsApi {
  constructor(private readonly client: UnitClient) {}

  list(params: ListEventsParams = {}): Promise<JsonApiDocument> {
    return this.client.get('/events', {
      'page[offset]': params.offset,
      'page[limit]': params.limit,
      'filter[type][]': params.type,
      'filter[since]': params.since,
      'filter[until]': params.until,
    });
  }
}
