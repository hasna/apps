// Userpilot Connector Types

export const USERPILOT_API_VERSION = '2020-09-22' as const;
export const USERPILOT_BASE_URL = 'https://analytex.userpilot.io/v1' as const;

export interface UserpilotConfig {
  apiKey: string;
}

export type SegmentType = 'user' | 'company';
export type OutputFormat = 'json' | 'pretty';

export interface PaginationOptions {
  page?: number;
  per_page?: number;
}

export interface IdentifyUserOptions {
  user_id: string;
  metadata?: Record<string, unknown>;
  company?: Record<string, unknown>;
}

export interface BatchUser extends IdentifyUserOptions {}

export interface GroupUserOptions {
  user_id: string;
  company_id: string;
  metadata?: Record<string, unknown>;
}

export interface TrackEventOptions {
  user_id: string;
  event_name: string;
  metadata?: Record<string, unknown>;
}

export interface ListUsersOptions extends PaginationOptions {
  q?: string;
}

export interface ListExperiencesOptions extends PaginationOptions {
  type?: string;
  status?: string;
}

export interface ExperienceAnalyticsOptions {
  from?: string;
  to?: string;
  segment_id?: string;
}

export interface ListFlowsOptions extends PaginationOptions {
  status?: string;
}

export interface DateRangeOptions {
  from?: string;
  to?: string;
}

export interface ListSegmentsOptions extends PaginationOptions {
  type?: SegmentType;
}

export interface CreateSegmentOptions {
  name: string;
  type: SegmentType;
  conditions: Record<string, unknown>;
}

export interface CreateGoalOptions {
  name: string;
  rule: Record<string, unknown>;
  description?: string;
}

export interface ListEventsOptions extends PaginationOptions {
  q?: string;
  type?: string;
}

export interface ListAttributesOptions extends PaginationOptions {
  type?: SegmentType;
}

export interface CreateWebhookOptions {
  url: string;
  event_types: string[];
  secret?: string;
  active?: boolean;
}

export interface UserpilotErrorResponse {
  message?: string;
  error?: string;
}

export class UserpilotApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'UserpilotApiError';
    this.status = status;
  }
}
