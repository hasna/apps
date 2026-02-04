import type { XClient } from './client';
import type { User, XResponse, UserLookupOptions, Tweet } from '../types';

/**
 * Users API module for X API v2
 */
export class UsersApi {
  constructor(private readonly client: XClient) {}

  /**
   * Get a user by ID
   */
  async getById(id: string, options?: UserLookupOptions): Promise<XResponse<User>> {
    const params: Record<string, string | undefined> = {};

    if (options?.userFields?.length) {
      params['user.fields'] = options.userFields.join(',');
    }
    if (options?.tweetFields?.length) {
      params['tweet.fields'] = options.tweetFields.join(',');
    }
    if (options?.expansions?.length) {
      params['expansions'] = options.expansions.join(',');
    }

    return this.client.get<XResponse<User>>(`/2/users/${id}`, params);
  }

  /**
   * Get a user by username
   */
  async getByUsername(username: string, options?: UserLookupOptions): Promise<XResponse<User>> {
    const params: Record<string, string | undefined> = {
      'user.fields': 'id,name,username,created_at,description,profile_image_url,public_metrics,verified,protected,location,url',
    };

    if (options?.userFields?.length) {
      params['user.fields'] = options.userFields.join(',');
    }
    if (options?.tweetFields?.length) {
      params['tweet.fields'] = options.tweetFields.join(',');
    }
    if (options?.expansions?.length) {
      params['expansions'] = options.expansions.join(',');
    }

    return this.client.get<XResponse<User>>(`/2/users/by/username/${username}`, params);
  }

  /**
   * Get multiple users by IDs (up to 100)
   */
  async getMany(ids: string[], options?: UserLookupOptions): Promise<XResponse<User[]>> {
    const params: Record<string, string | undefined> = {
      ids: ids.join(','),
      'user.fields': 'id,name,username,created_at,description,profile_image_url,public_metrics,verified,protected',
    };

    if (options?.userFields?.length) {
      params['user.fields'] = options.userFields.join(',');
    }
    if (options?.tweetFields?.length) {
      params['tweet.fields'] = options.tweetFields.join(',');
    }
    if (options?.expansions?.length) {
      params['expansions'] = options.expansions.join(',');
    }

    return this.client.get<XResponse<User[]>>('/2/users', params);
  }

  /**
   * Get multiple users by usernames (up to 100)
   */
  async getManyByUsernames(usernames: string[], options?: UserLookupOptions): Promise<XResponse<User[]>> {
    const params: Record<string, string | undefined> = {
      usernames: usernames.join(','),
      'user.fields': 'id,name,username,created_at,description,profile_image_url,public_metrics,verified,protected',
    };

    if (options?.userFields?.length) {
      params['user.fields'] = options.userFields.join(',');
    }
    if (options?.tweetFields?.length) {
      params['tweet.fields'] = options.tweetFields.join(',');
    }
    if (options?.expansions?.length) {
      params['expansions'] = options.expansions.join(',');
    }

    return this.client.get<XResponse<User[]>>('/2/users/by', params);
  }

  /**
   * Get a user's followers
   */
  async getFollowers(userId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
  }): Promise<XResponse<User[]>> {
    const params: Record<string, string | number | undefined> = {
      max_results: options?.maxResults || 100,
      pagination_token: options?.paginationToken,
      'user.fields': 'id,name,username,created_at,description,profile_image_url,public_metrics,verified',
    };

    return this.client.get<XResponse<User[]>>(`/2/users/${userId}/followers`, params);
  }

  /**
   * Get users that a user is following
   */
  async getFollowing(userId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
  }): Promise<XResponse<User[]>> {
    const params: Record<string, string | number | undefined> = {
      max_results: options?.maxResults || 100,
      pagination_token: options?.paginationToken,
      'user.fields': 'id,name,username,created_at,description,profile_image_url,public_metrics,verified',
    };

    return this.client.get<XResponse<User[]>>(`/2/users/${userId}/following`, params);
  }

  /**
   * Get tweets liked by a user
   * Requires OAuth 2.0 user context
   */
  async getLikedTweets(userId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
  }): Promise<XResponse<Tweet[]>> {
    return this.client.request<XResponse<Tweet[]>>(`/2/users/${userId}/liked_tweets`, {
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
   * Get lists owned by a user
   */
  async getOwnedLists(userId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
  }): Promise<XResponse<{ id: string; name: string }[]>> {
    const params: Record<string, string | number | undefined> = {
      max_results: options?.maxResults || 100,
      pagination_token: options?.paginationToken,
      'list.fields': 'id,name,description,follower_count,member_count,private,owner_id,created_at',
    };

    return this.client.get(`/2/users/${userId}/owned_lists`, params);
  }

  /**
   * Get lists a user is a member of
   */
  async getListMemberships(userId: string, options?: {
    maxResults?: number;
    paginationToken?: string;
  }): Promise<XResponse<{ id: string; name: string }[]>> {
    const params: Record<string, string | number | undefined> = {
      max_results: options?.maxResults || 100,
      pagination_token: options?.paginationToken,
      'list.fields': 'id,name,description,follower_count,member_count,private,owner_id,created_at',
    };

    return this.client.get(`/2/users/${userId}/list_memberships`, params);
  }

  // ============================================
  // Write Operations (require user auth)
  // ============================================

  /**
   * Get the authenticated user's info
   * Requires OAuth 2.0 user context with users.read scope
   */
  async me(): Promise<XResponse<User>> {
    return this.client.request<XResponse<User>>('/2/users/me', {
      method: 'GET',
      params: {
        'user.fields': 'id,name,username,created_at,description,profile_image_url,public_metrics,verified,protected,location,url',
      },
      authMethod: 'oauth2-user',
    });
  }

  /**
   * Follow a user
   * Requires OAuth 2.0 user context with follows.write scope
   */
  async follow(userId: string, targetUserId: string): Promise<{ data: { following: boolean; pending_follow: boolean } }> {
    return this.client.post<{ data: { following: boolean; pending_follow: boolean } }>(
      `/2/users/${userId}/following`,
      { target_user_id: targetUserId }
    );
  }

  /**
   * Unfollow a user
   * Requires OAuth 2.0 user context with follows.write scope
   */
  async unfollow(userId: string, targetUserId: string): Promise<{ data: { following: boolean } }> {
    return this.client.delete<{ data: { following: boolean } }>(
      `/2/users/${userId}/following/${targetUserId}`
    );
  }

  /**
   * Block a user
   * Requires OAuth 2.0 user context with block.write scope
   */
  async block(userId: string, targetUserId: string): Promise<{ data: { blocking: boolean } }> {
    return this.client.post<{ data: { blocking: boolean } }>(
      `/2/users/${userId}/blocking`,
      { target_user_id: targetUserId }
    );
  }

  /**
   * Unblock a user
   * Requires OAuth 2.0 user context with block.write scope
   */
  async unblock(userId: string, targetUserId: string): Promise<{ data: { blocking: boolean } }> {
    return this.client.delete<{ data: { blocking: boolean } }>(
      `/2/users/${userId}/blocking/${targetUserId}`
    );
  }

  /**
   * Mute a user
   * Requires OAuth 2.0 user context with mute.write scope
   */
  async mute(userId: string, targetUserId: string): Promise<{ data: { muting: boolean } }> {
    return this.client.post<{ data: { muting: boolean } }>(
      `/2/users/${userId}/muting`,
      { target_user_id: targetUserId }
    );
  }

  /**
   * Unmute a user
   * Requires OAuth 2.0 user context with mute.write scope
   */
  async unmute(userId: string, targetUserId: string): Promise<{ data: { muting: boolean } }> {
    return this.client.delete<{ data: { muting: boolean } }>(
      `/2/users/${userId}/muting/${targetUserId}`
    );
  }
}
