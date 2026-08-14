import type { ConnectorClient } from './client';
import type {
  Subscription,
  SubscriptionCreateParams,
  SubscriptionUpdateParams,
  SubscriptionCancelParams,
  SubscriptionResumeParams,
  SubscriptionListOptions,
  StripeList,
  StripeSearchResult,
} from '../types';

/**
 * Stripe Subscriptions API
 * https://stripe.com/docs/api/subscriptions
 */
export class SubscriptionsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a subscription
   */
  async create(params: SubscriptionCreateParams): Promise<Subscription> {
    return this.client.post<Subscription>('/subscriptions', params);
  }

  /**
   * Retrieve a subscription by ID
   */
  async get(id: string): Promise<Subscription> {
    return this.client.get<Subscription>(`/subscriptions/${id}`);
  }

  /**
   * Update a subscription
   */
  async update(id: string, params: SubscriptionUpdateParams): Promise<Subscription> {
    return this.client.post<Subscription>(`/subscriptions/${id}`, params);
  }

  /**
   * List all subscriptions
   */
  async list(options?: SubscriptionListOptions): Promise<StripeList<Subscription>> {
    return this.client.get<StripeList<Subscription>>('/subscriptions', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Cancel a subscription
   */
  async cancel(id: string, params?: SubscriptionCancelParams): Promise<Subscription> {
    return this.client.delete<Subscription>(`/subscriptions/${id}`, params as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Resume a paused subscription
   */
  async resume(id: string, params?: SubscriptionResumeParams): Promise<Subscription> {
    return this.client.post<Subscription>(`/subscriptions/${id}/resume`, params || {});
  }

  /**
   * Search subscriptions
   * Query syntax: https://stripe.com/docs/search#query-fields-for-subscriptions
   */
  async search(query: string, options?: { limit?: number; page?: string }): Promise<StripeSearchResult<Subscription>> {
    return this.client.get<StripeSearchResult<Subscription>>('/subscriptions/search', {
      query,
      limit: options?.limit,
      page: options?.page,
    });
  }
}
