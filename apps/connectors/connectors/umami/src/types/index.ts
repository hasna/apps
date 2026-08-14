// Umami Connector Types

export type OutputFormat = 'json' | 'pretty' | 'table';

export type UmamiRegion = 'us' | 'eu';

export type TeamRole = 'team-owner' | 'team-member' | 'team-view-only' | 'team-manager';

export type MetricsType =
  | 'path'
  | 'entry'
  | 'exit'
  | 'title'
  | 'query'
  | 'referrer'
  | 'channel'
  | 'domain'
  | 'country'
  | 'region'
  | 'city'
  | 'browser'
  | 'os'
  | 'device'
  | 'language'
  | 'screen'
  | 'event'
  | 'hostname'
  | 'tag'
  | 'distinctId';

export type TimeUnit = 'year' | 'month' | 'day' | 'hour' | 'minute';

export interface UmamiConfig {
  apiKey: string;
  host?: string;
  baseUrl?: string;
  region?: UmamiRegion;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface WebsiteListParams extends PaginationParams {
  includeTeams?: boolean;
}

export interface WebsiteCreateParams {
  name: string;
  domain: string;
  shareId?: string | null;
  teamId?: string;
  id?: string;
}

export interface WebsiteUpdateParams {
  name?: string;
  domain?: string;
  shareId?: string | null;
  replayConfig?: Record<string, unknown>;
}

export interface DateRangeParams {
  startAt: number;
  endAt: number;
}

export interface StatsQueryParams extends DateRangeParams {
  filters?: Record<string, string>;
}

export interface PageviewsParams extends StatsQueryParams {
  unit?: TimeUnit;
  timezone?: string;
  compare?: 'prev' | 'yoy';
}

export interface MetricsParams extends StatsQueryParams {
  type: MetricsType;
  limit?: number;
  offset?: number;
}

export interface EventsListParams extends StatsQueryParams, PaginationParams {}

export interface EventDataParams extends StatsQueryParams, PaginationParams {
  event?: string;
  propertyName?: string;
}

export interface TeamCreateParams {
  name: string;
}

export interface TeamUpdateParams {
  name?: string;
  accessCode?: string;
}

export interface TeamJoinParams {
  accessCode: string;
}

export interface TeamUserParams {
  userId: string;
  role: TeamRole;
}

export interface TeamUserUpdateParams {
  role: TeamRole;
}

export class UmamiApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'UmamiApiError';
  }
}

export function parseApiError(data: unknown, status: number): UmamiApiError {
  let message = `Umami API error: HTTP ${status}`;
  let code: string | undefined;

  if (typeof data === 'object' && data !== null) {
    const err = data as Record<string, unknown>;
    message = String(err.message || err.error || message);
    code = err.code as string | undefined;
  } else if (typeof data === 'string' && data) {
    message = data;
  }

  return new UmamiApiError(message, status, code);
}
