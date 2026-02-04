import type { GoogleClient } from './client';
import type {
  CalendarEvent,
  CalendarListEventsResponse,
  Calendar,
  CalendarListResponse,
  CalendarEventCreateParams,
  CalendarEventDateTime,
} from '../types';

/**
 * Google Calendar API module
 * https://www.googleapis.com/calendar/v3
 */
export class CalendarApi {
  constructor(private readonly client: GoogleClient) {}

  // ============================================
  // Calendars
  // ============================================

  /**
   * List all calendars for the user
   */
  async listCalendars(options?: {
    maxResults?: number;
    pageToken?: string;
    showDeleted?: boolean;
    showHidden?: boolean;
  }): Promise<CalendarListResponse> {
    return this.client.calendarGet<CalendarListResponse>('/users/me/calendarList', {
      maxResults: options?.maxResults || 100,
      pageToken: options?.pageToken,
      showDeleted: options?.showDeleted,
      showHidden: options?.showHidden,
    });
  }

  /**
   * Get a specific calendar
   */
  async getCalendar(calendarId: string): Promise<Calendar> {
    return this.client.calendarGet<Calendar>(`/users/me/calendarList/${encodeURIComponent(calendarId)}`);
  }

  /**
   * Create a new calendar
   */
  async createCalendar(summary: string, options?: {
    description?: string;
    location?: string;
    timeZone?: string;
  }): Promise<Calendar> {
    return this.client.calendarPost<Calendar>('/calendars', {
      summary,
      description: options?.description,
      location: options?.location,
      timeZone: options?.timeZone,
    });
  }

  /**
   * Update a calendar
   */
  async updateCalendar(calendarId: string, options: {
    summary?: string;
    description?: string;
    location?: string;
    timeZone?: string;
  }): Promise<Calendar> {
    return this.client.calendarPatch<Calendar>(`/calendars/${encodeURIComponent(calendarId)}`, options);
  }

  /**
   * Delete a calendar
   */
  async deleteCalendar(calendarId: string): Promise<void> {
    await this.client.calendarDelete(`/calendars/${encodeURIComponent(calendarId)}`);
  }

  /**
   * Clear all events from a calendar
   */
  async clearCalendar(calendarId: string): Promise<void> {
    await this.client.calendarPost(`/calendars/${encodeURIComponent(calendarId)}/clear`, {});
  }

  // ============================================
  // Events
  // ============================================

  /**
   * List events from a calendar
   */
  async listEvents(calendarId: string = 'primary', options?: {
    maxResults?: number;
    pageToken?: string;
    timeMin?: string;
    timeMax?: string;
    singleEvents?: boolean;
    orderBy?: 'startTime' | 'updated';
    q?: string;
    showDeleted?: boolean;
    showHiddenInvitations?: boolean;
    timeZone?: string;
    updatedMin?: string;
    iCalUID?: string;
  }): Promise<CalendarListEventsResponse> {
    return this.client.calendarGet<CalendarListEventsResponse>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      maxResults: options?.maxResults || 250,
      pageToken: options?.pageToken,
      timeMin: options?.timeMin,
      timeMax: options?.timeMax,
      singleEvents: options?.singleEvents,
      orderBy: options?.orderBy,
      q: options?.q,
      showDeleted: options?.showDeleted,
      showHiddenInvitations: options?.showHiddenInvitations,
      timeZone: options?.timeZone,
      updatedMin: options?.updatedMin,
      iCalUID: options?.iCalUID,
    });
  }

  /**
   * Get a specific event
   */
  async getEvent(calendarId: string, eventId: string, options?: {
    timeZone?: string;
    maxAttendees?: number;
  }): Promise<CalendarEvent> {
    return this.client.calendarGet<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      {
        timeZone: options?.timeZone,
        maxAttendees: options?.maxAttendees,
      }
    );
  }

  /**
   * Create a new event
   */
  async createEvent(calendarId: string = 'primary', params: CalendarEventCreateParams): Promise<CalendarEvent> {
    const body: Record<string, unknown> = {
      summary: params.summary,
      start: params.start,
      end: params.end,
    };

    if (params.description) body.description = params.description;
    if (params.location) body.location = params.location;
    if (params.attendees) body.attendees = params.attendees;
    if (params.recurrence) body.recurrence = params.recurrence;
    if (params.reminders) body.reminders = params.reminders;
    if (params.colorId) body.colorId = params.colorId;
    if (params.visibility) body.visibility = params.visibility;

    return this.client.calendarPost<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      body,
      {
        sendUpdates: params.sendUpdates,
      }
    );
  }

  /**
   * Update an event
   */
  async updateEvent(calendarId: string, eventId: string, params: Partial<CalendarEventCreateParams>): Promise<CalendarEvent> {
    const body: Record<string, unknown> = {};

    if (params.summary !== undefined) body.summary = params.summary;
    if (params.description !== undefined) body.description = params.description;
    if (params.location !== undefined) body.location = params.location;
    if (params.start !== undefined) body.start = params.start;
    if (params.end !== undefined) body.end = params.end;
    if (params.attendees !== undefined) body.attendees = params.attendees;
    if (params.recurrence !== undefined) body.recurrence = params.recurrence;
    if (params.reminders !== undefined) body.reminders = params.reminders;
    if (params.colorId !== undefined) body.colorId = params.colorId;
    if (params.visibility !== undefined) body.visibility = params.visibility;

    return this.client.calendarPatch<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      body,
      {
        sendUpdates: params.sendUpdates,
      }
    );
  }

  /**
   * Delete an event
   */
  async deleteEvent(calendarId: string, eventId: string, options?: {
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }): Promise<void> {
    await this.client.calendarDelete(
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      {
        sendUpdates: options?.sendUpdates,
      }
    );
  }

  /**
   * Move an event to another calendar
   */
  async moveEvent(calendarId: string, eventId: string, destinationCalendarId: string, options?: {
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }): Promise<CalendarEvent> {
    return this.client.calendarPost<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}/move`,
      {},
      {
        destination: destinationCalendarId,
        sendUpdates: options?.sendUpdates,
      }
    );
  }

  /**
   * Quick add an event using text
   */
  async quickAddEvent(calendarId: string = 'primary', text: string, options?: {
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }): Promise<CalendarEvent> {
    return this.client.calendarPost<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/quickAdd`,
      {},
      {
        text,
        sendUpdates: options?.sendUpdates,
      }
    );
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get upcoming events for today
   */
  async getTodayEvents(calendarId: string = 'primary'): Promise<CalendarListEventsResponse> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    return this.listEvents(calendarId, {
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
  }

  /**
   * Get upcoming events for this week
   */
  async getWeekEvents(calendarId: string = 'primary'): Promise<CalendarListEventsResponse> {
    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    return this.listEvents(calendarId, {
      timeMin: now.toISOString(),
      timeMax: endOfWeek.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
  }

  /**
   * Create an all-day event
   */
  async createAllDayEvent(calendarId: string = 'primary', summary: string, date: string, options?: {
    description?: string;
    location?: string;
    endDate?: string;
  }): Promise<CalendarEvent> {
    return this.createEvent(calendarId, {
      summary,
      description: options?.description,
      location: options?.location,
      start: { date },
      end: { date: options?.endDate || date },
    });
  }

  /**
   * Create a timed event
   */
  async createTimedEvent(calendarId: string = 'primary', summary: string, start: Date, end: Date, options?: {
    description?: string;
    location?: string;
    attendees?: Array<{ email: string; displayName?: string }>;
    timeZone?: string;
  }): Promise<CalendarEvent> {
    const startDateTime: CalendarEventDateTime = {
      dateTime: start.toISOString(),
      timeZone: options?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    const endDateTime: CalendarEventDateTime = {
      dateTime: end.toISOString(),
      timeZone: options?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    return this.createEvent(calendarId, {
      summary,
      description: options?.description,
      location: options?.location,
      start: startDateTime,
      end: endDateTime,
      attendees: options?.attendees,
    });
  }

  /**
   * Search events by query
   */
  async searchEvents(calendarId: string = 'primary', query: string, options?: {
    maxResults?: number;
    timeMin?: string;
    timeMax?: string;
  }): Promise<CalendarListEventsResponse> {
    return this.listEvents(calendarId, {
      q: query,
      maxResults: options?.maxResults,
      timeMin: options?.timeMin,
      timeMax: options?.timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });
  }
}
