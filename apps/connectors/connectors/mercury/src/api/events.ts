import type { MercuryClient } from './client';

export type EventResourceType =
  | 'transaction'
  | 'checkingAccount'
  | 'savingsAccount'
  | 'treasuryAccount'
  | 'investmentAccount'
  | 'creditAccount';

export type EventOperationType = 'create' | 'update' | 'delete';

export interface Event {
  id: string;
  resourceType: EventResourceType;
  resourceId: string;
  operationType: EventOperationType;
  resourceVersion: number;
  occurredAt: string;
  changedPaths?: string[];
  mergePatch?: Record<string, unknown>;
  previousValues?: Record<string, unknown> | null;
}

export interface EventListResponse {
  events: Event[];
  page: {
    nextPage?: string;
    previousPage?: string;
  };
}

/**
 * Mercury Events API
 * View API events and changes
 */
export class EventsApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List all events
   */
  async list(params?: {
    limit?: number;
    nextPage?: string;
    previousPage?: string;
    resourceType?: EventResourceType;
  }): Promise<EventListResponse> {
    return this.client.get<EventListResponse>('/events', {
      limit: params?.limit,
      nextPage: params?.nextPage,
      previousPage: params?.previousPage,
      resourceType: params?.resourceType,
    });
  }

  /**
   * Get an event by ID
   */
  async get(eventId: string): Promise<Event> {
    return this.client.get<Event>(`/events/${eventId}`);
  }
}
