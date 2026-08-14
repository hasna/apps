import type { RevolutCounterparty, CreateCounterpartyRequest } from '../types';
import type { RevolutClient } from './client';

/**
 * Revolut Counterparties API
 */
export class CounterpartiesApi {
  constructor(private readonly client: RevolutClient) {}

  /**
   * List all counterparties
   */
  async listCounterparties(): Promise<RevolutCounterparty[]> {
    return this.client.request<RevolutCounterparty[]>('/counterparties');
  }

  /**
   * Get counterparty by ID
   */
  async getCounterparty(counterpartyId: string): Promise<RevolutCounterparty> {
    return this.client.request<RevolutCounterparty>(`/counterparty/${counterpartyId}`);
  }

  /**
   * Create a new counterparty
   */
  async createCounterparty(data: CreateCounterpartyRequest): Promise<RevolutCounterparty> {
    return this.client.request<RevolutCounterparty>('/counterparty', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Delete a counterparty
   */
  async deleteCounterparty(counterpartyId: string): Promise<void> {
    await this.client.request<void>(`/counterparty/${counterpartyId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Validate account name (Confirmation of Payee / Verification of Payee)
   * This validates a counterparty's account name against their account details.
   * @see https://developer.revolut.com/docs/business/validate-account-name
   */
  async validateAccountName(params: {
    account_no?: string;
    sort_code?: string;
    iban?: string;
    recipient_name: string;
  }): Promise<{
    result: 'match' | 'close_match' | 'no_match' | 'not_available';
    actual_name?: string;
    reason_code?: string;
    reason?: string;
  }> {
    return this.client.request('/account-name-validation', {
      method: 'POST',
      body: params,
    });
  }
}
