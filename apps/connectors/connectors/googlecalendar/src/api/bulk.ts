import type { GoogleCalendarClient } from './client.ts';
import type { Event, EventListResponse, ListEventsParams, EventInput } from '../types/index.ts';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Calendar ID (default: 'primary') */
  calendarId?: string;
  /** Search query for events */
  query?: string;
  /** Filter by date range start (RFC3339) */
  timeMin?: string;
  /** Filter by date range end (RFC3339) */
  timeMax?: string;
  /** Maximum events to process (default: 100) */
  maxResults?: number;
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify, just preview */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, event: EventSummary) => void;
  /** Error callback */
  onError?: (error: Error, event: EventSummary) => void;
}

export interface BulkCreateOptions {
  calendarId?: string;
  /** Events to create in batch */
  events: EventInput[];
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually create, just preview */
  dryRun?: boolean;
  /** Send notifications to attendees */
  sendNotifications?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, event: EventInput) => void;
  /** Error callback */
  onError?: (error: Error, event: EventInput) => void;
}

export interface BulkUpdateOptions extends BulkOperationOptions {
  /** Partial event data to apply to all matching events */
  updates: Partial<EventInput>;
}

export interface BulkRespondOptions extends BulkOperationOptions {
  /** Response status to apply */
  response: 'accepted' | 'declined' | 'tentative';
  /** Optional comment to add */
  comment?: string;
}

export interface EventSummary {
  id: string;
  summary: string;
  status: string;
  start: string;
  end: string;
  location?: string;
  htmlLink?: string;
}

export interface BulkOperationResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ eventId: string; error: string }>;
  processedEvents: EventSummary[];
}

export interface PreviewResult {
  events: EventSummary[];
  total: number;
  query?: string;
  calendarId: string;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: GoogleCalendarClient;

  constructor(client: GoogleCalendarClient) {
    this.client = client;
  }

  // ============================================
  // Preview Operations
  // ============================================

  /**
   * Preview events matching a query without making changes
   */
  async preview(calendarId: string = 'primary', options?: {
    query?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  }): Promise<PreviewResult> {
    const events = await this.fetchEvents(calendarId, {
      q: options?.query,
      timeMin: options?.timeMin,
      timeMax: options?.timeMax,
      maxResults: options?.maxResults || 50,
      orderBy: 'startTime',
      singleEvents: true,
    });
    return { events, total: events.length, query: options?.query, calendarId };
  }

  // ============================================
  // Delete Operations
  // ============================================

  /**
   * Bulk delete events matching a query
   */
  async delete(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const calendarId = options.calendarId || 'primary';
    const events = await this.fetchEvents(calendarId, {
      q: options.query,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      maxResults: options.maxResults || 100,
    });

    return this.executeBatch(events, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (event) => {
        await this.client.delete(
          '/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(event.id)
        );
      },
    });
  }

  // ============================================
  // Update Operations
  // ============================================

  /**
   * Bulk update events matching a query with partial data
   */
  async update(options: BulkUpdateOptions): Promise<BulkOperationResult> {
    const calendarId = options.calendarId || 'primary';
    const events = await this.fetchEvents(calendarId, {
      q: options.query,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      maxResults: options.maxResults || 100,
    });

    return this.executeBatch(events, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (event) => {
        await this.client.patch<Event>(
          '/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(event.id),
          options.updates as Record<string, unknown>
        );
      },
    });
  }

  // ============================================
  // Create Operations
  // ============================================

  /**
   * Bulk create events from a list
   */
  async create(options: BulkCreateOptions): Promise<BulkOperationResult> {
    const calendarId = options.calendarId || 'primary';
    const result: BulkOperationResult = {
      total: options.events.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      processedEvents: [],
    };

    if (options.events.length === 0) {
      return result;
    }

    const chunks = this.chunkArray(options.events, options.concurrency || 10);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (eventInput) => {
          try {
            if (options.dryRun) {
              result.success++;
              result.processedEvents.push({
                id: '(dry-run)',
                summary: eventInput.summary || '(untitled)',
                status: 'confirmed',
                start: eventInput.start.dateTime || eventInput.start.date || '',
                end: eventInput.end.dateTime || eventInput.end.date || '',
                location: eventInput.location,
              });
            } else {
              const created = await this.client.post<Event>(
                '/calendars/' + encodeURIComponent(calendarId) + '/events',
                eventInput as Record<string, unknown>,
                { sendNotifications: options.sendNotifications }
              );
              result.success++;
              result.processedEvents.push({
                id: created.id,
                summary: created.summary || '(untitled)',
                status: created.status || 'confirmed',
                start: created.start?.dateTime || created.start?.date || '',
                end: created.end?.dateTime || created.end?.date || '',
                location: created.location,
                htmlLink: created.htmlLink,
              });
            }

            if (options.onProgress) {
              options.onProgress(result.success + result.failed, result.total, eventInput);
            }
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ eventId: eventInput.summary || 'unknown', error: errorMessage });

            if (options.onError) {
              onError(err instanceof Error ? err : new Error(errorMessage), eventInput);
            }
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Response Operations
  // ============================================

  /**
   * Bulk accept event invitations
   */
  async accept(options: BulkRespondOptions): Promise<BulkOperationResult> {
    return this.#respond({ ...options, response: 'accepted' });
  }

  /**
   * Bulk decline event invitations
   */
  async decline(options: BulkRespondOptions): Promise<BulkOperationResult> {
    return this.#respond({ ...options, response: 'declined' });
  }

  /**
   * Bulk mark events as tentative
   */
  async tentative(options: BulkRespondOptions): Promise<BulkOperationResult> {
    return this.#respond({ ...options, response: 'tentative' });
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Bulk respond to events (accept/decline/tentative)
   */
  async #respond(options: BulkRespondOptions): Promise<BulkOperationResult> {
    const calendarId = options.calendarId || 'primary';
    const events = await this.fetchEvents(calendarId, {
      q: options.query,
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      maxResults: options.maxResults || 100,
    });

    return this.executeBatch(events, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (event) => {
        // Get the current event to find self attendee
        const current = await this.client.get<Event>(
          '/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(event.id)
        );

        if (current.attendees) {
          for (const attendee of current.attendees) {
            if (attendee.self) {
              attendee.responseStatus = options.response;
              if (options.comment) {
                attendee.comment = options.comment;
              }
              break;
            }
          }
        }

        await this.client.patch<Event>(
          '/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(event.id),
          { attendees: current.attendees } as Record<string, unknown>,
          { sendUpdates: 'none' }
        );
      },
    });
  }

  /**
   * Fetch events matching criteria
   */
  async fetchEvents(calendarId: string, params: {
    q?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    orderBy?: string;
    singleEvents?: boolean;
  }): Promise<EventSummary[]> {
    const events: EventSummary[] = [];
    let pageToken: string | undefined;
    const max = params.maxResults || 100;

    while (events.length < max) {
      const requestParams: Record<string, string | number | boolean | undefined> = {
        maxResults: Math.min(100, max - events.length),
        pageToken,
        orderBy: params.orderBy,
        singleEvents: params.singleEvents,
      };

      if (params.q) requestParams.q = params.q;
      if (params.timeMin) requestParams.timeMin = params.timeMin;
      if (params.timeMax) requestParams.timeMax = params.timeMax;

      const response = await this.client.get<EventListResponse>(
        '/calendars/' + encodeURIComponent(calendarId) + '/events',
        requestParams
      );

      if (!response.items || response.items.length === 0) {
        break;
      }

      for (const e of response.items) {
        events.push({
          id: e.id,
          summary: e.summary || '(untitled)',
          status: e.status || 'confirmed',
          start: e.start?.dateTime || e.start?.date || '',
          end: e.end?.dateTime || e.end?.date || '',
          location: e.location,
          htmlLink: e.htmlLink,
        });
      }

      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }

    return events;
  }

  /**
   * Execute operations in batches with concurrency control
   */
  private async executeBatch(
    events: EventSummary[],
    options: {
      dryRun: boolean;
      concurrency: number;
      onProgress?: (current: number, total: number, event: EventSummary) => void;
      onError?: (error: Error, event: EventSummary) => void;
      operation: (event: EventSummary) => Promise<void>;
    }
  ): Promise<BulkOperationResult> {
    const { dryRun, concurrency, onProgress, onError, operation } = options;

    const result: BulkOperationResult = {
      total: events.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      processedEvents: [],
    };

    if (events.length === 0) {
      return result;
    }

    const chunks = this.chunkArray(events, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (event) => {
          try {
            if (dryRun) {
              result.success++;
              result.processedEvents.push(event);
            } else {
              await operation(event);
              result.success++;
              result.processedEvents.push(event);
            }

            if (onProgress) {
              onProgress(result.success + result.failed, result.total, event);
            }
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ eventId: event.id, error: errorMessage });

            if (onError) {
              onError(err instanceof Error ? err : new Error(errorMessage), event);
            }
          }
        })
      );
    }

    return result;
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
