// Trigger.dev API Platform Connector Types

export interface TriggerDevConfig {
  apiKey: string;
  projectRef?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type RunStatus =
  | 'PENDING_VERSION'
  | 'DELAYED'
  | 'QUEUED'
  | 'EXECUTING'
  | 'REATTEMPTING'
  | 'FROZEN'
  | 'COMPLETED'
  | 'CANCELED'
  | 'FAILED'
  | 'CRASHED'
  | 'INTERRUPTED'
  | 'SYSTEM_FAILURE';

export interface RunEnvironment {
  id: string;
  name: string;
  user?: string;
}

export interface RunListItem {
  id: string;
  status: RunStatus;
  taskIdentifier: string;
  version?: string;
  env: RunEnvironment;
  idempotencyKey?: string;
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  delayedUntil?: string;
  tags?: string[];
  costInCents?: number;
  baseCostInCents?: number;
  durationMs?: number;
}

export interface PaginationCursor {
  next?: string;
  previous?: string;
}

export interface ListRunsResult {
  data: RunListItem[];
  pagination?: PaginationCursor;
}

export interface ListRunsParams {
  page?: {
    size?: number;
    after?: string;
    before?: string;
  };
  filter?: {
    createdAt?: {
      from?: string;
      to?: string;
      period?: string;
    };
    status?: RunStatus[];
    taskIdentifier?: string[];
    version?: string[];
    schedule?: string;
    isTest?: boolean;
    tag?: string[];
  };
}

export interface TriggerTaskBody {
  payload?: unknown;
  context?: unknown;
  options?: {
    queue?: { name?: string; concurrencyLimit?: number };
    concurrencyKey?: string;
    idempotencyKey?: string;
    ttl?: string | number;
    delay?: string;
    tags?: string | string[];
    machine?: string;
  };
}

export interface TriggerTaskResponse {
  id: string;
}

export interface ScheduleObject {
  id: string;
  task: string;
  type?: string;
  active?: boolean;
  deduplicationKey?: string;
  externalId?: string;
  generator?: {
    type?: string;
    expression?: string;
    description?: string;
  };
  timezone?: string;
  nextRun?: string;
}

export interface ListSchedulesResult {
  data: ScheduleObject[];
  pagination?: {
    currentPage?: number;
    totalPages?: number;
    count?: number;
  };
}

export interface ExecuteQueryParams {
  query: string;
  scope?: 'environment' | 'project' | 'organization';
  period?: string | null;
  from?: string | null;
  to?: string | null;
  format?: 'json' | 'csv';
}

export interface ExecuteQueryJsonResponse {
  format: 'json';
  results: Record<string, unknown>[];
}

export interface ExecuteQueryCsvResponse {
  format: 'csv';
  results: string;
}

export type ExecuteQueryResponse = ExecuteQueryJsonResponse | ExecuteQueryCsvResponse;

export class TriggerDevApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'TriggerDevApiError';
  }
}
