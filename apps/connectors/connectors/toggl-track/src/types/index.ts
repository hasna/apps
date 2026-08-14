export interface TogglTrackConfig {
  apiToken?: string;
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

export interface TogglUser {
  id: number;
  email: string;
  fullname: string;
  default_workspace_id?: number;
  beginning_of_week?: number;
  timezone?: string;
}

export interface TogglWorkspace {
  id: number;
  name: string;
  organization_id?: number;
  premium?: boolean;
  admin?: boolean;
  default_currency?: string;
}

export interface TogglProject {
  id: number;
  workspace_id: number;
  name: string;
  client_id?: number | null;
  color?: string;
  active?: boolean;
  billable?: boolean;
  is_private?: boolean;
}

export interface TogglClient {
  id: number;
  workspace_id: number;
  name: string;
  notes?: string;
  archived?: boolean;
}

export interface TogglTag {
  id: number;
  workspace_id: number;
  name: string;
}

export interface TogglTask {
  id: number;
  project_id: number;
  workspace_id: number;
  name: string;
  active?: boolean;
  estimated_seconds?: number;
}

export interface TogglTimeEntry {
  id: number;
  workspace_id: number;
  project_id?: number | null;
  task_id?: number | null;
  description?: string;
  start: string;
  stop?: string | null;
  duration?: number;
  billable?: boolean;
  tags?: string[];
  tag_ids?: number[];
}

export interface TogglOrganization {
  id: number;
  name: string;
}

export interface TogglWorkspaceUser {
  id: number;
  uid: number;
  fullname?: string;
  email?: string;
}

export interface TogglGroup {
  id: number;
  name: string;
  workspace_id: number;
}

export interface ListProjectsOptions {
  active?: boolean | 'true' | 'false' | 'both';
  sinceDate?: string;
  billable?: boolean;
  userIds?: number[];
  clientIds?: number[];
  groupIds?: number[];
  statuses?: string[];
  name?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  perPage?: number;
  page?: number;
}

export interface CreateProjectParams {
  name: string;
  client_id?: number;
  color?: string;
  is_private?: boolean;
  active?: boolean;
  estimated_hours?: number;
  auto_estimates?: boolean;
  rate?: number;
  rate_change_mode?: 'start-today' | 'override-current' | 'override-all';
  currency?: string;
  billable?: boolean;
  template?: boolean;
  start_date?: string;
  end_date?: string;
}

export interface UpdateProjectParams {
  name?: string;
  client_id?: number;
  color?: string;
  is_private?: boolean;
  active?: boolean;
  estimated_hours?: number;
  rate?: number;
  billable?: boolean;
  start_date?: string;
  end_date?: string;
}

export interface CreateClientParams {
  name: string;
  notes?: string;
}

export interface UpdateClientParams {
  name?: string;
  notes?: string;
  archived?: boolean;
}

export interface ListTasksOptions {
  projectId?: number;
  perPage?: number;
  page?: number;
  active?: boolean;
}

export interface CreateTaskParams {
  name: string;
  estimated_seconds?: number;
  user_id?: number;
  active?: boolean;
}

export interface ListTimeEntriesOptions {
  startDate?: string;
  endDate?: string;
  before?: string;
  since?: number;
  meta?: boolean;
}

export interface CreateTimeEntryParams {
  description?: string;
  project_id?: number;
  task_id?: number;
  tags?: string[];
  tag_ids?: number[];
  billable?: boolean;
  start: string;
  stop?: string;
  duration?: number;
  created_with: string;
  user_id?: number;
  pid?: number;
}

export interface UpdateTimeEntryParams {
  description?: string;
  project_id?: number;
  task_id?: number;
  tags?: string[];
  tag_ids?: number[];
  billable?: boolean;
  start?: string;
  stop?: string;
  duration?: number;
}

export class TogglTrackApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TogglTrackApiError';
    this.statusCode = statusCode;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Check your Toggl Track API token.';
      case 403:
        return 'Access denied.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): TogglTrackApiError {
  if (typeof response === 'string') {
    return new TogglTrackApiError(response || `HTTP ${statusCode} Error`, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new TogglTrackApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    `HTTP ${statusCode} Error`;

  return new TogglTrackApiError(message, statusCode);
}
