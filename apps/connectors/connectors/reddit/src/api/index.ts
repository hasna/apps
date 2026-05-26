import type { RedditConfig } from '../types';
import { RedditClient } from './client';
import { PostsApi } from './posts';
import { CommentsApi } from './comments';
import { SubredditsApi } from './subreddits';
import { UsersApi } from './users';
import { SearchApi } from './search';

/**
 * Main Reddit Connector class
 * Provides access to Posts, Comments, Subreddits, Users, and Search APIs
 */
export class Reddit {
  private readonly client: RedditClient;

  // Service APIs
  public readonly posts: PostsApi;
  public readonly comments: CommentsApi;
  public readonly subreddits: SubredditsApi;
  public readonly users: UsersApi;
  public readonly search: SearchApi;

  constructor(config: RedditConfig) {
    this.client = new RedditClient(config);
    this.posts = new PostsApi(this.client);
    this.comments = new CommentsApi(this.client);
    this.subreddits = new SubredditsApi(this.client);
    this.users = new UsersApi(this.client);
    this.search = new SearchApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_ACCESS_TOKEN, REDDIT_REFRESH_TOKEN
   */
  static fromEnv(): Reddit {
    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    const accessToken = process.env.REDDIT_ACCESS_TOKEN;
    const refreshToken = process.env.REDDIT_REFRESH_TOKEN;

    if (!clientId) {
      throw new Error('REDDIT_CLIENT_ID environment variable is required');
    }
    if (!clientSecret) {
      throw new Error('REDDIT_CLIENT_SECRET environment variable is required');
    }

    return new Reddit({
      clientId,
      clientSecret,
      accessToken,
      refreshToken,
    });
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): RedditClient {
    return this.client;
  }

  /**
   * Revoke the current access token
   */
  async logout(): Promise<void> {
    return this.client.revokeToken();
  }

  /**
   * Get the OAuth2 authorization URL for user authentication
   */
  static getAuthorizationUrl(
    clientId: string,
    redirectUri: string,
    scope: string[],
    state: string,
    duration: 'temporary' | 'permanent' = 'permanent'
  ): string {
    return RedditClient.getAuthorizationUrl(clientId, redirectUri, scope, state, duration);
  }

  /**
   * Exchange an authorization code for tokens
   */
  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scope: string;
  }> {
    const response = await RedditClient.exchangeCode(clientId, clientSecret, code, redirectUri);
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in,
      scope: response.scope,
    };
  }
}

export { RedditClient } from './client';
export { PostsApi } from './posts';
export { CommentsApi } from './comments';
export { SubredditsApi } from './subreddits';
export { UsersApi } from './users';
export { SearchApi } from './search';
