import type { RevolutAccount, RevolutAccountBalance } from '../types';
import type { RevolutClient } from './client';

/**
 * Revolut Accounts API
 */
export class AccountsApi {
  constructor(private readonly client: RevolutClient) {}

  /**
   * List all accounts
   */
  async listAccounts(): Promise<RevolutAccount[]> {
    return this.client.request<RevolutAccount[]>('/accounts');
  }

  /**
   * Get account by ID
   */
  async getAccount(accountId: string): Promise<RevolutAccount> {
    return this.client.request<RevolutAccount>(`/accounts/${accountId}`);
  }

  /**
   * Get account balance
   * Note: Balance is included in account details, this is a convenience method
   */
  async getBalance(accountId: string): Promise<RevolutAccountBalance> {
    const account = await this.getAccount(accountId);
    return {
      currency: account.currency,
      amount: account.balance,
    };
  }

  /**
   * Get all balances across all accounts
   */
  async getAllBalances(): Promise<RevolutAccountBalance[]> {
    const accounts = await this.listAccounts();
    return accounts.map(account => ({
      currency: account.currency,
      amount: account.balance,
    }));
  }
}
