import type { ConnectorClient } from './client';
import type {
  ReportRun,
  ReportRunCreateParams,
  ReportRunListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Reporting — Report Runs API
 * https://docs.stripe.com/api/reporting/report_run
 */
export class ReportRunsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a new object and begin running the report.
   * The `report_type` (e.g. `balance.summary.1`) is required; `parameters`
   * scope the run (interval, columns, currency, timezone, ...).
   */
  async create(params: ReportRunCreateParams): Promise<ReportRun> {
    return this.client.post<ReportRun>('/reporting/report_runs', params as unknown as Record<string, unknown>);
  }

  /**
   * Retrieve the details of an existing Report Run.
   */
  async get(id: string): Promise<ReportRun> {
    return this.client.get<ReportRun>(`/reporting/report_runs/${encodeURIComponent(id)}`);
  }

  /**
   * Return a list of Report Runs, with the most recent appearing first.
   */
  async list(options?: ReportRunListOptions): Promise<StripeList<ReportRun>> {
    return this.client.get<StripeList<ReportRun>>('/reporting/report_runs', options as Record<string, unknown>);
  }
}
