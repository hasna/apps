import type { EventTrackPayload } from '../types';
import type { ConnectorClient } from './client';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  track(payload: EventTrackPayload): Promise<void> {
    return this.client.post('/events', payload as unknown as Record<string, unknown>);
  }
}
