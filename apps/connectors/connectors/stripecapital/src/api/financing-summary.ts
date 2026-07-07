import type { ConnectorClient } from './client';
import type { FinancingSummary } from '../types';

/**
 * Stripe Capital Financing Summary API
 * https://docs.stripe.com/api/capital/financing_summary
 */
export class FinancingSummaryApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Retrieve the financing summary for the connected account.
   */
  async retrieve(): Promise<FinancingSummary> {
    return this.client.get<FinancingSummary>('/capital/financing_summary');
  }
}
