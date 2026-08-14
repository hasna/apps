import type { LogsFetchRequest } from '../types';
import type { ConnectorClient } from './client';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Fetch security audit logs (REST API v2 equivalent of legacy /events).
   * Requires admin privileges on most instances.
   */
  async list(body: LogsFetchRequest = {}): Promise<unknown> {
    return this.client.post('/logs/fetch', body);
  }
}
