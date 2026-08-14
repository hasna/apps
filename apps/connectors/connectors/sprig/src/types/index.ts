// Sprig Connector Types

export interface SprigConfig {
  apiKey?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type SurveyStatus =
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'COMPLETED'
  | 'DRAFT'
  | 'ARCHIVED'
  | 'NEW';

export interface PaginatedResponse<T> {
  cursor?: string;
  data: T[];
}

export interface UserEvent {
  event: string;
  timestamp?: number;
}

export interface UpsertUserRequest {
  userId: string;
  emailAddress?: string;
  attributes?: Record<string, string>;
  events?: UserEvent[];
}

export interface UserV2 {
  id: string;
  externalUserId?: string | null;
  attributes?: Record<string, unknown>;
  events?: Array<{
    event: string;
    count?: number;
    createdAt?: number;
    updatedAt?: number;
  }>;
  createdAt?: number;
}

export interface PurgeVisitorsRequest {
  emails?: string[];
  userIds?: string[];
  visitorIds?: string[];
}

export interface PurgeVisitorsResponse {
  requestId: string;
}

export interface SurveyQuestion {
  id: number;
  questionText: string;
  type: string;
  options?: unknown[];
  optionsProperties?: Record<string, unknown> | null;
  routingOptions?: unknown;
}

export interface Survey {
  id: number;
  name: string;
  status: SurveyStatus;
  platform?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  launchedAt?: string | null;
  questions?: SurveyQuestion[];
  constraints?: Array<{
    type: string;
    comparisonType?: string;
    event?: unknown;
    value?: number;
  }>;
  totalResponseLimit?: number | null;
}

export interface SurveyResponse {
  createdAt: string;
  updatedAt: string;
  surveyId: number;
  questionId: number;
  questionText: string;
  questionType: string;
  response: unknown;
  responseGroupUid: string;
  visitorId: number;
  visitorUuid?: string;
  externalUserId?: string | null;
}

export interface Theme {
  id: number;
  surveyId: number;
  questionId: number;
  questionText: string;
  questionType: string;
  theme: string;
  themeDescription?: string;
  response?: string;
  responseGroupUid?: string;
  createdAt: string;
  updatedAt: string;
  visitorId?: number;
}

export interface ListSurveysParams {
  start?: number;
  end?: number;
  cursor?: string;
  limit?: number;
  status?: SurveyStatus | SurveyStatus[];
}

export interface ListResponsesParams {
  start?: number;
  end?: number;
  cursor?: string;
  limit?: number;
  sid?: number;
  with_snapshots?: boolean;
  with_urls?: boolean;
  with_meta?: boolean;
  with_custom_metadata?: boolean;
  with_deleted_responses?: boolean;
}

export interface ListThemesParams {
  start?: number;
  end?: number;
  cursor?: string;
  limit?: number;
  sid?: number;
}

export interface AcceptedResponse {
  accepted: true;
  status: number;
}

export class SprigApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: string;

  constructor(message: string, statusCode: number, error?: string) {
    super(message);
    this.name = 'SprigApiError';
    this.statusCode = statusCode;
    this.error = error;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 403;
  }
}

export function parseSprigApiError(data: unknown, statusCode: number): SprigApiError {
  let message = `Sprig API error: HTTP ${statusCode}`;
  let error: string | undefined;

  if (typeof data === 'object' && data !== null) {
    const errData = data as Record<string, unknown>;
    if (typeof errData.error === 'string') {
      error = errData.error;
      message = errData.error;
    } else if (typeof errData.message === 'string') {
      message = errData.message;
    }
  } else if (typeof data === 'string' && data) {
    message = data;
  }

  return new SprigApiError(message, statusCode, error);
}
