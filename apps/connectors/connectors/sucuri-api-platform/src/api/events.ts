import type { ConnectorClient } from './client';
import type { ListEventsParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List events
   * GET /events
   */
  async list(params?: ListEventsParams): Promise<unknown> {
    return this.client.get('/events', params);
  }
}
