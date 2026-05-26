import type { YouTubeClient } from './client';
import type {
  Subscription,
  SubscriptionListParams,
  ListResponse,
} from '../types';

export interface SubscriptionInsertParams {
  part: string[];
}

export class SubscriptionsApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * List subscriptions
   * Quota cost: 1 unit per request
   */
  async list(params: SubscriptionListParams): Promise<ListResponse<Subscription>> {
    return this.client.get<ListResponse<Subscription>>('/subscriptions', {
      part: params.part,
      channelId: params.channelId,
      id: params.id,
      mine: params.mine,
      myRecentSubscribers: params.myRecentSubscribers,
      mySubscribers: params.mySubscribers,
      forChannelId: params.forChannelId,
      maxResults: params.maxResults,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      onBehalfOfContentOwnerChannel: params.onBehalfOfContentOwnerChannel,
      order: params.order,
      pageToken: params.pageToken,
    });
  }

  /**
   * Get the authenticated user's subscriptions
   */
  async getMine(
    maxResults = 25,
    order: 'alphabetical' | 'relevance' | 'unread' = 'relevance',
    parts: string[] = ['snippet', 'contentDetails']
  ): Promise<ListResponse<Subscription>> {
    return this.list({
      part: parts,
      mine: true,
      maxResults,
      order,
    });
  }

  /**
   * Get subscriptions for a channel
   */
  async getForChannel(
    channelId: string,
    maxResults = 25,
    order: 'alphabetical' | 'relevance' | 'unread' = 'relevance',
    parts: string[] = ['snippet', 'contentDetails']
  ): Promise<ListResponse<Subscription>> {
    return this.list({
      part: parts,
      channelId,
      maxResults,
      order,
    });
  }

  /**
   * Check if subscribed to specific channels
   */
  async checkSubscription(
    forChannelIds: string | string[],
    parts: string[] = ['snippet']
  ): Promise<ListResponse<Subscription>> {
    const channelIds = Array.isArray(forChannelIds) ? forChannelIds.join(',') : forChannelIds;
    return this.list({
      part: parts,
      mine: true,
      forChannelId: channelIds,
    });
  }

  /**
   * Get the authenticated user's subscribers
   */
  async getMySubscribers(
    maxResults = 25,
    parts: string[] = ['snippet', 'subscriberSnippet']
  ): Promise<ListResponse<Subscription>> {
    return this.list({
      part: parts,
      mySubscribers: true,
      maxResults,
    });
  }

  /**
   * Get the authenticated user's recent subscribers
   */
  async getMyRecentSubscribers(
    maxResults = 25,
    parts: string[] = ['snippet', 'subscriberSnippet']
  ): Promise<ListResponse<Subscription>> {
    return this.list({
      part: parts,
      myRecentSubscribers: true,
      maxResults,
    });
  }

  /**
   * Insert (create) a subscription
   * Quota cost: 50 units
   */
  async insert(
    subscription: Omit<Subscription, 'kind' | 'etag' | 'id'>,
    params: SubscriptionInsertParams
  ): Promise<Subscription> {
    return this.client.post<Subscription>(
      '/subscriptions',
      subscription as Record<string, unknown>,
      { part: params.part }
    );
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channelId: string): Promise<Subscription> {
    return this.insert(
      {
        snippet: {
          resourceId: {
            kind: 'youtube#channel',
            channelId,
          },
        },
      } as Omit<Subscription, 'kind' | 'etag' | 'id'>,
      { part: ['snippet'] }
    );
  }

  /**
   * Delete a subscription
   * Quota cost: 50 units
   */
  async delete(subscriptionId: string): Promise<void> {
    await this.client.delete('/subscriptions', { id: subscriptionId });
  }

  /**
   * Unsubscribe from a channel
   * First finds the subscription, then deletes it
   */
  async unsubscribe(channelId: string): Promise<boolean> {
    const response = await this.checkSubscription(channelId);
    if (response.items.length > 0) {
      await this.delete(response.items[0].id);
      return true;
    }
    return false;
  }
}
