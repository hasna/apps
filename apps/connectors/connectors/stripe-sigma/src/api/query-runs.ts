import type { ConnectorClient } from './client';
import type { CreateQueryRunParams, QueryRun } from '../types';

/**
 * Stripe Sigma Query Runs API
 * @see https://docs.stripe.com/api/sigma/query_runs
 */
export class QueryRunsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a query run (POST /v1/sigma/query_runs).
   * Provide either `sql` or `from_saved_query`, not both.
   */
  async create(params: CreateQueryRunParams): Promise<QueryRun> {
    if (!params.sql && !params.from_saved_query) {
      throw new Error('Either sql or from_saved_query is required');
    }
    if (params.sql && params.from_saved_query) {
      throw new Error('Only one of sql or from_saved_query should be provided');
    }

    const body: Record<string, string> = {};
    if (params.sql) body.sql = params.sql;
    if (params.from_saved_query) body.from_saved_query = params.from_saved_query;

    return this.client.post<QueryRun>('/sigma/query_runs', body);
  }

  /**
   * Retrieve a query run (GET /v1/sigma/query_runs/:id).
   */
  async get(id: string): Promise<QueryRun> {
    return this.client.get<QueryRun>(`/sigma/query_runs/${encodeURIComponent(id)}`);
  }
}
