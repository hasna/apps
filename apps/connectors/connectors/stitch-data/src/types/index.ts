// Stitch (Stitch Connect) Connector Types
// Modeled on the public Stitch Connect API (v4).
// See: https://www.stitchdata.com/docs/developers/stitch-connect/api

// ============================================
// Configuration
// ============================================

export interface StitchConfig {
  /** Non-expiring Stitch Connect API access token (sent as a Bearer token) */
  accessToken: string;
  /** Stitch client (account) ID, required for extractions/loads reporting endpoints */
  clientId?: number;
  /** Override the API base URL (defaults to https://api.stitchdata.com) */
  baseUrl?: string;
  /** Maximum number of retries for rate-limited (429) and 5xx responses */
  maxRetries?: number;
}

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// Common Types
// ============================================

/** Cursor-style link block returned by paginated reporting endpoints */
export interface StitchLinks {
  next?: string;
  previous?: string;
  [key: string]: string | undefined;
}

/** Envelope returned by the paginated extractions/loads endpoints */
export interface StitchPage<T> {
  data: T[];
  page?: number;
  total?: number;
  links?: StitchLinks;
}

// ============================================
// Source Types
// ============================================

/** Report card describing a resource's setup/validation status */
export interface StitchReportCard {
  type?: string;
  current_step?: number;
  current_step_type?: string;
  steps?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** Replication schedule information for a source */
export interface StitchSchedule {
  frequency_in_minutes?: string;
  cron_expression?: string;
  [key: string]: unknown;
}

/** A configured data source (integration) */
export interface StitchSource {
  id: number;
  type: string;
  display_name: string;
  /** Numeric client/account id that owns the source */
  stitch_client_id?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  /** Timestamp the source was paused by the user, if any */
  paused_at?: string | null;
  /** Timestamp the source was paused by the system, if any */
  system_paused_at?: string | null;
  properties?: Record<string, unknown>;
  report_card?: StitchReportCard;
  schedule?: StitchSchedule;
  [key: string]: unknown;
}

/** Payload for creating a source */
export interface CreateSourceRequest {
  type: string;
  display_name: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Payload for updating a source */
export interface UpdateSourceRequest {
  display_name?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Result of the most recent connection check for a source */
export interface StitchConnectionCheck {
  status?: string;
  last_status?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================
// Source Type (catalog) Types
// ============================================

/** Metadata describing an available integration type in the Stitch catalog */
export interface StitchSourceType {
  type: string;
  current_version?: number;
  protocol_version?: string;
  properties_annotation?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// ============================================
// Destination Types
// ============================================

/** A configured data destination (warehouse) */
export interface StitchDestination {
  id: number;
  type: string;
  display_name: string;
  stitch_client_id?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  properties?: Record<string, unknown>;
  report_card?: StitchReportCard;
  [key: string]: unknown;
}

export interface CreateDestinationRequest {
  type: string;
  display_name?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UpdateDestinationRequest {
  display_name?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Metadata describing an available destination type in the Stitch catalog */
export interface StitchDestinationType {
  type: string;
  current_version?: number;
  protocol_version?: string;
  properties_annotation?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// ============================================
// Stream Types
// ============================================

/** A stream (table/object) exposed by a source */
export interface StitchStream {
  stream_id: number;
  source_id?: number;
  tap_stream_id?: string;
  stream_name?: string;
  selected?: boolean;
  replication_method?: string;
  metadata?: Array<Record<string, unknown>>;
  schema?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A single metadata patch inside a stream metadata update. */
export interface StreamMetadataPatch {
  /** Breadcrumb path targeting the stream root or a field within the stream. */
  breadcrumb: string[];
  metadata: Record<string, unknown>;
}

/** A stream metadata update payload for Stitch's streams/metadata endpoint. */
export interface StreamMetadataUpdate {
  tap_stream_id: string;
  metadata: StreamMetadataPatch[];
}

// ============================================
// Extraction / Load reporting Types
// ============================================

/** An extraction job (tap run) for a source */
export interface StitchExtraction {
  source_id?: number;
  job_name?: string;
  start_time?: string;
  end_time?: string;
  tap_description?: string;
  target_exit_status?: number;
  tap_exit_status?: number;
  discovery_exit_status?: number;
  completion_time?: string;
  [key: string]: unknown;
}

/** A load event for a destination table */
export interface StitchLoad {
  source_id?: number;
  source_name?: string;
  schema_name?: string;
  table_name?: string;
  last_batch_loaded_at?: string;
  error_state?: unknown;
  [key: string]: unknown;
}

// ============================================
// Import API (source) Tokens
// ============================================

/** An Import API token scoped to a source */
export interface StitchSourceToken {
  id?: number;
  source_id?: number;
  token?: string;
  created_at?: string;
  [key: string]: unknown;
}

// ============================================
// Errors
// ============================================

export interface StitchErrorDetail {
  name?: string;
  message?: string;
  [key: string]: unknown;
}

export class StitchApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly errors?: StitchErrorDetail[];

  constructor(message: string, statusCode: number, code?: string, errors?: StitchErrorDetail[]) {
    super(message);
    this.name = 'StitchApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
  }
}
