import type { GoogleCalendarClient } from './client';
import type { FreeBusyRequest, FreeBusyCalendarResponse } from '../types';

/**
 * Free/Busy API module - query free/busy time for calendars
 */
export class FreeBusyApi {
  constructor(private readonly client: GoogleCalendarClient) {}

  /**
   * Query free/busy information for one or more calendars
   */
  async query(request: FreeBusyRequest): Promise<FreeBusyCalendarResponse> {
    return this.client.post<FreeBusyCalendarResponse>('/freeBusy', {
      timeMin: request.timeMin || new Date().toISOString(),
      timeMax: request.timeMax || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      items: request.items,
      groupExpansionMax: request.groupExpansionMax,
      timeZone: request.timeZone,
    });
  }

  /**
   * Quick check if a calendar is free during a time range
   */
  async isFree(calendarId: string, start: string, end: string): Promise<boolean> {
    const result = await this.query({
      timeMin: start,
      timeMax: end,
      items: [{ id: calendarId }],
    });
    const calendar = result.calendars[calendarId];
    return !calendar || calendar.busy.length === 0;
  }
}
