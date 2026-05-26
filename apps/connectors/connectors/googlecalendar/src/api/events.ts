import type { GoogleCalendarClient } from './client';
import type { Event, EventListResponse, ListEventsParams, EventInput } from '../types';

/**
 * Events API module
 */
export class EventsApi {
  constructor(private readonly client: GoogleCalendarClient) {}

  /**
   * List events on a calendar
   */
  async list(calendarId: string = 'primary', options?: ListEventsParams): Promise<EventListResponse> {
    return this.client.get<EventListResponse>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      iCalUID: options?.iCalUID,
      maxAttendees: options?.maxAttendees,
      maxResults: options?.maxResults,
      orderBy: options?.orderBy,
      pageToken: options?.pageToken,
      privateExtendedProperty: options?.privateExtendedProperty,
      q: options?.q,
      sharedExtendedProperty: options?.sharedExtendedProperty,
      showDeleted: options?.showDeleted,
      showHiddenInvitations: options?.showHiddenInvitations,
      singleEvents: options?.singleEvents,
      syncToken: options?.syncToken,
      timeMax: options?.timeMax,
      timeMin: options?.timeMin,
      timeZone: options?.timeZone,
      updatedMin: options?.updatedMin,
    });
  }

  /**
   * Get a specific event
   */
  async get(calendarId: string, eventId: string, options?: {
    maxAttendees?: number;
    timeZone?: string;
  }): Promise<Event> {
    return this.client.get<Event>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      options
    );
  }

  /**
   * Create a new event
   */
  async create(calendarId: string = 'primary', event: EventInput, options?: {
    conferenceDataVersion?: number;
    maxAttendees?: number;
    sendNotifications?: boolean;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    supportsAttachments?: boolean;
  }): Promise<Event> {
    return this.client.post<Event>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      event,
      options
    );
  }

  /**
   * Update an existing event
   */
  async update(calendarId: string, eventId: string, event: Partial<EventInput>, options?: {
    conferenceDataVersion?: number;
    maxAttendees?: number;
    sendNotifications?: boolean;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    supportsAttachments?: boolean;
  }): Promise<Event> {
    return this.client.patch<Event>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      event,
      options
    );
  }

  /**
   * Replace an existing event
   */
  async replace(calendarId: string, eventId: string, event: EventInput, options?: {
    conferenceDataVersion?: number;
    maxAttendees?: number;
    sendNotifications?: boolean;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    supportsAttachments?: boolean;
  }): Promise<Event> {
    return this.client.put<Event>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      event,
      options
    );
  }

  /**
   * Delete an event
   */
  async delete(calendarId: string, eventId: string, options?: {
    sendNotifications?: boolean;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }): Promise<void> {
    await this.client.delete(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      options
    );
  }

  /**
   * Quick add an event using natural language
   */
  async quickAdd(calendarId: string = 'primary', text: string, options?: {
    sendNotifications?: boolean;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }): Promise<Event> {
    return this.client.post<Event>(
      `/calendars/${encodeURIComponent(calendarId)}/events/quickAdd`,
      undefined,
      {
        text,
        sendNotifications: options?.sendNotifications,
        sendUpdates: options?.sendUpdates,
      }
    );
  }

  /**
   * Move an event to another calendar
   */
  async move(calendarId: string, eventId: string, destinationCalendarId: string, options?: {
    sendNotifications?: boolean;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }): Promise<Event> {
    return this.client.post<Event>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move`,
      undefined,
      {
        destination: destinationCalendarId,
        sendNotifications: options?.sendNotifications,
        sendUpdates: options?.sendUpdates,
      }
    );
  }

  /**
   * Get instances of a recurring event
   */
  async instances(calendarId: string, eventId: string, options?: {
    maxAttendees?: number;
    maxResults?: number;
    originalStart?: string;
    pageToken?: string;
    showDeleted?: boolean;
    timeMax?: string;
    timeMin?: string;
    timeZone?: string;
  }): Promise<EventListResponse> {
    return this.client.get<EventListResponse>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/instances`,
      options
    );
  }

  /**
   * Import an event (for calendar migration)
   */
  async import(calendarId: string = 'primary', event: EventInput & { iCalUID: string }, options?: {
    conferenceDataVersion?: number;
    supportsAttachments?: boolean;
  }): Promise<Event> {
    return this.client.post<Event>(
      `/calendars/${encodeURIComponent(calendarId)}/events/import`,
      event,
      options
    );
  }

  /**
   * Watch for changes to events (requires push notifications setup)
   */
  async watch(calendarId: string = 'primary', options: {
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
    return this.client.post(`/calendars/${encodeURIComponent(calendarId)}/events/watch`, options);
  }

  /**
   * Respond to an event invitation (accept, decline, or tentative)
   * This updates the attendee's response status for the authenticated user
   */
  async respond(
    calendarId: string,
    eventId: string,
    response: 'accepted' | 'declined' | 'tentative',
    options?: {
      sendUpdates?: 'all' | 'externalOnly' | 'none';
      comment?: string;
    }
  ): Promise<Event> {
    // Get the current event
    const event = await this.get(calendarId, eventId);

    // Find the current user's attendee entry and update their response
    if (event.attendees) {
      for (const attendee of event.attendees) {
        if (attendee.self) {
          attendee.responseStatus = response;
          if (options?.comment) {
            attendee.comment = options.comment;
          }
          break;
        }
      }
    }

    // Update the event with the new response
    return this.update(calendarId, eventId, {
      attendees: event.attendees,
    }, {
      sendUpdates: options?.sendUpdates || 'none',
    });
  }

  /**
   * Accept an event invitation
   */
  async accept(calendarId: string, eventId: string, options?: {
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    comment?: string;
  }): Promise<Event> {
    return this.respond(calendarId, eventId, 'accepted', options);
  }

  /**
   * Decline an event invitation
   */
  async decline(calendarId: string, eventId: string, options?: {
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    comment?: string;
  }): Promise<Event> {
    return this.respond(calendarId, eventId, 'declined', options);
  }

  /**
   * Mark an event as tentative
   */
  async tentative(calendarId: string, eventId: string, options?: {
    sendUpdates?: 'all' | 'externalOnly' | 'none';
    comment?: string;
  }): Promise<Event> {
    return this.respond(calendarId, eventId, 'tentative', options);
  }
}
