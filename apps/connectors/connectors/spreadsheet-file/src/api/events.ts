import type { ConnectorClient } from './client';
import type { ListEventsParams, ListEventsResult } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List spreadsheet events
   * GET /events
   */
  async list(params?: ListEventsParams): Promise<ListEventsResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit !== undefined) queryParams.limit = params.limit;
    if (params?.offset !== undefined) queryParams.offset = params.offset;
    if (params?.cursor) queryParams.cursor = params.cursor;
    if (params?.fileId) queryParams.fileId = params.fileId;

    return this.client.get<ListEventsResult>('/events', queryParams);
  }
}
