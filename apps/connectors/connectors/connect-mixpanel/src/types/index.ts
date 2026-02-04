// Mixpanel Connector Types

// ============================================
// Configuration
// ============================================

export interface MixpanelConfig {
  /** Project token for tracking events */
  projectToken?: string;
  /** API secret for reading data */
  apiSecret?: string;
  /** Service account username (for Data Pipelines API) */
  serviceAccountUsername?: string;
  /** Service account secret (for Data Pipelines API) */
  serviceAccountSecret?: string;
  /** Project ID (required for some API calls) */
  projectId?: string;
  /** Data residency region (US, EU, or IN for India) */
  region?: 'US' | 'EU' | 'IN';
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  page?: number;
  hasMore: boolean;
}

// ============================================
// Track API Types
// ============================================

export interface TrackEvent {
  event: string;
  properties: TrackEventProperties;
}

export interface TrackEventProperties {
  token?: string;
  distinct_id?: string;
  time?: number;
  $insert_id?: string;
  [key: string]: unknown;
}

export interface TrackResponse {
  status: 0 | 1;
  error?: string;
}

export interface TrackBatchResponse {
  status: 0 | 1;
  num_records_imported?: number;
  error?: string;
}

// ============================================
// Engage (User Profiles) API Types
// ============================================

export interface ProfileOperation {
  $token: string;
  $distinct_id: string;
  $ip?: string;
  $time?: number;
  $ignore_time?: boolean;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
  $add?: Record<string, number>;
  $append?: Record<string, unknown>;
  $remove?: Record<string, unknown>;
  $unset?: string[];
  $delete?: string;
  $union?: Record<string, unknown[]>;
}

export interface ProfileResponse {
  status: 0 | 1;
  error?: string;
}

export interface UserProfile {
  $distinct_id: string;
  $properties: Record<string, unknown>;
}

export interface QueryProfilesResponse {
  status: string;
  results: UserProfile[];
  page: number;
  page_size: number;
  total?: number;
  session_id?: string;
}

// ============================================
// Export API Types
// ============================================

export interface ExportParams {
  from_date: string;
  to_date: string;
  event?: string[];
  where?: string;
  bucket?: string;
}

export interface ExportedEvent {
  event: string;
  properties: Record<string, unknown>;
}

// ============================================
// Insights (JQL) API Types
// ============================================

export interface JQLQuery {
  script: string;
  params?: Record<string, unknown>;
}

export interface JQLResponse {
  status: string;
  results: unknown[];
  error?: string;
  compute_time?: number;
}

// ============================================
// Funnels API Types
// ============================================

export interface Funnel {
  funnel_id: number;
  name: string;
}

export interface FunnelStep {
  event: string;
  count: number;
  step_conv_ratio: number;
  overall_conv_ratio: number;
  avg_time?: number;
}

export interface FunnelData {
  meta: {
    dates: string;
  };
  data: {
    [date: string]: {
      steps: FunnelStep[];
      analysis: {
        completion: number;
        starting_amount: number;
        steps: number;
        worst: number;
      };
    };
  };
}

export interface FunnelListResponse {
  status: string;
  results: Funnel[];
}

export interface FunnelDataResponse {
  status: string;
  data: FunnelData;
  error?: string;
}

// ============================================
// Retention API Types
// ============================================

export interface RetentionParams {
  from_date: string;
  to_date: string;
  retention_type?: 'birth' | 'compounded';
  born_event?: string;
  event?: string;
  born_where?: string;
  where?: string;
  interval?: number;
  interval_count?: number;
  unit?: 'day' | 'week' | 'month';
}

export interface RetentionData {
  date: string;
  count: number;
  first: number;
  counts: number[];
}

export interface RetentionResponse {
  status: string;
  data: RetentionData[];
  error?: string;
}

// ============================================
// Segmentation API Types
// ============================================

export interface SegmentationParams {
  event: string;
  from_date: string;
  to_date: string;
  type?: 'general' | 'unique' | 'average';
  unit?: 'minute' | 'hour' | 'day' | 'week' | 'month';
  on?: string;
  where?: string;
  limit?: number;
}

export interface SegmentationData {
  series: string[];
  values: {
    [segment: string]: {
      [date: string]: number;
    };
  };
}

export interface SegmentationResponse {
  status: string;
  data: SegmentationData;
  legend_size: number;
  error?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class MixpanelApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'MixpanelApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}
