// Splunk Cloud Platform Connector Types
//
// Types model the public Splunk Cloud Platform REST API (splunkd management
// endpoint, /services/*). Responses are requested with output_mode=json, which
// wraps collections in an Atom-style envelope with an `entry` array.

// ============================================
// Configuration
// ============================================

export interface SplunkCloudConfig {
  /** REST management base URL, e.g. https://<stack>.splunkcloud.com:8089 */
  baseUrl: string;
  /** Bearer authentication token (preferred). */
  token?: string;
  /** Username for Basic authentication (used when no token is supplied). */
  username?: string;
  /** Password for Basic authentication. */
  password?: string;
  /** Number of retries for retryable failures (default: 3). */
  retries?: number;
  /** Request timeout in milliseconds (default: 30000). */
  timeout?: number;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

// ============================================
// Common REST envelope
// ============================================

/**
 * Splunk wraps every collection response in an Atom-feed-like envelope when
 * output_mode=json. Individual resources come back as a single-element `entry`.
 */
export interface SplunkCollection<T = Record<string, unknown>> {
  links?: Record<string, string>;
  origin?: string;
  updated?: string;
  generator?: Record<string, unknown>;
  entry: SplunkEntry<T>[];
  paging?: {
    total: number;
    perPage: number;
    offset: number;
  };
  messages?: SplunkMessage[];
}

export interface SplunkEntry<T = Record<string, unknown>> {
  name: string;
  id?: string;
  updated?: string;
  links?: Record<string, string>;
  author?: string;
  acl?: SplunkAcl;
  content: T;
}

export interface SplunkAcl {
  app?: string;
  owner?: string;
  sharing?: string;
  perms?: {
    read?: string[];
    write?: string[];
  };
  removable?: boolean;
  modifiable?: boolean;
  [key: string]: unknown;
}

export interface SplunkMessage {
  type: string;
  text: string;
}

// ============================================
// Server info / health
// ============================================

export interface ServerInfo {
  serverName?: string;
  version?: string;
  build?: string;
  cpu_arch?: string;
  os_name?: string;
  numberOfCores?: number;
  physicalMemoryMB?: number;
  isCloud?: number | boolean;
  [key: string]: unknown;
}

// ============================================
// Search jobs
// ============================================

export interface SearchJobContent {
  sid?: string;
  dispatchState?: string;
  isDone?: boolean;
  isFailed?: boolean;
  isPaused?: boolean;
  doneProgress?: number;
  eventCount?: number;
  resultCount?: number;
  scanCount?: number;
  runDuration?: number;
  earliestTime?: string;
  latestTime?: string;
  [key: string]: unknown;
}

export interface CreateSearchJobParams {
  /** SPL search string. A leading `search` is added automatically if absent. */
  search: string;
  earliestTime?: string;
  latestTime?: string;
  /** normal (async, default), blocking, oneshot, or export. */
  execMode?: 'normal' | 'blocking' | 'oneshot';
  /** Result count limit. */
  maxCount?: number;
  /** Additional raw parameters forwarded to the endpoint. */
  extra?: Record<string, string | number | boolean>;
}

export interface SearchResults {
  preview?: boolean;
  init_offset?: number;
  messages?: SplunkMessage[];
  fields?: Array<{ name: string }>;
  results: Array<Record<string, unknown>>;
}

export type JobControlAction =
  | 'pause'
  | 'unpause'
  | 'finalize'
  | 'cancel'
  | 'touch'
  | 'save'
  | 'unsave'
  | 'enablepreview'
  | 'disablepreview';

// ============================================
// Saved searches
// ============================================

export interface SavedSearchContent {
  search?: string;
  description?: string;
  'dispatch.earliest_time'?: string;
  'dispatch.latest_time'?: string;
  is_scheduled?: boolean;
  cron_schedule?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

export interface CreateSavedSearchParams {
  name: string;
  search: string;
  description?: string;
  cronSchedule?: string;
  isScheduled?: boolean;
  earliestTime?: string;
  latestTime?: string;
  extra?: Record<string, string | number | boolean>;
}

export interface UpdateSavedSearchParams {
  search?: string;
  description?: string;
  cronSchedule?: string;
  isScheduled?: boolean;
  disabled?: boolean;
  earliestTime?: string;
  latestTime?: string;
  extra?: Record<string, string | number | boolean>;
}

// ============================================
// Indexes
// ============================================

export interface IndexContent {
  totalEventCount?: number;
  currentDBSizeMB?: number;
  maxTotalDataSizeMB?: number;
  frozenTimePeriodInSecs?: number;
  disabled?: boolean;
  datatype?: string;
  [key: string]: unknown;
}

export interface CreateIndexParams {
  name: string;
  maxTotalDataSizeMB?: number;
  frozenTimePeriodInSecs?: number;
  datatype?: 'event' | 'metric';
  extra?: Record<string, string | number | boolean>;
}

// ============================================
// HTTP Event Collector (HEC) tokens
// ============================================

export interface HecTokenContent {
  token?: string;
  index?: string;
  indexes?: string;
  source?: string;
  sourcetype?: string;
  disabled?: boolean;
  useACK?: boolean;
  [key: string]: unknown;
}

export interface CreateHecTokenParams {
  name: string;
  index?: string;
  indexes?: string;
  source?: string;
  sourcetype?: string;
  useACK?: boolean;
  extra?: Record<string, string | number | boolean>;
}

// ============================================
// Users & roles
// ============================================

export interface UserContent {
  realname?: string;
  email?: string;
  roles?: string[];
  defaultApp?: string;
  type?: string;
  [key: string]: unknown;
}

export interface CreateUserParams {
  name: string;
  password: string;
  roles: string[];
  realname?: string;
  email?: string;
  defaultApp?: string;
  extra?: Record<string, string | number | boolean>;
}

export interface RoleContent {
  capabilities?: string[];
  imported_roles?: string[];
  srchIndexesAllowed?: string[];
  defaultApp?: string;
  [key: string]: unknown;
}

// ============================================
// Messages / alerts / apps
// ============================================

export interface MessageContent {
  message?: string;
  severity?: string;
  [key: string]: unknown;
}

export interface FiredAlertContent {
  savedsearch_name?: string;
  trigger_time?: number;
  severity?: string;
  sid?: string;
  [key: string]: unknown;
}

export interface AppContent {
  label?: string;
  version?: string;
  description?: string;
  disabled?: boolean;
  visible?: boolean;
  [key: string]: unknown;
}

// ============================================
// API Error
// ============================================

export interface SplunkErrorResponse {
  messages?: SplunkMessage[];
}

export class SplunkCloudApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;
  public readonly messages?: SplunkMessage[];

  constructor(message: string, statusCode: number, responseBody?: string, messages?: SplunkMessage[]) {
    super(message);
    this.name = 'SplunkCloudApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.messages = messages;
  }
}

/**
 * Build a SplunkCloudApiError from a parsed error body. Splunk returns
 * { messages: [{ type, text }] } for most REST errors.
 */
export function parseApiError(data: unknown, status: number): SplunkCloudApiError {
  if (data && typeof data === 'object' && 'messages' in data) {
    const messages = (data as SplunkErrorResponse).messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const text = messages.map(m => m.text).join('; ');
      return new SplunkCloudApiError(text, status, JSON.stringify(data), messages);
    }
  }
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return new SplunkCloudApiError(`Splunk Cloud API request failed with status ${status}`, status, body);
}
