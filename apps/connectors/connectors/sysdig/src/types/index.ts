// Sysdig Connector Types

// ============================================
// Configuration
// ============================================

export interface SysdigConfig {
  apiToken: string;
  region?: string; // us1, us2, us4, eu1, eu2, au1, me2, in1, jp1
  baseUrl?: string; // overrides region (on-prem / custom)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// User & Team Types
// ============================================

export interface User {
  id?: number;
  version?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  systemRole?: string;
  enabled?: boolean;
  activationPending?: boolean;
  dateCreated?: number;
  lastUpdated?: number;
  products?: string[];
}

export interface Team {
  id?: number;
  version?: number;
  name?: string;
  description?: string;
  theme?: string;
  show?: string;
  default?: boolean;
  immutable?: boolean;
  dateCreated?: number;
  lastUpdated?: number;
  origin?: string;
  entryPoint?: {
    module?: string;
    selection?: string;
  };
  userCount?: number;
  filter?: string;
  canUseSysdigCapture?: boolean;
  canUseAgentCli?: boolean;
  canUseCustomEvents?: boolean;
  products?: string[];
}

// ============================================
// Alert Types (Sysdig Monitor)
// ============================================

export type AlertType =
  | 'MANUAL'
  | 'BASELINE'
  | 'HOST_COMPARISON'
  | 'METRIC'
  | 'DOWNTIME'
  | 'EVENT'
  | 'GROUP_OUTLIER'
  | 'PROMETHEUS';

export interface Alert {
  id?: number;
  version?: number;
  name: string;
  description?: string;
  type?: AlertType;
  enabled?: boolean;
  severity?: number; // 0 (high) .. 7 (info)
  severityLabel?: string;
  timespan?: number; // microseconds
  condition?: string;
  segmentBy?: string[];
  segmentCondition?: {
    type?: 'ANY' | 'ALL';
  };
  filter?: string;
  notificationChannelIds?: number[];
  teamId?: number;
  autoCreated?: boolean;
  rateOfChange?: boolean;
  reNotify?: boolean;
  reNotifyMinutes?: number;
  valueOfPeakDetection?: number;
  dateCreated?: number;
  modifiedOn?: number;
  customNotification?: {
    titleTemplate?: string;
    useNewTemplateSyntax?: boolean;
    prependText?: string;
    appendText?: string;
  };
}

export interface AlertCreateParams {
  name: string;
  description?: string;
  type?: AlertType;
  enabled?: boolean;
  severity?: number;
  timespan?: number;
  condition?: string;
  segmentBy?: string[];
  segmentCondition?: Alert['segmentCondition'];
  filter?: string;
  notificationChannelIds?: number[];
  reNotify?: boolean;
  reNotifyMinutes?: number;
}

// ============================================
// Dashboard Types (Sysdig Monitor v3)
// ============================================

export interface Dashboard {
  id?: number;
  version?: number;
  name: string;
  description?: string;
  schema?: number;
  username?: string;
  shared?: boolean;
  public?: boolean;
  publicToken?: string;
  favorite?: boolean;
  layout?: unknown[];
  panels?: unknown[];
  eventDisplaySettings?: Record<string, unknown>;
  scopeExpressionList?: unknown[];
  teamId?: number;
  createdOn?: number;
  modifiedOn?: number;
}

// ============================================
// Notification Channel Types
// ============================================

export type NotificationChannelType =
  | 'EMAIL'
  | 'SLACK'
  | 'PAGER_DUTY'
  | 'OPSGENIE'
  | 'VICTOROPS'
  | 'WEBHOOK'
  | 'SNS'
  | 'MSTEAMS'
  | 'GCHAT'
  | 'IBM_EVENT_NOTIFICATIONS'
  | 'CUSTOM_WEBHOOK';

export interface NotificationChannel {
  id?: number;
  version?: number;
  type?: NotificationChannelType;
  enabled?: boolean;
  name?: string;
  teamId?: number;
  options?: {
    notifyOnOk?: boolean;
    notifyOnResolve?: boolean;
    emailRecipients?: string[];
    channel?: string;
    url?: string;
    account?: string;
    serviceKey?: string;
    apiKey?: string;
    additionalHeaders?: Record<string, string>;
    [key: string]: unknown;
  };
  createdOn?: number;
  modifiedOn?: number;
}

// ============================================
// Event Types (Sysdig Monitor v2)
// ============================================

export type EventSeverity = 'low' | 'medium' | 'high' | 'info' | 'none';

export interface SysdigEvent {
  id?: string;
  name: string;
  description?: string;
  severity?: number; // 0-7
  sev?: EventSeverity;
  tags?: Record<string, string>;
  scope?: string;
  source?: string;
  type?: string;
  timestamp?: number; // nanoseconds
  timestampSec?: number;
  createdOn?: number;
  teamId?: number;
}

export interface EventCreateParams {
  name: string;
  description?: string;
  severity?: number;
  tags?: Record<string, string>;
  scope?: string;
}

// ============================================
// Secure Policy Types
// ============================================

export interface SecurePolicy {
  id?: number;
  name?: string;
  description?: string;
  severity?: number;
  enabled?: boolean;
  type?: string;
  ruleNames?: string[];
  actions?: unknown[];
  scope?: string;
  notificationChannelIds?: number[];
  createdOn?: number;
  modifiedOn?: number;
  isManual?: boolean;
  origin?: string;
}

// ============================================
// Token
// ============================================

export interface ApiToken {
  key?: string;
}

// ============================================
// API Error Types
// ============================================

export interface SysdigErrorDetail {
  reason?: string;
  message?: string;
  field?: string;
}

export interface SysdigErrorResponse {
  errors?: SysdigErrorDetail[];
  message?: string;
  error?: string;
}

export class SysdigApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: SysdigErrorDetail[];

  constructor(message: string, statusCode: number, errors?: SysdigErrorDetail[]) {
    super(message);
    this.name = 'SysdigApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
