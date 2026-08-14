// Speakeasy API Connector Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
  workspaceId?: string;
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Auth
// ============================================

export interface ApiKeyDetails {
  workspace_id: string;
}

// ============================================
// APIs
// ============================================

export interface Api {
  api_id: string;
  version_id: string;
  description: string;
  created_at?: string;
  updated_at?: string;
  workspace_id?: string;
  matched?: boolean;
  meta_data?: Record<string, string[]>;
}

export interface ApiListParams {
  metadata?: Record<string, string[]>;
  and?: boolean;
}

// ============================================
// API Endpoints
// ============================================

export interface ApiEndpoint {
  api_endpoint_id: string;
  api_id?: string;
  version_id: string;
  description: string;
  display_name: string;
  method: string;
  path: string;
  created_at?: string;
  updated_at?: string;
  workspace_id?: string;
  matched?: boolean;
}

export interface GenerateOpenApiSpecDiff {
  current_schema: string;
  new_schema: string;
}

// ============================================
// Metadata
// ============================================

export interface VersionMetadata {
  api_id?: string;
  version_id?: string;
  meta_key: string;
  meta_value: string;
  created_at?: string;
  workspace_id?: string;
}

// ============================================
// Schemas
// ============================================

export interface Schema {
  api_id?: string;
  version_id?: string;
  revision_id: string;
  description: string;
  created_at?: string;
  workspace_id?: string;
}

export interface SchemaDiff {
  additions: string[];
  deletions: string[];
  modifications: Record<string, { From: string; To: string }>;
}

// ============================================
// Event log
// ============================================

export interface Filter {
  key: string;
  value: string;
  operator: string;
}

export interface Filters {
  filters: Filter[];
  limit: number;
  offset: number;
  operator: string;
}

export interface RequestMetadata {
  key: string;
  value: string;
}

export interface BoundedRequest {
  request_id: string;
  api_id: string;
  version_id: string;
  api_endpoint_id: string;
  method: string;
  path: string;
  status: number;
  latency: number;
  customer_id: string;
  workspace_id: string;
  created_at: string;
  request_start_time: string;
  request_finish_time: string;
  metadata?: RequestMetadata[];
}

export interface UnboundedRequest {
  request_id: string;
  workspace_id: string;
  created_at: string;
  har: string;
  har_size_bytes: number;
}

// ============================================
// Embeds
// ============================================

export interface EmbedAccessTokenResponse {
  access_token: string;
}

export interface EmbedToken {
  id: string;
  description: string;
  workspace_id: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  filters: string;
  last_used?: string;
  revoked_at?: string;
  revoked_by?: string;
}

// ============================================
// Events
// ============================================

export type CliInteractionType = 'CLI_EXEC' | 'TARGET_GENERATE';

export interface CliEvent {
  id: string;
  execution_id: string;
  workspace_id: string;
  speakeasy_api_key_name: string;
  interaction_type: CliInteractionType;
  local_started_at: string;
  created_at: string;
  speakeasy_version: string;
  success: boolean;
  local_completed_at?: string;
  raw_command?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

export type CliEventBatch = CliEvent[];

// ============================================
// API Errors
// ============================================

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
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode);
}
