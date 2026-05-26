// Datadog Connector Types

// ============================================
// Configuration
// ============================================

export interface DatadogConfig {
  apiKey: string;
  appKey: string;
  site?: string; // datadoghq.com, datadoghq.eu, etc.
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Metric Types
// ============================================

export interface MetricMetadata {
  type?: 'gauge' | 'rate' | 'count';
  description?: string;
  short_name?: string;
  unit?: string;
  per_unit?: string;
  statsd_interval?: number;
}

export interface MetricPoint {
  timestamp: number;
  value: number;
}

export interface MetricSeries {
  metric: string;
  type?: 'gauge' | 'rate' | 'count';
  interval?: number;
  points: [number, number][];
  host?: string;
  tags?: string[];
}

export interface MetricQueryResult {
  status: string;
  res_type: string;
  series: Array<{
    metric: string;
    display_name?: string;
    pointlist: [number, number][];
    scope: string;
    tag_set?: string[];
    unit?: Array<{
      family: string;
      name: string;
      plural?: string;
      short_name: string;
    }>;
  }>;
  from_date: number;
  to_date: number;
  query: string;
  message?: string;
  group_by?: string[];
}

// ============================================
// Event Types
// ============================================

export interface Event {
  id?: number;
  title: string;
  text: string;
  date_happened?: number;
  priority?: 'normal' | 'low';
  host?: string;
  tags?: string[];
  alert_type?: 'error' | 'warning' | 'info' | 'success' | 'user_update' | 'recommendation' | 'snapshot';
  aggregation_key?: string;
  source_type_name?: string;
  device_name?: string;
  related_event_id?: number;
  url?: string;
}

export interface EventCreateParams {
  title: string;
  text: string;
  date_happened?: number;
  priority?: 'normal' | 'low';
  host?: string;
  tags?: string[];
  alert_type?: Event['alert_type'];
  aggregation_key?: string;
  source_type_name?: string;
  device_name?: string;
  related_event_id?: number;
}

// ============================================
// Monitor Types
// ============================================

export type MonitorType =
  | 'composite'
  | 'event alert'
  | 'log alert'
  | 'metric alert'
  | 'process alert'
  | 'query alert'
  | 'rum alert'
  | 'service check'
  | 'synthetics alert'
  | 'trace-analytics alert'
  | 'slo alert'
  | 'event-v2 alert'
  | 'audit alert'
  | 'ci-pipelines alert'
  | 'ci-tests alert'
  | 'error-tracking alert';

export interface Monitor {
  id?: number;
  org_id?: number;
  type: MonitorType;
  name: string;
  message: string;
  tags?: string[];
  query: string;
  options?: MonitorOptions;
  multi?: boolean;
  created_at?: string;
  created?: string;
  modified?: string;
  deleted?: string;
  state?: {
    groups: Record<string, {
      last_nodata_ts?: number;
      last_notified_ts?: number;
      last_resolved_ts?: number;
      last_triggered_ts?: number;
      name?: string;
      status?: string;
    }>;
  };
  overall_state?: 'Alert' | 'Ignored' | 'No Data' | 'OK' | 'Skipped' | 'Unknown' | 'Warn';
  creator?: {
    email?: string;
    handle?: string;
    id?: number;
    name?: string;
  };
  priority?: number;
  restricted_roles?: string[];
}

export interface MonitorOptions {
  aggregation?: {
    group_by?: string;
    metric?: string;
    type?: string;
  };
  device_ids?: string[];
  enable_logs_sample?: boolean;
  enable_samples?: boolean;
  escalation_message?: string;
  evaluation_delay?: number;
  group_retention_duration?: string;
  groupby_simple_monitor?: boolean;
  include_tags?: boolean;
  locked?: boolean;
  min_failure_duration?: number;
  min_location_failed?: number;
  new_group_delay?: number;
  new_host_delay?: number;
  no_data_timeframe?: number;
  notification_preset_name?: string;
  notify_audit?: boolean;
  notify_by?: string[];
  notify_no_data?: boolean;
  on_missing_data?: string;
  renotify_interval?: number;
  renotify_occurrences?: number;
  renotify_statuses?: string[];
  require_full_window?: boolean;
  scheduling_options?: {
    evaluation_window?: {
      day_starts?: string;
      hour_starts?: number;
      month_starts?: number;
    };
  };
  silenced?: Record<string, number>;
  synthetics_check_id?: string;
  threshold_windows?: {
    recovery_window?: string;
    trigger_window?: string;
  };
  thresholds?: {
    critical?: number;
    critical_recovery?: number;
    ok?: number;
    unknown?: number;
    warning?: number;
    warning_recovery?: number;
  };
  timeout_h?: number;
  variables?: Array<{
    compute?: {
      aggregation: string;
      interval?: number;
      metric?: string;
    };
    data_source: string;
    group_by?: Array<{
      facet: string;
      limit?: number;
      sort?: {
        aggregation: string;
        metric?: string;
        order?: string;
      };
    }>;
    indexes?: string[];
    name: string;
    search?: {
      query: string;
    };
  }>;
}

export interface MonitorCreateParams {
  type: MonitorType;
  name: string;
  query: string;
  message: string;
  tags?: string[];
  options?: MonitorOptions;
  priority?: number;
  restricted_roles?: string[];
}

// ============================================
// Dashboard Types
// ============================================

export interface Dashboard {
  id?: string;
  title: string;
  description?: string;
  layout_type: 'ordered' | 'free';
  widgets: Widget[];
  template_variables?: TemplateVariable[];
  template_variable_presets?: TemplateVariablePreset[];
  notify_list?: string[];
  reflow_type?: 'auto' | 'fixed';
  restricted_roles?: string[];
  is_read_only?: boolean;
  created_at?: string;
  modified_at?: string;
  author_handle?: string;
  author_name?: string;
  url?: string;
}

export interface Widget {
  id?: number;
  definition: Record<string, unknown>;
  layout?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface TemplateVariable {
  name: string;
  prefix?: string;
  available_values?: string[];
  default?: string;
  defaults?: string[];
}

export interface TemplateVariablePreset {
  name?: string;
  template_variables?: Array<{
    name?: string;
    value?: string;
    values?: string[];
  }>;
}

export interface DashboardSummary {
  id: string;
  title: string;
  description?: string;
  layout_type: string;
  url: string;
  is_read_only: boolean;
  created_at: string;
  modified_at: string;
  author_handle?: string;
}

// ============================================
// SLO Types
// ============================================

export interface SLO {
  id?: string;
  name: string;
  description?: string;
  tags?: string[];
  thresholds: SLOThreshold[];
  type: 'metric' | 'monitor' | 'time_slice';
  query?: {
    numerator: string;
    denominator: string;
  };
  monitor_ids?: number[];
  groups?: string[];
  timeframe?: string;
  target_threshold?: number;
  warning_threshold?: number;
  created_at?: number;
  modified_at?: number;
  creator?: {
    email?: string;
    handle?: string;
    name?: string;
  };
}

export interface SLOThreshold {
  timeframe: '7d' | '30d' | '90d' | 'custom';
  target: number;
  target_display?: string;
  warning?: number;
  warning_display?: string;
}

export interface SLOCreateParams {
  name: string;
  type: SLO['type'];
  thresholds: SLOThreshold[];
  description?: string;
  tags?: string[];
  query?: SLO['query'];
  monitor_ids?: number[];
  groups?: string[];
  target_threshold?: number;
  warning_threshold?: number;
}

// ============================================
// Host Types
// ============================================

export interface Host {
  id?: number;
  name?: string;
  aliases?: string[];
  apps?: string[];
  aws_name?: string;
  host_name?: string;
  is_muted?: boolean;
  last_reported_time?: number;
  meta?: {
    agent_checks?: string[][];
    agent_version?: string;
    cpu_cores?: number;
    fbsd_v?: string[];
    gohai?: string;
    install_method?: {
      installer_version?: string;
      tool?: string;
      tool_version?: string;
    };
    mac_v?: string[];
    machine?: string;
    nixv?: string[];
    platform?: string;
    processor?: string;
    python_v?: string;
    socket_fqdn?: string;
    socket_hostname?: string;
    win_v?: string[];
  };
  metrics?: {
    cpu?: number;
    iowait?: number;
    load?: number;
  };
  mute_timeout?: number;
  sources?: string[];
  tags_by_source?: Record<string, string[]>;
  up?: boolean;
}

export interface HostTotals {
  total_active?: number;
  total_up?: number;
}

// ============================================
// Downtime Types
// ============================================

export interface Downtime {
  id?: number;
  disabled?: boolean;
  start?: number;
  end?: number;
  message?: string;
  monitor_id?: number;
  monitor_tags?: string[];
  parent_id?: number;
  recurrence?: {
    period?: number;
    type?: 'days' | 'weeks' | 'months' | 'years' | 'rrule';
    until_date?: number;
    until_occurrences?: number;
    week_days?: string[];
    rrule?: string;
  };
  scope?: string[];
  timezone?: string;
  active?: boolean;
  canceled?: number;
  creator_id?: number;
  updater_id?: number;
  mute_first_recovery_notification?: boolean;
  notify_end_states?: string[];
  notify_end_types?: string[];
}

export interface DowntimeCreateParams {
  scope: string[];
  start?: number;
  end?: number;
  message?: string;
  monitor_id?: number;
  monitor_tags?: string[];
  recurrence?: Downtime['recurrence'];
  timezone?: string;
  mute_first_recovery_notification?: boolean;
  notify_end_states?: string[];
  notify_end_types?: string[];
}

// ============================================
// Synthetics Types
// ============================================

export interface SyntheticsTest {
  public_id?: string;
  name: string;
  type: 'api' | 'browser';
  subtype?: 'http' | 'ssl' | 'tcp' | 'dns' | 'icmp' | 'udp' | 'websocket' | 'grpc' | 'multi';
  config: {
    assertions?: Array<{
      type: string;
      operator?: string;
      target?: unknown;
      property?: string;
    }>;
    request?: {
      method?: string;
      url?: string;
      body?: string;
      headers?: Record<string, string>;
      timeout?: number;
      host?: string;
      port?: number;
      dns_server?: string;
      dns_server_port?: number;
      no_saving_response_body?: boolean;
      number_of_packets?: number;
      should_track_hops?: boolean;
      metadata?: Record<string, string>;
      service?: string;
      message?: string;
    };
    variables?: Array<{
      name: string;
      type?: string;
      id?: string;
      pattern?: string;
      example?: string;
      secure?: boolean;
    }>;
  };
  options?: {
    tick_every?: number;
    min_failure_duration?: number;
    min_location_failed?: number;
    follow_redirects?: boolean;
    retry?: {
      count?: number;
      interval?: number;
    };
    monitor_name?: string;
    monitor_options?: {
      renotify_interval?: number;
    };
    monitor_priority?: number;
    restricted_roles?: string[];
    ci?: {
      executionRule?: 'blocking' | 'non_blocking' | 'skipped';
    };
    ignore_server_certificate_error?: boolean;
    disable_cors?: boolean;
    disable_csp?: boolean;
    no_screenshot?: boolean;
    allow_insecure?: boolean;
    rum_settings?: {
      isEnabled?: boolean;
      applicationId?: string;
      clientTokenId?: number;
    };
  };
  locations?: string[];
  message?: string;
  tags?: string[];
  status?: 'live' | 'paused';
  monitor_id?: number;
  creator?: {
    email?: string;
    handle?: string;
    name?: string;
  };
  created_at?: string;
  modified_at?: string;
  created_by?: {
    email?: string;
    handle?: string;
    name?: string;
  };
  modified_by?: {
    email?: string;
    handle?: string;
    name?: string;
  };
}

// ============================================
// User Types
// ============================================

export interface User {
  id?: string;
  type?: string;
  attributes?: {
    created_at?: string;
    disabled?: boolean;
    email?: string;
    handle?: string;
    icon?: string;
    modified_at?: string;
    name?: string;
    service_account?: boolean;
    status?: string;
    title?: string;
    verified?: boolean;
    mfa_enabled?: boolean;
  };
  relationships?: {
    org?: {
      data?: {
        id?: string;
        type?: string;
      };
    };
    other_orgs?: {
      data?: Array<{
        id?: string;
        type?: string;
      }>;
    };
    other_users?: {
      data?: Array<{
        id?: string;
        type?: string;
      }>;
    };
    roles?: {
      data?: Array<{
        id?: string;
        type?: string;
      }>;
    };
  };
}

// ============================================
// Organization Types
// ============================================

export interface Organization {
  public_id?: string;
  name?: string;
  description?: string;
  created?: string;
  settings?: {
    saml?: {
      enabled?: boolean;
    };
    saml_autocreate_access_role?: string;
    saml_autocreate_users_domains?: {
      domains?: string[];
      enabled?: boolean;
    };
    saml_can_be_enabled?: boolean;
    saml_idp_endpoint?: string;
    saml_idp_initiated_login?: {
      enabled?: boolean;
    };
    saml_idp_metadata_uploaded?: boolean;
    saml_login_url?: string;
    saml_strict_mode?: {
      enabled?: boolean;
    };
  };
  billing?: {
    type?: string;
  };
  subscription?: {
    type?: string;
  };
}

// ============================================
// API Error Types
// ============================================

export interface DatadogErrorResponse {
  errors: string[];
}

export class DatadogApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: string[];

  constructor(message: string, statusCode: number, errors?: string[]) {
    super(message);
    this.name = 'DatadogApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
