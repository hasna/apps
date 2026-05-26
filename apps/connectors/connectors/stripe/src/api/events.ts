import type { ConnectorClient } from './client';
import type {
  Event,
  EventListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Events API
 * https://stripe.com/docs/api/events
 */
export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Retrieve an event by ID
   */
  async get(id: string): Promise<Event> {
    return this.client.get<Event>(`/events/${id}`);
  }

  /**
   * List all events
   */
  async list(options?: EventListOptions): Promise<StripeList<Event>> {
    return this.client.get<StripeList<Event>>('/events', options as Record<string, string | number | boolean | undefined>);
  }
}
