import type { ConnectorClient } from './client';
import type {
  VerificationReport,
  VerificationReportListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Identity VerificationReports API
 * https://stripe.com/docs/api/identity/verification_reports
 */
export class VerificationReportsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Retrieve a VerificationReport by ID.
   */
  async get(id: string): Promise<VerificationReport> {
    return this.client.get<VerificationReport>(`/identity/verification_reports/${id}`);
  }

  /**
   * List all VerificationReports.
   */
  async list(options?: VerificationReportListOptions): Promise<StripeList<VerificationReport>> {
    return this.client.get<StripeList<VerificationReport>>(
      '/identity/verification_reports',
      options as Record<string, string | number | boolean | undefined>,
    );
  }
}
