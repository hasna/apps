// Tenor API Types
// Types for Google's Tenor v2 REST API (https://developers.google.com/tenor)

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;      // Tenor API key (passed as the `key` query param)
  token?: string;       // Alias for apiKey
  apiSecret?: string;   // Unused by Tenor; kept for scaffold parity
  accessToken?: string; // Unused by Tenor; kept for scaffold parity
  clientKey?: string;   // Optional Tenor `client_key` to identify the integration
  baseUrl?: string;     // Override default base URL
}

// ============================================
// OAuth2 Types (unused by Tenor; kept for scaffold parity)
// ============================================

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

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

/** Content safety filter level accepted by Tenor. */
export type ContentFilter = 'off' | 'low' | 'medium' | 'high';

/** Category listing type accepted by Tenor's /categories endpoint. */
export type CategoryType = 'featured' | 'trending';

// ============================================
// Tenor Media Types
// ============================================

/**
 * A single rendered media format (e.g. `gif`, `tinygif`, `mp4`).
 * See https://developers.google.com/tenor/guides/response-objects-and-errors
 */
export interface MediaObject {
  /** URL to the media source. */
  url: string;
  /** Width and height of the media in pixels: [width, height]. */
  dims: [number, number];
  /** Duration of the media in seconds (0 for still images). */
  duration: number;
  /** URL to a preview image of the media. */
  preview: string;
  /** Size of the file in bytes. */
  size: number;
}

/**
 * A Tenor response object (a single GIF/sticker result).
 */
export interface ResponseObject {
  /** Tenor result identifier. */
  id: string;
  /** Title of the post. */
  title: string;
  /** Map of format name to its media details. */
  media_formats: Record<string, MediaObject>;
  /** Short description / accessibility text for the content. */
  content_description: string;
  /** Full URL to the Tenor post. */
  itemurl: string;
  /** Short shareable URL to the Tenor post. */
  url: string;
  /** Search tags associated with the post. */
  tags: string[];
  /** Unix timestamp (seconds) of when the post was created. */
  created: number;
  /** Whether the post has audio (relevant for video formats). */
  hasaudio: boolean;
  /** Content flags applied to the post. */
  flags?: string[];
}

/**
 * A category returned by the /categories endpoint.
 */
export interface Category {
  /** The search term the category maps to. */
  searchterm: string;
  /** The Tenor path for the category's results. */
  path: string;
  /** A GIF preview URL representing the category. */
  image: string;
  /** Localized display name of the category. */
  name: string;
}

// ============================================
// Tenor Response Shapes
// ============================================

/** Response from /search and /featured. */
export interface TenorSearchResponse {
  results: ResponseObject[];
  /** Position for the next page of results (empty when no more). */
  next: string;
}

/** Response from /categories. */
export interface CategoriesResponse {
  tags: Category[];
}

/** Response from /autocomplete, /trending_terms, and /search_suggestions. */
export interface TermsResponse {
  results: string[];
}

// ============================================
// Tenor Request Parameters
// ============================================

export interface SearchParams {
  /** Maximum number of results to return (1-50, default 20). */
  limit?: number;
  /** Position of the results to return (from a previous `next` value). */
  pos?: string;
  /** BCP-47 language/locale, e.g. `en_US`. */
  locale?: string;
  /** Two-letter ISO 3166-1 country code, e.g. `US`. */
  country?: string;
  /** Content safety filter level. */
  contentFilter?: ContentFilter;
  /** Comma-separated list of media formats to include. */
  mediaFilter?: string;
  /** Aspect-ratio range: `all`, `wide`, or `standard`. */
  arRange?: 'all' | 'wide' | 'standard';
  /** Randomize the order of returned results. */
  random?: boolean;
}

export interface CategoriesParams {
  type?: CategoryType;
  locale?: string;
  country?: string;
  contentFilter?: ContentFilter;
}

export interface TermsParams {
  limit?: number;
  locale?: string;
  country?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  resource?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly documentationUrl?: string;
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: {
      errors?: ApiErrorDetail[];
      documentationUrl?: string;
      requestId?: string;
    }
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.documentationUrl = options?.documentationUrl;
    this.requestId = options?.requestId;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 400:
        return 'Bad request. Please check your input.';
      case 401:
        return 'Authentication failed. Please check your Tenor API key.';
      case 403:
        return 'Access denied. Your API key may not have access to this service.';
      case 404:
        return 'Resource not found.';
      case 422:
        return 'Invalid parameters. Please check your input.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      case 500:
        return 'Server error. Please try again later.';
      case 502:
      case 503:
      case 504:
        return 'Service temporarily unavailable. Please try again later.';
      default:
        return this.message;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errors: this.errors,
      documentationUrl: this.documentationUrl,
      requestId: this.requestId,
    };
  }
}

export function parseApiError(
  response: unknown,
  statusCode: number
): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  const errorObj = data.error as Record<string, unknown> | undefined;
  const message =
    (errorObj?.message as string) ||
    (data.message as string) ||
    (data.error as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode);
}
