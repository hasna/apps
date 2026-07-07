import type { ConnectorClient } from './client';
import type { Event, EventListOptions, EventSearchOptions, StripeList } from '../types';

/**
 * Stripe Events API
 * https://docs.stripe.com/api/events
 */
export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async get(id: string): Promise<Event> {
    return this.client.get<Event>(`/events/${id}`);
  }

  async list(options?: EventListOptions): Promise<StripeList<Event>> {
    return this.client.get<StripeList<Event>>(
      '/events',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  /**
   * Search events using list filters (type, created range, delivery_success).
   * Stripe has no dedicated events search endpoint; this wraps /events with filters.
   */
  async search(options?: EventSearchOptions): Promise<StripeList<Event>> {
    const { query, type, ...rest } = options || {};
    return this.list({
      ...rest,
      type: type || query,
    });
  }
}
