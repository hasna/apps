import type { GoogleCalendarClient } from './client';
import type { Calendar, CalendarListResponse, ListCalendarsParams } from '../types';

/**
 * Calendars API module
 */
export class CalendarsApi {
  constructor(private readonly client: GoogleCalendarClient) {}

  /**
   * List all calendars in the user's calendar list
   */
  async list(options?: ListCalendarsParams): Promise<CalendarListResponse> {
    return this.client.get<CalendarListResponse>('/users/me/calendarList', {
      maxResults: options?.maxResults,
      minAccessRole: options?.minAccessRole,
      pageToken: options?.pageToken,
      showDeleted: options?.showDeleted,
      showHidden: options?.showHidden,
      syncToken: options?.syncToken,
    });
  }

  /**
   * Get a specific calendar from the user's calendar list
   */
  async get(calendarId: string): Promise<Calendar> {
    return this.client.get<Calendar>(`/users/me/calendarList/${encodeURIComponent(calendarId)}`);
  }

  /**
   * Get the primary calendar
   */
  async getPrimary(): Promise<Calendar> {
    return this.get('primary');
  }

  /**
   * Insert an existing calendar into the user's calendar list
   */
  async insert(calendarId: string, options?: {
    colorRgbFormat?: boolean;
    backgroundColor?: string;
    foregroundColor?: string;
    colorId?: string;
    hidden?: boolean;
    selected?: boolean;
    summaryOverride?: string;
    defaultReminders?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  }): Promise<Calendar> {
    return this.client.post<Calendar>('/users/me/calendarList', {
      id: calendarId,
      ...options,
    }, {
      colorRgbFormat: options?.colorRgbFormat,
    });
  }

  /**
   * Update metadata for a calendar in the user's calendar list
   */
  async update(calendarId: string, updates: {
    colorRgbFormat?: boolean;
    backgroundColor?: string;
    foregroundColor?: string;
    colorId?: string;
    hidden?: boolean;
    selected?: boolean;
    summaryOverride?: string;
    defaultReminders?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  }): Promise<Calendar> {
    const { colorRgbFormat, ...body } = updates;
    return this.client.patch<Calendar>(
      `/users/me/calendarList/${encodeURIComponent(calendarId)}`,
      body,
      { colorRgbFormat }
    );
  }

  /**
   * Remove a calendar from the user's calendar list
   */
  async delete(calendarId: string): Promise<void> {
    await this.client.delete(`/users/me/calendarList/${encodeURIComponent(calendarId)}`);
  }

  /**
   * Watch for changes to calendar list (requires push notifications setup)
   */
  async watch(options: {
    id: string;
    type: 'web_hook';
    address: string;
    token?: string;
    expiration?: string;
  }): Promise<{
    kind: string;
    id: string;
    resourceId: string;
    resourceUri: string;
    token?: string;
    expiration?: string;
  }> {
    return this.client.post('/users/me/calendarList/watch', options);
  }
}
