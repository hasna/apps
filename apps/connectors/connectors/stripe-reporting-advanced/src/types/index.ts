// Stripe Reporting (Advanced) Connector Types
// Rebuilt from the public Stripe Reporting API docs: https://docs.stripe.com/api/reporting

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey: string;       // Stripe secret API key (sk_...)
  baseUrl?: string;     // Override default base URL
  apiVersion?: string;  // Stripe API version
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

/** Stripe list response wrapper */
export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

/** Common list options for pagination */
export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

/**
 * Stripe range query filter (Unix timestamps) used by created filters.
 * Either a bare timestamp or a comparison object.
 */
export type RangeQuery = number | { gt?: number; gte?: number; lt?: number; lte?: number };

// ============================================
// Report Type
// https://docs.stripe.com/api/reporting/report_type
// ============================================

export interface ReportType {
  id: string;
  object: 'reporting.report_type';
  /** Most recent Unix timestamp for which data is available. */
  data_available_end: number;
  /** Earliest Unix timestamp for which data is available. */
  data_available_start: number;
  /** Columns included by default when no `columns` parameter is provided. */
  default_columns?: string[];
  /** Human-readable name of the report type. */
  name: string;
  livemode: boolean;
  /** When this report type was latest updated (Unix timestamp). */
  updated: number;
  /** Version of the report type. */
  version: number;
}

export interface ReportTypeListOptions extends ListOptions {}

// ============================================
// Report Run
// https://docs.stripe.com/api/reporting/report_run
// ============================================

export type ReportRunStatus = 'pending' | 'succeeded' | 'failed';

/** File object returned as the result of a completed report run. */
export interface ReportRunResultFile {
  id: string;
  object: 'file';
  created: number;
  expires_at?: number;
  filename?: string;
  purpose?: string;
  size: number;
  title?: string;
  type?: string;
  url?: string;
}

/** Parameters that scope a report run. */
export interface ReportRunParameters {
  /** The set of output columns to include in the report. */
  columns?: string[];
  /** Connected account to run the report for (Connect only). */
  connected_account?: string;
  /** Currency to filter/convert amounts to. */
  currency?: string;
  /** Ending Unix timestamp of the requested interval (exclusive). */
  interval_end?: number;
  /** Starting Unix timestamp of the requested interval (inclusive). */
  interval_start?: number;
  /** Payout ID to scope a payout reconciliation report. */
  payout?: string;
  /** Category of balance transactions to include. */
  reporting_category?: string;
  /** IANA timezone used to bucket report data. */
  timezone?: string;
}

export interface ReportRun {
  id: string;
  object: 'reporting.report_run';
  created: number;
  /** Populated when the report run fails. */
  error?: string | null;
  livemode: boolean;
  parameters: ReportRunParameters;
  /** The ID of the report type this run generated. */
  report_type: string;
  /** The file object when the run succeeded, otherwise null. */
  result?: ReportRunResultFile | null;
  status: ReportRunStatus;
  /** Unix timestamp at which the report succeeded. */
  succeeded_at?: number | null;
}

export interface ReportRunCreateParams {
  /** The ID of the report type to run, e.g. `balance.summary.1`. */
  report_type: string;
  parameters?: ReportRunParameters;
}

export interface ReportRunListOptions extends ListOptions {
  created?: RangeQuery;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code?: string;
  message: string;
  param?: string;
  type?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly detail?: ApiErrorDetail;

  constructor(message: string, statusCode: number, detail?: ApiErrorDetail) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}
