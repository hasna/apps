// Ticketmaster Discovery API Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Search Parameters
// ============================================

export interface EventsSearchParams {
  keyword?: string;
  id?: string;
  attractionId?: string;
  venueId?: string;
  classificationName?: string;
  classificationId?: string;
  segmentId?: string;
  segmentName?: string;
  genreId?: string;
  subGenreId?: string;
  startDateTime?: string;
  endDateTime?: string;
  city?: string;
  stateCode?: string;
  countryCode?: string;
  postalCode?: string;
  latlong?: string;
  radius?: number;
  unit?: 'miles' | 'km';
  source?: 'ticketmaster' | 'universe' | 'frontgate' | 'tmr';
  locale?: string;
  size?: number;
  page?: number;
  sort?: string;
}

export interface AttractionsSearchParams {
  keyword?: string;
  id?: string;
  classificationName?: string;
  classificationId?: string;
  segmentId?: string;
  genreId?: string;
  subGenreId?: string;
  source?: string;
  locale?: string;
  size?: number;
  page?: number;
  sort?: string;
}

export interface VenuesSearchParams {
  keyword?: string;
  id?: string;
  city?: string;
  stateCode?: string;
  countryCode?: string;
  postalCode?: string;
  latlong?: string;
  radius?: number;
  unit?: 'miles' | 'km';
  source?: string;
  locale?: string;
  size?: number;
  page?: number;
  sort?: string;
}

// ============================================
// Discovery API Response Types (HAL JSON)
// ============================================

export interface DiscoveryPage {
  size?: number;
  totalElements?: number;
  totalPages?: number;
  number?: number;
}

export interface DiscoveryLinks {
  self?: { href: string };
  next?: { href: string };
  prev?: { href: string };
  first?: { href: string };
  last?: { href: string };
}

export interface EventsSearchResponse {
  _embedded?: {
    events?: DiscoveryEvent[];
  };
  _links?: DiscoveryLinks;
  page?: DiscoveryPage;
}

export interface AttractionsSearchResponse {
  _embedded?: {
    attractions?: DiscoveryAttraction[];
  };
  _links?: DiscoveryLinks;
  page?: DiscoveryPage;
}

export interface VenuesSearchResponse {
  _embedded?: {
    venues?: DiscoveryVenue[];
  };
  _links?: DiscoveryLinks;
  page?: DiscoveryPage;
}

export interface DiscoveryEvent {
  id?: string;
  name?: string;
  type?: string;
  url?: string;
  locale?: string;
  dates?: Record<string, unknown>;
  classifications?: Record<string, unknown>[];
  _embedded?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DiscoveryAttraction {
  id?: string;
  name?: string;
  type?: string;
  url?: string;
  locale?: string;
  classifications?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface DiscoveryVenue {
  id?: string;
  name?: string;
  type?: string;
  url?: string;
  locale?: string;
  city?: Record<string, unknown>;
  state?: Record<string, unknown>;
  country?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================
// API Error Types
// ============================================

export class ConnectorApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
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
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const fault = data.fault as Record<string, unknown> | undefined;
  const message =
    (fault?.faultstring as string) ||
    (data.message as string) ||
    (data.error as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode);
}
