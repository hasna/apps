// Stripe Sigma Connector Types

export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;
  accountId?: string;
  apiVersion?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type QueryRunStatus = 'running' | 'completed' | 'failed' | 'canceled';

export interface QueryRunResult {
  file?: string;
}

export interface QueryRunError {
  message?: string;
  type?: string;
}

export interface QueryRun {
  id: string;
  object: 'sigma.sigma_query_run';
  created: number;
  error: QueryRunError | null;
  finalized_at: number | null;
  livemode: boolean;
  result: QueryRunResult | null;
  sql?: string;
  status: QueryRunStatus;
}

export interface CreateQueryRunParams {
  sql?: string;
  from_saved_query?: string;
}

export class ConnectorApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ConnectorApiError';
  }
}
