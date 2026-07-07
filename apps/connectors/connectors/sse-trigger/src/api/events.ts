import type { SseTriggerClient } from './client';
import type { Event, JsonRecord } from '../types';

export class EventsApi {
  constructor(private readonly client: SseTriggerClient) {}

  async list(params?: Record<string, string | number | boolean | undefined>): Promise<Event[] | JsonRecord> {
    return this.client.get<Event[] | JsonRecord>('/events', params);
  }
}
