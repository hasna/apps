// Sumo Logic Connector Types
// Modeled on the public Sumo Logic REST API:
// https://help.sumologic.com/docs/api/

// ============================================
// Configuration
// ============================================

/**
 * Sumo Logic deployment (region). Selects the API endpoint.
 * https://help.sumologic.com/docs/api/getting-started/#which-endpoint-should-i-should-use
 */
export type SumoLogicDeployment =
  | 'us1'
  | 'us2'
  | 'eu'
  | 'au'
  | 'ca'
  | 'de'
  | 'jp'
  | 'in'
  | 'fed';

export interface SumoLogicConfig {
  accessId: string;
  accessKey: string;
  /** Deployment/region, e.g. 'us1', 'eu'. Defaults to 'us1'. */
  deployment?: SumoLogicDeployment | string;
  /** Fully-qualified endpoint override, e.g. 'https://api.eu.sumologic.com'. Takes precedence over deployment. */
  endpoint?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

/** Standard token-based pagination envelope used by several management APIs. */
export interface Paginated<T> {
  data: T[];
  next?: string;
}

// ============================================
// Search Job API (v1)
// ============================================

export interface SearchJobCreateParams {
  query: string;
  /** ISO 8601 timestamp or epoch milliseconds as a string. */
  from: string;
  /** ISO 8601 timestamp or epoch milliseconds as a string. */
  to: string;
  /** IANA time zone name, e.g. 'UTC', 'America/Los_Angeles'. */
  timeZone?: string;
  byReceiptTime?: boolean;
  autoParsingMode?: 'performance' | 'intelligent' | 'verbose' | 'AutoParse';
}

export type SearchJobState =
  | 'NOT STARTED'
  | 'GATHERING RESULTS'
  | 'GATHERING RESULTS FROM SUBQUERIES'
  | 'FORCE PAUSED'
  | 'DONE GATHERING RESULTS'
  | 'CANCELLED'
  | 'PAUSED';

export interface SearchJob {
  id: string;
  /** Location header returned when the job is created. */
  link?: { rel: string; href: string };
}

export interface SearchJobStatus {
  state: SearchJobState;
  messageCount?: number;
  recordCount?: number;
  pendingErrors?: string[];
  pendingWarnings?: string[];
  histogramBuckets?: Array<{
    length: number;
    count: number;
    startTimestamp: number;
  }>;
}

export interface SearchJobMessage {
  map: Record<string, string>;
}

export interface SearchJobMessagesResponse {
  fields: Array<{ name: string; fieldType: string; keyField: boolean }>;
  messages: SearchJobMessage[];
}

export interface SearchJobRecord {
  map: Record<string, string>;
}

export interface SearchJobRecordsResponse {
  fields: Array<{ name: string; fieldType: string; keyField: boolean }>;
  records: SearchJobRecord[];
}

// ============================================
// Collector Management API (v1)
// ============================================

export interface Collector {
  id: number;
  name: string;
  collectorType?: string;
  category?: string;
  description?: string;
  timeZone?: string;
  alive?: boolean;
  ephemeral?: boolean;
  sourceSyncMode?: string;
  hostName?: string;
  collectorVersion?: string;
  osName?: string;
  lastSeenAlive?: number;
}

export interface CollectorsResponse {
  collectors: Collector[];
}

export interface CollectorResponse {
  collector: Collector;
}

// ============================================
// Source Management API (v1)
// ============================================

export interface Source {
  id: number;
  name: string;
  category?: string;
  sourceType?: string;
  contentType?: string;
  automaticDateParsing?: boolean;
  multilineProcessingEnabled?: boolean;
  useAutolineMatching?: boolean;
  forceTimeZone?: boolean;
  timeZone?: string;
  filters?: unknown[];
  cutoffTimestamp?: number;
  encoding?: string;
  pathExpression?: string;
}

export interface SourcesResponse {
  sources: Source[];
}

export interface SourceResponse {
  source: Source;
}

// ============================================
// Dashboard (New) API (v2)
// ============================================

export interface Dashboard {
  id?: string;
  title: string;
  description?: string;
  folderId?: string;
  topologyLabelMap?: Record<string, unknown>;
  domain?: string;
  refreshInterval?: number;
  timeRange?: Record<string, unknown>;
  panels?: unknown[];
  layout?: Record<string, unknown>;
  variables?: unknown[];
  theme?: string;
}

// ============================================
// Content Management API (v2)
// ============================================

export interface ContentItem {
  id: string;
  name: string;
  itemType?: 'Folder' | 'Search' | 'Dashboard' | 'MewboardV2Report' | string;
  parentId?: string;
  description?: string;
  createdAt?: string;
  createdBy?: string;
  modifiedAt?: string;
  modifiedBy?: string;
  permissions?: string[];
}

export interface Folder extends ContentItem {
  children?: ContentItem[];
}

export interface ContentPath {
  path: string;
}

// ============================================
// Monitor Management API (v1)
// ============================================

export interface Monitor {
  id?: string;
  name: string;
  type?: 'MonitorsLibraryMonitor' | 'MonitorsLibraryFolder' | string;
  description?: string;
  parentId?: string;
  contentType?: 'Monitor' | 'Folder' | string;
  monitorType?: 'Logs' | 'Metrics' | 'Slo' | string;
  isDisabled?: boolean;
  queries?: Array<{ rowId?: string; query?: string }>;
  triggers?: unknown[];
  notifications?: unknown[];
  isMutable?: boolean;
  isSystem?: boolean;
  createdAt?: string;
  modifiedAt?: string;
}

export interface MonitorsResponse {
  children?: Monitor[];
}

// ============================================
// Role Management API (v1)
// ============================================

export interface Role {
  id?: string;
  name: string;
  description?: string;
  filterPredicate?: string;
  users?: string[];
  capabilities?: string[];
  createdAt?: string;
  modifiedAt?: string;
  systemDefined?: boolean;
}

export interface RolesResponse {
  data: Role[];
  next?: string;
}

// ============================================
// User Management API (v1)
// ============================================

export interface User {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  roleIds?: string[];
  isActive?: boolean;
  isLocked?: boolean;
  isMfaEnabled?: boolean;
  lastLoginTimestamp?: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface UsersResponse {
  data: User[];
  next?: string;
}

// ============================================
// Partition Management API (v1)
// ============================================

export interface Partition {
  id?: string;
  name: string;
  routingExpression?: string;
  analyticsTier?: string;
  retentionPeriod?: number;
  isCompliant?: boolean;
  dataForwardingId?: string;
  isActive?: boolean;
  totalBytes?: number;
  indexType?: string;
}

export interface PartitionsResponse {
  data: Partition[];
  next?: string;
}

// ============================================
// Field Management API (v1)
// ============================================

export interface Field {
  fieldId?: string;
  fieldName: string;
  dataType?: string;
  state?: string;
}

export interface FieldsResponse {
  data: Field[];
}

// ============================================
// API Error Types
// ============================================

export interface SumoLogicErrorResponse {
  id?: string;
  errors?: Array<{ code: string; message: string }>;
  code?: string;
  message?: string;
}

export class SumoLogicApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: Array<{ code: string; message: string }>;
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    errors?: Array<{ code: string; message: string }>,
    requestId?: string,
  ) {
    super(message);
    this.name = 'SumoLogicApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.requestId = requestId;
  }
}
