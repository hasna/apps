// VWO API Types

export interface ConnectorConfig {
  apiToken?: string;
  token?: string;
  accountId?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ListParams {
  limit?: number;
  offset?: number;
}

export type CampaignType =
  | 'VISUAL_AB'
  | 'SPLIT_URL'
  | 'MULTIVARIATE'
  | 'PERSONALIZE'
  | 'FUNNEL'
  | 'FEATURE_TEST'
  | 'FEATURE_ROLLOUT';

export type GoalType = 'VISIT_PAGE' | 'CUSTOM_CONVERSION' | 'REVENUE' | 'ENGAGEMENT' | 'CLICK';

export type MetricType = 'CONVERSION' | 'REVENUE' | 'ENGAGEMENT' | 'CUSTOM_DIMENSION';

export interface Account {
  id: string;
  name?: string;
  email?: string;
  plan?: string;
}

export interface Campaign {
  id: string | number;
  name: string;
  type?: CampaignType;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CampaignCreateParams {
  name: string;
  type: CampaignType;
  variations: Array<Record<string, unknown>>;
  goals?: Array<Record<string, unknown>>;
  segmentation?: Record<string, unknown>;
  trafficAllocation?: number;
  description?: string;
  tags?: string[];
}

export interface CampaignListParams extends ListParams {
  status?: string;
  type?: string;
  q?: string;
}

export interface CampaignReportParams {
  startDate?: string;
  endDate?: string;
  metric?: string;
  segmentId?: string;
  goalId?: string;
}

export interface Goal {
  id: string | number;
  name: string;
  type?: GoalType;
}

export interface GoalCreateParams {
  name: string;
  type: GoalType;
  rule?: Record<string, unknown>;
  revenue?: Record<string, unknown>;
}

export interface Segment {
  id: string | number;
  name: string;
  description?: string;
}

export interface SegmentCreateParams {
  name: string;
  conditions: Record<string, unknown>;
  description?: string;
}

export interface FeatureFlag {
  id: string | number;
  name: string;
  key: string;
  status?: string;
}

export interface FeatureFlagCreateParams {
  name: string;
  key: string;
  description?: string;
  variables?: Array<Record<string, unknown>>;
  rules?: Array<Record<string, unknown>>;
  environments?: Record<string, unknown>;
}

export interface Environment {
  id: string | number;
  name: string;
  key: string;
  description?: string;
}

export interface EnvironmentCreateParams {
  name: string;
  key: string;
  description?: string;
}

export interface Metric {
  id: string | number;
  name: string;
  type?: MetricType;
}

export interface MetricCreateParams {
  name: string;
  type: MetricType;
  rule?: Record<string, unknown>;
}

export interface Survey {
  id: string | number;
  name?: string;
  status?: string;
}

export interface SurveyListParams extends ListParams {
  status?: string;
}

export interface SurveyResponsesParams extends ListParams {
  startDate?: string;
  endDate?: string;
}

export interface Heatmap {
  id: string | number;
  name?: string;
  status?: string;
}

export interface HeatmapListParams extends ListParams {
  status?: string;
}

export interface SessionRecording {
  id: string | number;
  campaignId?: string;
  createdAt?: string;
}

export interface SessionRecordingListParams extends ListParams {
  startDate?: string;
  endDate?: string;
  campaignId?: string;
}

export interface Webhook {
  id: string | number;
  url: string;
  eventTypes?: string[];
  active?: boolean;
}

export interface WebhookCreateParams {
  url: string;
  eventTypes: string[];
  secret?: string;
  active?: boolean;
}

export interface AuditLogListParams extends ListParams {
  user?: string;
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
}

export interface User {
  id: string | number;
  email?: string;
  role?: string;
}

export interface UserInviteParams {
  email: string;
  role: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, requestId?: string) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.requestId = requestId;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = asRecord(response);
  const errorObj = asRecord(data._error);

  const message =
    (errorObj.message as string) ||
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    `HTTP ${statusCode} Error`;

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (errorObj.requestId as string);

  return new ConnectorApiError(message, statusCode, requestId);
}
