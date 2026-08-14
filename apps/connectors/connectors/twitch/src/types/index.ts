// Twitch Helix Connector Types

export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string[];
  token_type: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface HelixListResponse<T> {
  data: T[];
  pagination?: { cursor?: string };
  total?: number;
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  type: string;
  broadcasterType: string;
  description: string;
  profileImageUrl: string;
  createdAt: string;
}

export interface TwitchChannel {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
  gameName: string;
  gameId: string;
  title: string;
  broadcasterLanguage: string;
  tags: string[];
}

export interface TwitchSearchChannel {
  id: string;
  displayName: string;
  broadcasterLogin: string;
  gameId: string;
  gameName: string;
  title: string;
  isLive: boolean;
  startedAt: string | null;
}

export interface TwitchStream {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  gameId: string;
  gameName: string;
  type: string;
  title: string;
  viewerCount: number;
  startedAt: string;
  language: string;
}

export interface TwitchChatter {
  userId: string;
  userLogin: string;
  userName: string;
}

export interface TwitchFollower {
  userId: string;
  userLogin: string;
  userName: string;
  followedAt: string;
}

export interface SendChatMessageResult {
  sent: boolean;
  messageId: string | null;
  dropReason: string | null;
}

export class TwitchApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'TwitchApiError';
  }
}
