import type { XClient } from './client';
import type {
  Tweet,
  XResponse,
  TweetSearchOptions,
  TweetLookupOptions,
  DEFAULT_TWEET_FIELDS,
  DEFAULT_TWEET_EXPANSIONS,
} from '../types';

/**
 * Tweets API module for X API v2
 */
export class TweetsApi {
  constructor(private readonly client: XClient) {}

  /**
   * Get a single tweet by ID
   */
  async get(id: string, options?: TweetLookupOptions): Promise<XResponse<Tweet>> {
    const params: Record<string, string | undefined> = {};

    if (options?.tweetFields?.length) {
      params['tweet.fields'] = options.tweetFields.join(',');
    }
    if (options?.userFields?.length) {
      params['user.fields'] = options.userFields.join(',');
    }
    if (options?.expansions?.length) {
      params['expansions'] = options.expansions.join(',');
    }
    if (options?.mediaFields?.length) {
      params['media.fields'] = options.mediaFields.join(',');
    }

    return this.client.get<XResponse<Tweet>>(`/2/tweets/${id}`, params);
  }

  /**
   * Get multiple tweets by IDs (up to 100)
   */
  async getMany(ids: string[], options?: TweetLookupOptions): Promise<XResponse<Tweet[]>> {
    const params: Record<string, string | undefined> = {
      ids: ids.join(','),
    };

    if (options?.tweetFields?.length) {
      params['tweet.fields'] = options.tweetFields.join(',');
    }
    if (options?.userFields?.length) {
      params['user.fields'] = options.userFields.join(',');
    }
    if (options?.expansions?.length) {
      params['expansions'] = options.expansions.join(',');
    }
    if (options?.mediaFields?.length) {
      params['media.fields'] = options.mediaFields.join(',');
    }

    return this.client.get<XResponse<Tweet[]>>('/2/tweets', params);
  }

  /**
   * Search recent tweets (last 7 days)
   */
  async searchRecent(options: TweetSearchOptions): Promise<XResponse<Tweet[]>> {
    const params: Record<string, string | number | undefined> = {
      query: options.query,
      max_results: options.maxResults || 10,
      next_token: options.nextToken,
      start_time: options.startTime,
      end_time: options.endTime,
      since_id: options.sinceId,
      until_id: options.untilId,
      sort_order: options.sortOrder,
      'tweet.fields': 'id,text,author_id,created_at,public_metrics,source,lang',
      'expansions': 'author_id',
      'user.fields': 'id,name,username,profile_image_url',
    };

    return this.client.get<XResponse<Tweet[]>>('/2/tweets/search/recent', params);
  }

  /**
   * Get tweet counts for a search query (recent)
   */
  async countRecent(query: string, options?: {
    startTime?: string;
    endTime?: string;
    granularity?: 'minute' | 'hour' | 'day';
  }): Promise<XResponse<{ total_tweet_count: number; data: { start: string; end: string; tweet_count: number }[] }>> {
    const params: Record<string, string | undefined> = {
      query,
      start_time: options?.startTime,
      end_time: options?.endTime,
      granularity: options?.granularity || 'hour',
    };

    return this.client.get('/2/tweets/counts/recent', params);
  }

  /**
   * Get a user's timeline (tweets they've posted)
   */
  async getUserTimeline(userId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
    startTime?: string;
    endTime?: string;
    sinceId?: string;
    untilId?: string;
    excludeReplies?: boolean;
    excludeRetweets?: boolean;
  }): Promise<XResponse<Tweet[]>> {
    const exclude: string[] = [];
    if (options?.excludeReplies) exclude.push('replies');
    if (options?.excludeRetweets) exclude.push('retweets');

    const params: Record<string, string | number | undefined> = {
      max_results: options?.maxResults || 10,
      pagination_token: options?.paginationToken,
      start_time: options?.startTime,
      end_time: options?.endTime,
      since_id: options?.sinceId,
      until_id: options?.untilId,
      exclude: exclude.length ? exclude.join(',') : undefined,
      'tweet.fields': 'id,text,author_id,created_at,public_metrics,source,lang',
      'expansions': 'author_id',
      'user.fields': 'id,name,username,profile_image_url',
    };

    return this.client.get<XResponse<Tweet[]>>(`/2/users/${userId}/tweets`, params);
  }

  /**
   * Get a user's mentions timeline
   */
  async getUserMentions(userId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
    startTime?: string;
    endTime?: string;
    sinceId?: string;
    untilId?: string;
  }): Promise<XResponse<Tweet[]>> {
    const params: Record<string, string | number | undefined> = {
      max_results: options?.maxResults || 10,
      pagination_token: options?.paginationToken,
      start_time: options?.startTime,
      end_time: options?.endTime,
      since_id: options?.sinceId,
      until_id: options?.untilId,
      'tweet.fields': 'id,text,author_id,created_at,public_metrics,source,lang',
      'expansions': 'author_id',
      'user.fields': 'id,name,username,profile_image_url',
    };

    return this.client.get<XResponse<Tweet[]>>(`/2/users/${userId}/mentions`, params);
  }

  /**
   * Get users who liked a tweet
   */
  async getLikingUsers(tweetId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
  }): Promise<XResponse<{ id: string; name: string; username: string }[]>> {
    const params: Record<string, string | number | undefined> = {
      max_results: options?.maxResults || 100,
      pagination_token: options?.paginationToken,
      'user.fields': 'id,name,username,profile_image_url,public_metrics',
    };

    return this.client.get(`/2/tweets/${tweetId}/liking_users`, params);
  }

  /**
   * Get users who retweeted a tweet
   */
  async getRetweetedBy(tweetId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
  }): Promise<XResponse<{ id: string; name: string; username: string }[]>> {
    const params: Record<string, string | number | undefined> = {
      max_results: options?.maxResults || 100,
      pagination_token: options?.paginationToken,
      'user.fields': 'id,name,username,profile_image_url,public_metrics',
    };

    return this.client.get(`/2/tweets/${tweetId}/retweeted_by`, params);
  }

  /**
   * Get quote tweets for a tweet
   */
  async getQuoteTweets(tweetId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
  }): Promise<XResponse<Tweet[]>> {
    const params: Record<string, string | number | undefined> = {
      max_results: options?.maxResults || 10,
      pagination_token: options?.paginationToken,
      'tweet.fields': 'id,text,author_id,created_at,public_metrics,source,lang',
      'expansions': 'author_id',
      'user.fields': 'id,name,username,profile_image_url',
    };

    return this.client.get<XResponse<Tweet[]>>(`/2/tweets/${tweetId}/quote_tweets`, params);
  }

  // ============================================
  // Write Operations (require user auth)
  // ============================================

  /**
   * Create a tweet
   * Requires OAuth 2.0 user context with tweet.write scope
   */
  async create(options: {
    text: string;
    mediaIds?: string[];
    replyToTweetId?: string;
    quoteTweetId?: string;
    pollOptions?: string[];
    pollDurationMinutes?: number;
  }): Promise<XResponse<{ id: string; text: string }>> {
    const body: Record<string, unknown> = {
      text: options.text,
    };

    // Add media
    if (options.mediaIds?.length) {
      body.media = { media_ids: options.mediaIds };
    }

    // Add reply settings
    if (options.replyToTweetId) {
      body.reply = { in_reply_to_tweet_id: options.replyToTweetId };
    }

    // Add quote tweet
    if (options.quoteTweetId) {
      body.quote_tweet_id = options.quoteTweetId;
    }

    // Add poll
    if (options.pollOptions?.length) {
      body.poll = {
        options: options.pollOptions,
        duration_minutes: options.pollDurationMinutes || 1440, // 24 hours default
      };
    }

    return this.client.post<XResponse<{ id: string; text: string }>>('/2/tweets', body);
  }

  /**
   * Delete a tweet
   * Requires OAuth 2.0 user context with tweet.write scope
   */
  async delete(tweetId: string): Promise<{ data: { deleted: boolean } }> {
    return this.client.delete<{ data: { deleted: boolean } }>(`/2/tweets/${tweetId}`);
  }

  /**
   * Like a tweet
   * Requires OAuth 2.0 user context with like.write scope
   */
  async like(userId: string, tweetId: string): Promise<{ data: { liked: boolean } }> {
    return this.client.post<{ data: { liked: boolean } }>(`/2/users/${userId}/likes`, {
      tweet_id: tweetId,
    });
  }

  /**
   * Unlike a tweet
   * Requires OAuth 2.0 user context with like.write scope
   */
  async unlike(userId: string, tweetId: string): Promise<{ data: { liked: boolean } }> {
    return this.client.delete<{ data: { liked: boolean } }>(`/2/users/${userId}/likes/${tweetId}`);
  }

  /**
   * Retweet a tweet
   * Requires OAuth 2.0 user context with tweet.write scope
   */
  async retweet(userId: string, tweetId: string): Promise<{ data: { retweeted: boolean } }> {
    return this.client.post<{ data: { retweeted: boolean } }>(`/2/users/${userId}/retweets`, {
      tweet_id: tweetId,
    });
  }

  /**
   * Remove retweet
   * Requires OAuth 2.0 user context with tweet.write scope
   */
  async unretweet(userId: string, tweetId: string): Promise<{ data: { retweeted: boolean } }> {
    return this.client.delete<{ data: { retweeted: boolean } }>(`/2/users/${userId}/retweets/${tweetId}`);
  }

  /**
   * Get user's bookmarks
   * Requires OAuth 2.0 user context with bookmark.read scope
   */
  async getBookmarks(userId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
  }): Promise<XResponse<Tweet[]>> {
    return this.client.request<XResponse<Tweet[]>>(`/2/users/${userId}/bookmarks`, {
      method: 'GET',
      params: {
        max_results: options?.maxResults || 10,
        pagination_token: options?.paginationToken,
        'tweet.fields': 'id,text,author_id,created_at,public_metrics,source,lang',
        'expansions': 'author_id',
        'user.fields': 'id,name,username,profile_image_url',
      },
      authMethod: 'oauth2-user',
    });
  }

  /**
   * Bookmark a tweet
   * Requires OAuth 2.0 user context with bookmark.write scope
   */
  async bookmark(userId: string, tweetId: string): Promise<{ data: { bookmarked: boolean } }> {
    return this.client.post<{ data: { bookmarked: boolean } }>(`/2/users/${userId}/bookmarks`, {
      tweet_id: tweetId,
    });
  }

  /**
   * Remove bookmark
   * Requires OAuth 2.0 user context with bookmark.write scope
   */
  async removeBookmark(userId: string, tweetId: string): Promise<{ data: { bookmarked: boolean } }> {
    return this.client.delete<{ data: { bookmarked: boolean } }>(`/2/users/${userId}/bookmarks/${tweetId}`);
  }
}
