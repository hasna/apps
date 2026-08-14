// Wistia Connector Types

export interface WistiaConfig {
  apiToken?: string;
  token?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface PaginationParams {
  page?: number;
  perPage?: number;
  sortBy?: 'name' | 'created' | 'updated';
  sortDirection?: 0 | 1;
}

export interface WistiaAccount {
  id: number;
  name: string;
  url: string;
  mediaCount: number;
  projectCount: number;
  [key: string]: unknown;
}

export interface WistiaProject {
  id: number;
  hashedId: string;
  name: string;
  description?: string;
  created: string;
  updated: string;
  mediaCount?: number;
  [key: string]: unknown;
}

export interface WistiaMedia {
  id: number;
  hashedId: string;
  name: string;
  type: string;
  created: string;
  updated: string;
  duration?: number;
  project?: { id: number; hashedId: string; name: string };
  [key: string]: unknown;
}

export interface WistiaChannel {
  id: number;
  hashedId: string;
  name: string;
  description?: string;
  created: string;
  updated: string;
  [key: string]: unknown;
}

export interface WistiaCaption {
  language: string;
  english_name?: string;
  native_name?: string;
  is_draft?: boolean;
  [key: string]: unknown;
}

export interface WistiaSharing {
  id: number;
  email: string;
  access_level?: string;
  [key: string]: unknown;
}

export interface CreateProjectParams {
  name: string;
  adminEmail?: string;
  anonymousCanUpload?: boolean;
  anonymousCanDownload?: boolean;
  isPublic?: boolean;
}

export interface CopyProjectParams {
  adminEmail?: string;
}

export interface ListMediasParams extends PaginationParams {
  projectId?: string;
  type?: string;
  name?: string;
}

export interface CopyMediaParams {
  projectId?: string;
  ownerEmail?: string;
}

export interface CreateCaptionParams {
  languageCode: string;
  captionFile?: string;
  captionFileUrl?: string;
  name?: string;
  isDraft?: boolean;
  replaceExisting?: boolean;
}

export interface UpdateCaptionParams {
  captionFile?: string;
  captionFileUrl?: string;
  isDraft?: boolean;
}

export interface CreateChannelParams {
  name: string;
  description?: string;
  layout?: string;
}

export interface CreateSharingParams {
  email: string;
  permission?: 'read_only' | 'write' | 'owner';
}

export interface StatsDateRange {
  startDate?: string;
  endDate?: string;
}

export interface ListEventsParams extends StatsDateRange, PaginationParams {
  mediaId?: string;
  visitorKey?: string;
}

export class WistiaApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'WistiaApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Check your Wistia API token.';
      case 403:
        return 'Access denied for this Wistia resource.';
      case 404:
        return 'Wistia resource not found.';
      case 429:
        return 'Wistia rate limit exceeded. Try again later.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): WistiaApiError {
  if (typeof response === 'string') {
    return new WistiaApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new WistiaApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.error as string) ||
    (data.message as string) ||
    (data.code as string) ||
    `HTTP ${statusCode} Error`;

  return new WistiaApiError(message, statusCode, data.code as string | undefined);
}
