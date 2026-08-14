// WakaTime Connector Types

export interface WakatimeConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

export type QueryValue = string | number | boolean | undefined;

export interface UserScopedOptions {
  user?: string;
}

export interface AllTimeOptions extends UserScopedOptions {
  project?: string;
}

export interface HeartbeatsListOptions extends UserScopedOptions {
  date: string;
  timezone?: string;
}

export interface CreateHeartbeatOptions extends UserScopedOptions {
  entity: string;
  type: string;
  time: number;
  project?: string;
  language?: string;
  isWrite?: boolean;
  lines?: number;
}

export interface DeleteHeartbeatsOptions extends UserScopedOptions {
  ids: string[];
}

export interface DurationsOptions extends UserScopedOptions {
  date: string;
  project?: string;
  timezone?: string;
}

export interface SummariesOptions extends UserScopedOptions {
  start?: string;
  end?: string;
  range?: string;
  project?: string;
  timezone?: string;
}

export interface StatsOptions extends UserScopedOptions {
  range?: string;
  project?: string;
  timeout?: number;
}

export interface InsightOptions extends UserScopedOptions {
  insightType: string;
  range: string;
}

export interface ProjectCommitsOptions extends UserScopedOptions {
  project: string;
  page?: number;
  branch?: string;
  author?: string;
}

export interface GetCommitOptions extends UserScopedOptions {
  project: string;
  hash: string;
}

export interface LeadersOptions {
  language?: string;
  page?: number;
  countryCode?: string;
}

export interface OrgDashboardsOptions extends UserScopedOptions {
  org: string;
}

export interface UpdateCustomRulesOptions extends UserScopedOptions {
  rules: Array<Record<string, unknown>>;
}

export class WakatimeApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WakatimeApiError';
    this.statusCode = statusCode;
  }
}
