// Amplitude Connector Types

// ============================================
// Configuration
// ============================================

export interface AmplitudeConfig {
  apiKey: string;
  secretKey: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Event Types
// ============================================

export interface Event {
  user_id?: string;
  device_id?: string;
  event_type: string;
  time?: number;
  event_properties?: Record<string, unknown>;
  user_properties?: Record<string, unknown>;
  groups?: Record<string, string | string[]>;
  app_version?: string;
  platform?: string;
  os_name?: string;
  os_version?: string;
  device_brand?: string;
  device_manufacturer?: string;
  device_model?: string;
  carrier?: string;
  country?: string;
  region?: string;
  city?: string;
  dma?: string;
  language?: string;
  price?: number;
  quantity?: number;
  revenue?: number;
  productId?: string;
  revenueType?: string;
  location_lat?: number;
  location_lng?: number;
  ip?: string;
  idfa?: string;
  idfv?: string;
  adid?: string;
  android_id?: string;
  event_id?: number;
  session_id?: number;
  insert_id?: string;
}

export interface BatchEventResponse {
  code: number;
  events_ingested?: number;
  payload_size_bytes?: number;
  server_upload_time?: number;
  error?: string;
  missing_field?: string;
  events_with_invalid_fields?: Record<string, unknown>;
  events_with_missing_fields?: Record<string, unknown>;
  events_with_invalid_id_lengths?: Record<string, unknown>;
  throttled_devices?: Record<string, number>;
  throttled_users?: Record<string, number>;
  throttled_events?: string[];
  silenced_devices?: string[];
  silenced_events?: string[];
}

// ============================================
// User Types
// ============================================

export interface UserProperties {
  user_id?: string;
  device_id?: string;
  user_properties: Record<string, unknown>;
}

export interface UserSearch {
  user_id?: string;
  amplitude_id?: number;
  matches: UserMatch[];
}

export interface UserMatch {
  user_id?: string;
  amplitude_id: number;
  country?: string;
  region?: string;
  city?: string;
  dma?: string;
  language?: string;
  platform?: string;
  os?: string;
  device?: string;
  device_type?: string;
  start_version?: string;
  last_used?: string;
  number_of_events?: number;
  usage_time?: number;
  device_ids?: string[];
  last_location?: {
    lat: number;
    lng: number;
  };
}

export interface UserActivity {
  events: UserActivityEvent[];
  userData?: {
    num_sessions?: number;
    purchases?: number;
    revenue?: number;
    merged_amplitude_ids?: number[];
    num_events?: number;
    canonical_amplitude_id?: number;
    user_id?: string;
    last_used?: string;
    start_version?: string;
    device_type?: string;
    device?: string;
    os?: string;
    platform?: string;
    language?: string;
    dma?: string;
    city?: string;
    region?: string;
    country?: string;
    properties?: Record<string, unknown>;
    usage_time?: number;
    first_used?: string;
    last_location?: {
      lat: number;
      lng: number;
    };
    device_ids?: string[];
  };
}

export interface UserActivityEvent {
  event_time?: string;
  event_type?: string;
  device_id?: string;
  amplitude_id?: number;
  session_id?: number;
  event_id?: number;
  event_properties?: Record<string, unknown>;
  user_properties?: Record<string, unknown>;
  country?: string;
  region?: string;
  city?: string;
  dma?: string;
  language?: string;
  platform?: string;
  os_name?: string;
  os_version?: string;
  device_family?: string;
  device_type?: string;
  ip_address?: string;
  uuid?: string;
  paying?: boolean;
  start_version?: string;
  version_name?: string;
  amplitude_event_type?: string;
  group_properties?: Record<string, unknown>;
  groups?: Record<string, unknown>;
  data?: Record<string, unknown>;
  location_lat?: number;
  location_lng?: number;
  is_attribution_event?: boolean;
  client_event_time?: string;
  client_upload_time?: string;
  server_received_time?: string;
  server_upload_time?: string;
  adid?: string;
  idfa?: string;
  library?: string;
}

// ============================================
// Export Types
// ============================================

export interface ExportParams {
  start: string; // YYYYMMDDTHH format
  end: string;   // YYYYMMDDTHH format
}

// ============================================
// Cohort Types
// ============================================

export interface Cohort {
  id: string;
  name: string;
  description?: string;
  app_id: number;
  archived: boolean;
  chart_id?: string;
  created_at: string;
  definition?: CohortDefinition;
  edit_id?: string;
  finished?: boolean;
  hidden?: boolean;
  is_official?: boolean;
  is_predictive?: boolean;
  last_computed?: string;
  last_modified?: string;
  location_id?: string;
  metadata?: string[];
  owners?: CohortOwner[];
  pending?: boolean;
  published?: boolean;
  shortcut_ids?: string[];
  size?: number;
  type?: string;
  view_count?: number;
}

export interface CohortDefinition {
  version?: number;
  type?: string;
  filters?: unknown[];
}

export interface CohortOwner {
  email?: string;
  name?: string;
}

export interface ListCohortsResult {
  cohorts: Cohort[];
}

export interface CohortMembership {
  cohort_id: string;
  user_ids?: string[];
  amplitude_ids?: number[];
  app_id: number;
  request_id: string;
}

// ============================================
// Chart Types
// ============================================

export interface Chart {
  id: string;
  title: string;
  chart_type: string;
}

export interface ChartData {
  data: ChartDataSeries[];
  metadata?: Record<string, unknown>;
}

export interface ChartDataSeries {
  seriesLabels?: string[];
  seriesCollapsed?: boolean[][];
  seriesValues?: number[][];
  xValues?: string[];
}

// ============================================
// Taxonomy Types
// ============================================

export interface EventType {
  event_type: string;
  category?: EventCategory;
  description?: string;
  display_name?: string;
}

export interface EventCategory {
  id: number;
  name: string;
}

export interface EventProperty {
  event_property: string;
  event_type: string;
  description?: string;
  type?: string;
  regex?: string;
  enum_values?: string[];
  is_array_type?: boolean;
  is_required?: boolean;
}

export interface UserProperty {
  user_property: string;
  description?: string;
  type?: string;
  regex?: string;
  enum_values?: string[];
  is_array_type?: boolean;
}

// ============================================
// API Error Types
// ============================================

export interface AmplitudeErrorResponse {
  error?: string;
  code?: number;
  message?: string;
}

export class AmplitudeApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number;

  constructor(message: string, statusCode: number, code?: number) {
    super(message);
    this.name = 'AmplitudeApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
