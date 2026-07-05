import type { ConnectorClient } from './client';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/events', params);
  }
}
