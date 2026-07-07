// Streak CRM API Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
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

export interface StreakUser {
  key: string;
  email?: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  image?: string;
}

export interface StreakPipeline {
  key: string;
  name: string;
  description?: string;
  creatorKey?: string;
  creationTimestamp?: number;
  orgWide?: boolean;
  stages?: StreakStage[];
}

export interface StreakStage {
  key: string;
  name: string;
  pipelineKey?: string;
}

export interface StreakBox {
  key: string;
  name: string;
  notes?: string;
  pipelineKey?: string;
  stageKey?: string;
  fields?: Record<string, unknown>;
  creationTimestamp?: number;
  lastUpdatedTimestamp?: number;
}

export interface StreakField {
  key: string;
  name: string;
  type: string;
  pipelineKey?: string;
}

export interface StreakTask {
  key: string;
  text: string;
  dueDate?: number;
  status?: string;
  assignedTo?: string[];
  boxKey?: string;
}

export interface StreakComment {
  key: string;
  message: string;
  boxKey?: string;
  creatorKey?: string;
  creationTimestamp?: number;
}

export interface StreakReminder {
  key: string;
  message: string;
  remindDate: number;
  remindFollowers?: boolean;
  boxKey?: string;
}

export interface StreakTeam {
  key: string;
  name?: string;
  members?: StreakUser[];
}

export interface PipelineCreateParams {
  name: string;
  description?: string;
  orgWide?: boolean;
  aclEntries?: Array<Record<string, unknown>>;
  stages?: Array<{ name: string; key?: string }>;
}

export interface PipelineUpdateParams {
  name?: string;
  description?: string;
}

export interface BoxCreateParams {
  name: string;
  notes?: string;
  stageKey?: string;
  assignedToSharingEntries?: Array<Record<string, unknown>>;
}

export interface BoxUpdateParams {
  name?: string;
  notes?: string;
  stageKey?: string;
  fields?: Record<string, unknown>;
}

export interface BoxListParams {
  sortBy?: string;
  limit?: number;
  page?: number;
}

export interface TaskCreateParams {
  text: string;
  dueDate?: number;
  assignedTo?: string[];
}

export interface TaskUpdateParams {
  text?: string;
  dueDate?: number;
  status?: string;
  assignedTo?: string[];
}

export interface FieldCreateParams {
  name: string;
  type: string;
}

export interface ReminderCreateParams {
  message: string;
  remindDate: number;
  remindFollowers?: boolean;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, options?: { errors?: ApiErrorDetail[] }) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
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
  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode);
}
