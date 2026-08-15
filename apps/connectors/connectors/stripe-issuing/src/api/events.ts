import type { ConnectorClient } from './client';
import type { Event, EventListOptions, StripeList } from '../types';

/**
 * Stripe Events API (Issuing events use issuing.* type prefix)
 * https://stripe.com/docs/api/events
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

  async listIssuing(options?: Omit<EventListOptions, 'type'>): Promise<StripeList<Event>> {
    return this.list({ ...options, type: 'issuing_authorization.created' });
  }
}
