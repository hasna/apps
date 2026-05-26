import type { MercuryClient } from './client';
import type {
  Account,
  AccountListResponse,
  AccountListParams,
  AccountStatement,
  AccountCard,
} from '../types';

/**
 * Mercury Accounts API
 * Manage bank accounts, statements, and cards
 */
export class AccountsApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List all accounts
   */
  async list(params?: AccountListParams): Promise<AccountListResponse> {
    return this.client.get<AccountListResponse>('/accounts', {
      limit: params?.limit,
      offset: params?.offset,
    });
  }

  /**
   * Get a single account by ID
   */
  async get(accountId: string): Promise<Account> {
    return this.client.get<Account>(`/account/${accountId}`);
  }

  /**
   * Get account balance
   */
  async getBalance(accountId: string): Promise<{ availableBalance: number; currentBalance: number }> {
    const account = await this.get(accountId);
    return {
      availableBalance: account.availableBalance,
      currentBalance: account.currentBalance,
    };
  }

  /**
   * List account statements
   */
  async listStatements(accountId: string, params?: { limit?: number; offset?: number }): Promise<{ statements: AccountStatement[]; total: number }> {
    return this.client.get<{ statements: AccountStatement[]; total: number }>(
      `/account/${accountId}/statements`,
      {
        limit: params?.limit,
        offset: params?.offset,
      }
    );
  }

  /**
   * Get a specific statement
   */
  async getStatement(accountId: string, statementId: string): Promise<AccountStatement> {
    return this.client.get<AccountStatement>(`/account/${accountId}/statements/${statementId}`);
  }

  /**
   * List cards associated with an account
   * GET /account/{accountId}/cards
   */
  async listCards(accountId: string): Promise<{ cards: AccountCard[] }> {
    return this.client.get<{ cards: AccountCard[] }>(`/account/${accountId}/cards`);
  }

  /**
   * Get statement PDF download URL
   */
  async getStatementPdf(statementId: string): Promise<{ url: string }> {
    return this.client.get<{ url: string }>(`/statement/${statementId}/pdf`);
  }
}
