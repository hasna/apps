import type { ConnectorClient } from './client';
import type {
  ReportType,
  ReportTypeListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Reporting — Report Types API
 * https://docs.stripe.com/api/reporting/report_type
 */
export class ReportTypesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Retrieve the details of a Report Type. (Requires a live-mode API key.)
   */
  async get(id: string): Promise<ReportType> {
    return this.client.get<ReportType>(`/reporting/report_types/${encodeURIComponent(id)}`);
  }

  /**
   * Return a full list of Report Types.
   */
  async list(options?: ReportTypeListOptions): Promise<StripeList<ReportType>> {
    return this.client.get<StripeList<ReportType>>('/reporting/report_types', options as Record<string, unknown>);
  }
}
