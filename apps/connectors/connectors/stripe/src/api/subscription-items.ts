import type { ConnectorClient } from './client';
import type {
  SubscriptionItem,
  SubscriptionItemCreateParams,
  SubscriptionItemUpdateParams,
  SubscriptionItemDeleteParams,
  SubscriptionItemListOptions,
  StripeList,
  DeletedObject,
} from '../types';

/**
 * Stripe Subscription Items API
 * https://stripe.com/docs/api/subscription_items
 */
export class SubscriptionItemsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a subscription item (add to subscription)
   */
  async create(params: SubscriptionItemCreateParams): Promise<SubscriptionItem> {
    return this.client.post<SubscriptionItem>('/subscription_items', params);
  }

  /**
   * Retrieve a subscription item by ID
   */
  async get(id: string): Promise<SubscriptionItem> {
    return this.client.get<SubscriptionItem>(`/subscription_items/${id}`);
  }

  /**
   * Update a subscription item
   */
  async update(id: string, params: SubscriptionItemUpdateParams): Promise<SubscriptionItem> {
    return this.client.post<SubscriptionItem>(`/subscription_items/${id}`, params);
  }

  /**
   * List subscription items for a subscription
   */
  async list(options: SubscriptionItemListOptions): Promise<StripeList<SubscriptionItem>> {
    return this.client.get<StripeList<SubscriptionItem>>('/subscription_items', options as unknown as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Delete a subscription item (remove from subscription)
   */
  async del(id: string, params?: SubscriptionItemDeleteParams): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/subscription_items/${id}`, params as Record<string, string | number | boolean | undefined>);
  }
}
