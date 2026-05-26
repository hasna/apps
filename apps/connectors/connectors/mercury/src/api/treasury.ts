import type { MercuryClient } from './client';
import type {
  TreasuryAccount,
  TreasuryTransaction,
  TreasuryListResponse,
} from '../types';

/**
 * Mercury Treasury API
 * Manage treasury accounts for higher yield savings
 */
export class TreasuryApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List treasury accounts
   */
  async list(params?: { limit?: number; offset?: number }): Promise<TreasuryListResponse> {
    return this.client.get<TreasuryListResponse>('/treasury', {
      limit: params?.limit,
      offset: params?.offset,
    });
  }

  /**
   * Get a single treasury account
   */
  async get(treasuryAccountId: string): Promise<TreasuryAccount> {
    return this.client.get<TreasuryAccount>(`/treasury/${treasuryAccountId}`);
  }

  /**
   * Get treasury account balance
   */
  async getBalance(treasuryAccountId: string): Promise<{ currentBalance: number; apy: number }> {
    const account = await this.get(treasuryAccountId);
    return {
      currentBalance: account.currentBalance,
      apy: account.apy,
    };
  }

  /**
   * List transactions for a treasury account
   */
  async listTransactions(
    treasuryAccountId: string,
    params?: { limit?: number; offset?: number; start?: string; end?: string }
  ): Promise<{ transactions: TreasuryTransaction[]; total: number }> {
    return this.client.get<{ transactions: TreasuryTransaction[]; total: number }>(
      `/treasury/${treasuryAccountId}/transactions`,
      {
        limit: params?.limit,
        offset: params?.offset,
        start: params?.start,
        end: params?.end,
      }
    );
  }

  /**
   * Deposit funds into treasury account
   */
  async deposit(treasuryAccountId: string, params: {
    fromAccountId: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<TreasuryTransaction> {
    return this.client.post<TreasuryTransaction>(`/treasury/${treasuryAccountId}/deposit`, params);
  }

  /**
   * Withdraw funds from treasury account
   */
  async withdraw(treasuryAccountId: string, params: {
    toAccountId: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<TreasuryTransaction> {
    return this.client.post<TreasuryTransaction>(`/treasury/${treasuryAccountId}/withdraw`, params);
  }
}
