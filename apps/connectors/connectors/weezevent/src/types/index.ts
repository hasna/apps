export interface WeezeventConfig {
  apiKey: string;
  accessToken: string;
  baseUrl?: string;
}

export type QueryValue = string | number | boolean | undefined | Array<string | number>;

export interface ListEventsOptions {
  include_not_published?: boolean;
  include_closed?: boolean;
  include_without_sales?: boolean;
}

export interface ListDatesOptions {
  id_event: Array<string | number>;
  display_passed?: boolean;
}

export interface ListTicketsOptions {
  id_event: Array<string | number>;
}

export interface TicketStatsOptions {
  id_date?: string | number;
}

export interface ListParticipantsOptions {
  id_event?: Array<string | number>;
  id_ticket?: Array<string | number>;
  last_update?: string;
  last_update_before?: string;
  create_date_from?: string;
  include_deleted?: boolean;
  moderation?: boolean;
  include_unpaid?: boolean;
  full?: boolean;
  minimized?: boolean;
  return_count?: boolean;
  return_count_total?: boolean;
  return_removed?: boolean;
  max?: number;
  page?: number;
  transaction_reference?: Array<string>;
}

export interface SearchEventsOptions {
  date?: string;
  date_start?: string;
  date_end?: string;
  category?: number;
  city?: string;
  zip_code?: string;
  country?: string;
  province?: string;
  organizer?: string;
  max_result?: number;
}

export interface AccessTokenRequest {
  username: string;
  password: string;
  apiKey: string;
}

export interface AccessTokenResponse {
  accessToken: string;
}

export class WeezeventApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WeezeventApiError';
    this.statusCode = statusCode;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}
