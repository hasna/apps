// Apache Superset Connector Types

// ============================================
// Configuration
// ============================================

export interface SupersetConfig {
  /** Base URL of the Superset instance, e.g. https://superset.example.com */
  baseUrl: string;
  /** Username for database (db) provider login */
  username?: string;
  /** Password for database (db) provider login */
  password?: string;
  /** Auth provider used by /security/login (default: "db") */
  provider?: AuthProvider;
  /** Pre-issued JWT access token (skips username/password login) */
  accessToken?: string;
  /** Refresh token used to mint new access tokens */
  refreshToken?: string;
}

export type AuthProvider = 'db' | 'ldap';

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export type OrderDirection = 'asc' | 'desc';

/** A single Superset Rison filter clause. */
export interface ListFilter {
  /** Column to filter on */
  col: string;
  /** Filter operator, e.g. "eq", "ct" (contains), "sw", "gt", "in" */
  opr: string;
  /** Value to compare against */
  value: string | number | boolean | Array<string | number>;
}

/** Options for a paginated list request. */
export interface ListOptions {
  /** Zero-based page index */
  page?: number;
  /** Page size (rows per page) */
  pageSize?: number;
  /** Column to order by */
  orderColumn?: string;
  /** Order direction */
  orderDirection?: OrderDirection;
  /** Rison filter clauses */
  filters?: ListFilter[];
  /** Restrict returned columns */
  columns?: string[];
}

/** Shape of a Superset list ("get many") response. */
export interface ListResult<T> {
  count: number;
  ids: number[];
  result: T[];
}

/** Shape of a Superset single-item ("get one") response. */
export interface ItemResult<T> {
  id: number;
  result: T;
}

// ============================================
// Auth Types
// ============================================

export interface LoginResponse {
  access_token: string;
  refresh_token?: string;
}

export interface RefreshResponse {
  access_token: string;
}

export interface CsrfResponse {
  result: string;
}

export interface CurrentUser {
  id?: number;
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  roles?: unknown;
  [key: string]: unknown;
}

// ============================================
// Resource Types
// ============================================

export interface Dashboard {
  id: number;
  dashboard_title?: string;
  slug?: string | null;
  url?: string;
  published?: boolean;
  status?: string;
  changed_on_delta_humanized?: string;
  changed_on_utc?: string;
  owners?: OwnerRef[];
  [key: string]: unknown;
}

export interface Chart {
  id: number;
  slice_name?: string;
  viz_type?: string;
  datasource_id?: number;
  datasource_type?: string;
  description?: string | null;
  url?: string;
  changed_on_delta_humanized?: string;
  owners?: OwnerRef[];
  [key: string]: unknown;
}

export interface Dataset {
  id: number;
  table_name?: string;
  schema?: string | null;
  database?: DatabaseRef;
  kind?: string;
  sql?: string | null;
  changed_on_delta_humanized?: string;
  owners?: OwnerRef[];
  [key: string]: unknown;
}

export interface Database {
  id: number;
  database_name?: string;
  backend?: string;
  expose_in_sqllab?: boolean;
  allow_run_async?: boolean;
  changed_on_delta_humanized?: string;
  [key: string]: unknown;
}

export interface SavedQuery {
  id: number;
  label?: string;
  description?: string | null;
  sql?: string;
  schema?: string | null;
  database?: DatabaseRef;
  changed_on_delta_humanized?: string;
  [key: string]: unknown;
}

export interface QueryRecord {
  id: number;
  sql?: string;
  status?: string;
  database?: DatabaseRef;
  schema?: string | null;
  rows?: number | null;
  start_time?: number;
  end_time?: number | null;
  tab_name?: string | null;
  [key: string]: unknown;
}

export interface OwnerRef {
  id?: number;
  first_name?: string;
  last_name?: string;
  [key: string]: unknown;
}

export interface DatabaseRef {
  id?: number;
  database_name?: string;
  [key: string]: unknown;
}

// ============================================
// API Error
// ============================================

export interface SupersetErrorDetail {
  message?: string;
  error_type?: string;
  [key: string]: unknown;
}

export class SupersetApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: SupersetErrorDetail[];

  constructor(message: string, statusCode: number, details?: SupersetErrorDetail[]) {
    super(message);
    this.name = 'SupersetApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
