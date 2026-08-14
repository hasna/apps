import type { UserflowClient } from './client';
import type { CursorListParams } from '../types';

export class EventsApi {
  constructor(private readonly client: UserflowClient) {}

  async trackEvent(options: {
    user_id: string;
    name: string;
    attributes?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.client.post('/v2/events', options);
  }

  async listEvents(params: CursorListParams = {}): Promise<unknown> {
    return this.client.get('/v2/event_definitions', params);
  }
}
