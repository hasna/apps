import type { VelaClient } from './client';
import type { SyncCalendarParams } from '../types';

export class CalendarApi {
  constructor(private readonly client: VelaClient) {}

  async sync(params?: SyncCalendarParams): Promise<unknown> {
    return this.client.post<unknown>('/calendar/sync', params ?? {});
  }
}
