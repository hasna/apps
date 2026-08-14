// Talend API Platform Connector Types
//
// Rebuilt against the public Talend Cloud Management Console (TMC) Public API.
// Docs: https://api.us.cloud.talend.com/tmc/ (Swagger) — base path /tmc/v1.2

// ============================================
// Configuration
// ============================================

// Talend Cloud data-center regions. Each region has a distinct API host.
export type TalendRegion = 'us' | 'eu' | 'ap';

export interface TalendConfig {
  /** Personal access token (or service account token) generated in Talend Cloud. */
  token: string;
  /** Data-center region. Ignored when `baseUrl` is provided. Defaults to 'us'. */
  region?: TalendRegion;
  /** Full API base URL override, e.g. a private/dedicated deployment. */
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty' | 'table';

/** Generic paginated envelope returned by list endpoints. */
export interface Paginated<T> {
  items: T[];
  limit?: number;
  offset?: number;
  total?: number;
}

// ============================================
// Executables (tasks / plans / promotions)
// ============================================

export interface Executable {
  executable: string;
  name: string;
  description?: string;
  workspace?: ExecutableWorkspace;
  environment?: ExecutableEnvironment;
  artifact?: ExecutableArtifact;
}

export interface ExecutableWorkspace {
  id: string;
  name: string;
}

export interface ExecutableEnvironment {
  id: string;
  name: string;
}

export interface ExecutableArtifact {
  id: string;
  name?: string;
  version?: string;
}

export interface Plan {
  id: string;
  name: string;
  description?: string;
  workspace?: ExecutableWorkspace;
  steps?: unknown[];
}

export interface Promotion {
  id: string;
  name: string;
  description?: string;
  sourceEnvironment?: ExecutableEnvironment;
  targetEnvironment?: ExecutableEnvironment;
}

// ============================================
// Executions
// ============================================

/** Lifecycle status values reported by the executions API. */
export type ExecutionStatus =
  | 'DEPLOYING'
  | 'RUNNING'
  | 'EXECUTED'
  | 'DEPLOY_FAILED'
  | 'EXECUTION_FAILED'
  | 'EXECUTION_ROLLBACK'
  | 'STOP_IN_PROGRESS'
  | 'STOPPED'
  | string;

export interface ExecutionRequest {
  /** Executable (task) id to run. */
  executable: string;
  /** Optional runtime parameter overrides. */
  parameters?: Record<string, string>;
  /** Optional log level override. */
  logLevel?: string;
}

export interface ExecutionRef {
  executionId: string;
}

export interface Execution {
  executionId: string;
  status: ExecutionStatus;
  startTimestamp?: number;
  finishTimestamp?: number;
  errorType?: string;
}

// ============================================
// API Error
// ============================================

export class TalendApiError extends Error {
  public readonly statusCode: number;
  /** Talend error code, when present in the response body. */
  public readonly errorCode?: string;

  constructor(message: string, statusCode: number, errorCode?: string) {
    super(message);
    this.name = 'TalendApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}
