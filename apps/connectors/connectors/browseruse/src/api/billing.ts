import type { BrowserUseClient } from './client';
import type { AccountBilling } from '../types';

/**
 * Billing API
 */
export class BillingApi {
  constructor(private client: BrowserUseClient) {}

  /**
   * Get account billing information
   */
  async getAccount(): Promise<AccountBilling> {
    return this.client.get<AccountBilling>('/v2/billing');
  }

  /**
   * Get current credit balance
   */
  async getCredits(): Promise<number> {
    const account = await this.getAccount();
    return account.credits;
  }

  /**
   * Get current plan
   */
  async getPlan(): Promise<string> {
    const account = await this.getAccount();
    return account.plan;
  }
}
