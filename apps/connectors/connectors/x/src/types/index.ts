// X (Twitter) API v2 Types

// ============================================
// Configuration
// ============================================

export interface XConfig {
  apiKey: string;
  apiSecret: string;
  bearerToken?: string; // Can provide directly or let client generate
  baseUrl?: string;
  // OAuth 2.0 user tokens (for user-context operations)
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  // OAuth 1.0a user tokens (for legacy endpoints like media upload)
  oauth1AccessToken?: string;
  oauth1AccessTokenSecret?: string;
  // Client ID for OAuth 2.0 PKCE
  clientId?: string;
  clientSecret?: string;
}

// ============================================
// Authentication Types
// ============================================

export type AuthMethod = 'app-only' | 'oauth2-user' | 'oauth1-user';

export interface AuthStatus {
  method: AuthMethod;
  isAuthenticated: boolean;
  userId?: string;
  username?: string;
  scopes?: string[];
  expiresAt?: number;
  hasOAuth1?: boolean;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface XMeta {
  result_count?: number;
  next_token?: string;
  previous_token?: string;
}

export interface XResponse<T> {
  data: T;
  meta?: XMeta;
  includes?: XIncludes;
}

export interface XIncludes {
  users?: User[];
  tweets?: Tweet[];
  places?: Place[];
  media?: Media[];
}

// ============================================
// Tweet Types
// ============================================

export interface Tweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: ReferencedTweet[];
  attachments?: TweetAttachments;
  public_metrics?: TweetPublicMetrics;
  source?: string;
  lang?: string;
  geo?: TweetGeo;
}

export interface ReferencedTweet {
  type: 'retweeted' | 'quoted' | 'replied_to';
  id: string;
}

export interface TweetAttachments {
  media_keys?: string[];
  poll_ids?: string[];
}

export interface TweetPublicMetrics {
  retweet_count: number;
  reply_count: number;
  like_count: number;
  quote_count: number;
  impression_count?: number;
  bookmark_count?: number;
}

export interface TweetGeo {
  place_id?: string;
  coordinates?: {
    type: string;
    coordinates: [number, number];
  };
}

export interface TweetSearchOptions {
  query: string;
  maxResults?: number;
  nextToken?: string;
  startTime?: string;
  endTime?: string;
  sinceId?: string;
  untilId?: string;
  sortOrder?: 'recency' | 'relevancy';
}

export interface TweetLookupOptions {
  expansions?: string[];
  tweetFields?: string[];
  userFields?: string[];
  mediaFields?: string[];
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  name: string;
  username: string;
  created_at?: string;
  description?: string;
  location?: string;
  url?: string;
  profile_image_url?: string;
  verified?: boolean;
  protected?: boolean;
  public_metrics?: UserPublicMetrics;
  pinned_tweet_id?: string;
}

export interface UserPublicMetrics {
  followers_count: number;
  following_count: number;
  tweet_count: number;
  listed_count: number;
}

export interface UserLookupOptions {
  expansions?: string[];
  userFields?: string[];
  tweetFields?: string[];
}

// ============================================
// Place Types
// ============================================

export interface Place {
  id: string;
  name: string;
  full_name: string;
  country: string;
  country_code: string;
  place_type: string;
  geo?: {
    type: string;
    bbox: number[];
  };
}

// ============================================
// Media Types
// ============================================

export interface Media {
  media_key: string;
  type: 'photo' | 'video' | 'animated_gif';
  url?: string;
  preview_image_url?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  alt_text?: string;
  public_metrics?: {
    view_count?: number;
  };
}

// ============================================
// API Error Types
// ============================================

export interface XApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class XApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: XApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: XApiErrorDetail[]) {
    super(message);
    this.name = 'XApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// ============================================
// Default Field Expansions
// ============================================

export const DEFAULT_TWEET_FIELDS = [
  'id', 'text', 'author_id', 'created_at', 'public_metrics', 'source', 'lang'
];

export const DEFAULT_USER_FIELDS = [
  'id', 'name', 'username', 'created_at', 'description', 'profile_image_url', 'public_metrics', 'verified'
];

export const DEFAULT_TWEET_EXPANSIONS = ['author_id'];
