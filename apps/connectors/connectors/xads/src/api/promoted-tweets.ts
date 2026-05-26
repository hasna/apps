import type { XAdsClient } from './client';
import type {
  PromotedTweet,
  CreatePromotedTweetParams,
  ListResponse,
  PaginationParams,
} from '../types';

/**
 * Promoted Tweets API
 */
export class PromotedTweetsApi {
  constructor(private client: XAdsClient) {}

  /**
   * List all promoted tweets for an account
   */
  async list(
    accountId: string,
    params?: PaginationParams & {
      promoted_tweet_ids?: string[];
      line_item_ids?: string[];
    }
  ): Promise<ListResponse<PromotedTweet>> {
    return this.client.get<ListResponse<PromotedTweet>>(
      `/accounts/${accountId}/promoted_tweets`,
      {
        cursor: params?.cursor,
        count: params?.count,
        sort_by: params?.sort_by?.join(','),
        with_deleted: params?.with_deleted,
        with_total_count: params?.with_total_count,
        promoted_tweet_ids: params?.promoted_tweet_ids?.join(','),
        line_item_ids: params?.line_item_ids?.join(','),
      }
    );
  }

  /**
   * Get a specific promoted tweet
   */
  async get(
    accountId: string,
    promotedTweetId: string,
    withDeleted?: boolean
  ): Promise<{ data: PromotedTweet }> {
    return this.client.get<{ data: PromotedTweet }>(
      `/accounts/${accountId}/promoted_tweets/${promotedTweetId}`,
      { with_deleted: withDeleted }
    );
  }

  /**
   * Create promoted tweets (promote existing tweets)
   */
  async create(
    accountId: string,
    params: CreatePromotedTweetParams
  ): Promise<{ data: PromotedTweet[] }> {
    return this.client.post<{ data: PromotedTweet[] }>(
      `/accounts/${accountId}/promoted_tweets`,
      {
        line_item_id: params.line_item_id,
        tweet_ids: params.tweet_ids,
      }
    );
  }

  /**
   * Delete (soft delete) a promoted tweet
   */
  async delete(accountId: string, promotedTweetId: string): Promise<{ data: PromotedTweet }> {
    return this.client.delete<{ data: PromotedTweet }>(
      `/accounts/${accountId}/promoted_tweets/${promotedTweetId}`
    );
  }

  /**
   * Pause a promoted tweet
   */
  async pause(accountId: string, promotedTweetId: string): Promise<{ data: PromotedTweet }> {
    return this.client.put<{ data: PromotedTweet }>(
      `/accounts/${accountId}/promoted_tweets/${promotedTweetId}`,
      { entity_status: 'PAUSED' }
    );
  }

  /**
   * Activate a promoted tweet
   */
  async activate(accountId: string, promotedTweetId: string): Promise<{ data: PromotedTweet }> {
    return this.client.put<{ data: PromotedTweet }>(
      `/accounts/${accountId}/promoted_tweets/${promotedTweetId}`,
      { entity_status: 'ACTIVE' }
    );
  }
}
