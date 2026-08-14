import type { ListEventsParams, ZipkinEvent } from '../types';
import type { ZipkinClient } from './client';

export class EventsApi {
  constructor(private readonly client: ZipkinClient) {}

  async list(params?: ListEventsParams): Promise<ZipkinEvent[]> {
    return this.client.get<ZipkinEvent[]>('/events', params);
  }
}
