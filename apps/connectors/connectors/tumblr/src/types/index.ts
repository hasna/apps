// Tumblr Connector Types

export interface TumblrConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  scope?: string;
}

export interface ProfileConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  scope?: string;
  username?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface TumblrApiResponse<T = unknown> {
  meta: { status: number; msg: string };
  response: T;
}

export type OutputFormat = 'json' | 'pretty';

export type PostType =
  | 'text'
  | 'quote'
  | 'link'
  | 'answer'
  | 'video'
  | 'audio'
  | 'photo'
  | 'chat';

export type PostState = 'published' | 'queue' | 'draft' | 'private';

export type PostFilter = 'text' | 'raw';

export type AvatarSize = 16 | 24 | 30 | 40 | 48 | 64 | 96 | 128 | 512;

export type NotesMode = 'all' | 'likes' | 'conversation' | 'rollup' | 'reblogs_with_tags';

export class TumblrApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'TumblrApiError';
  }
}
