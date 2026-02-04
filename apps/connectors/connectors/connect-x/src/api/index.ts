import type { XConfig, AuthStatus } from '../types';
import { XClient } from './client';
import { TweetsApi } from './tweets';
import { UsersApi } from './users';
import { MediaApi } from './media';
import { OAuth1Client } from './oauth1';

/**
 * Main X (Twitter) API v2 connector class
 */
export class X {
  private readonly client: XClient;
  private mediaApi?: MediaApi;

  // API modules
  public readonly tweets: TweetsApi;
  public readonly users: UsersApi;

  constructor(config: XConfig) {
    this.client = new XClient(config);
    this.tweets = new TweetsApi(this.client);
    this.users = new UsersApi(this.client);

    // Set up media API if OAuth 1.0a credentials are available
    if (config.oauth1AccessToken && config.oauth1AccessTokenSecret) {
      const oauth1Client = new OAuth1Client({
        consumerKey: config.apiKey,
        consumerSecret: config.apiSecret,
        accessToken: config.oauth1AccessToken,
        accessTokenSecret: config.oauth1AccessTokenSecret,
      });
      this.mediaApi = new MediaApi(oauth1Client);
    }
  }

  /**
   * Get the media API (requires OAuth 1.0a)
   * Returns undefined if OAuth 1.0a is not configured
   */
  get media(): MediaApi | undefined {
    return this.mediaApi;
  }

  /**
   * Check if media upload is available
   */
  hasMediaUpload(): boolean {
    return !!this.mediaApi;
  }

  /**
   * Create a client from environment variables
   * Looks for X_API_KEY, X_API_SECRET, and optionally OAuth tokens
   */
  static fromEnv(): X {
    const apiKey = process.env.X_API_KEY;
    const apiSecret = process.env.X_API_SECRET;
    const bearerToken = process.env.X_BEARER_TOKEN;
    const accessToken = process.env.X_ACCESS_TOKEN;
    const refreshToken = process.env.X_REFRESH_TOKEN;
    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;
    const oauth1AccessToken = process.env.X_OAUTH1_ACCESS_TOKEN;
    const oauth1AccessTokenSecret = process.env.X_OAUTH1_ACCESS_TOKEN_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error('X_API_KEY and X_API_SECRET environment variables are required');
    }

    return new X({
      apiKey,
      apiSecret,
      bearerToken,
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
      oauth1AccessToken,
      oauth1AccessTokenSecret,
    });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Check if bearer token is cached
   */
  hasBearerToken(): boolean {
    return this.client.hasBearerToken();
  }

  /**
   * Check if user context is available (OAuth 2.0)
   */
  hasUserContext(): boolean {
    return this.client.hasUserContext();
  }

  /**
   * Check if OAuth 1.0a is available
   */
  hasOAuth1(): boolean {
    return this.client.hasOAuth1();
  }

  /**
   * Get current authentication status
   */
  getAuthStatus(): AuthStatus {
    return this.client.getAuthStatus();
  }

  /**
   * Set user tokens (after OAuth flow)
   */
  setUserTokens(tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }): void {
    this.client.setUserTokens(tokens);
  }

  /**
   * Set OAuth 1.0a tokens
   */
  setOAuth1Tokens(oauthToken: string, oauthTokenSecret: string): void {
    this.client.setOAuth1Tokens(oauthToken, oauthTokenSecret);

    // Also set up media API
    const oauth1Client = this.client.getOAuth1Client();
    if (oauth1Client) {
      this.mediaApi = new MediaApi(oauth1Client);
    }
  }

  /**
   * Set callback for token refresh events
   */
  setTokenRefreshCallback(
    callback: (tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt: number;
    }) => void
  ): void {
    this.client.setTokenRefreshCallback(callback);
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): XClient {
    return this.client;
  }
}

// Legacy export for compatibility
export { X as Connector };

export { XClient } from './client';
export { TweetsApi } from './tweets';
export { UsersApi } from './users';
export { MediaApi } from './media';
export { OAuth1Client } from './oauth1';
export * from './oauth';
