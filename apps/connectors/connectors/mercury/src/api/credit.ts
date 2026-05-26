import type { MercuryClient } from './client';

export interface CreditAccount {
  id: string;
  status: 'active' | 'deleted' | 'pending' | 'archived';
  createdAt: string;
  availableBalance: number;
  currentBalance: number;
}

export interface CreditListResponse {
  accounts: CreditAccount[];
}

/**
 * Mercury Credit API
 * View credit accounts and credit lines
 */
export class CreditApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List all credit accounts
   */
  async list(params?: { limit?: number; offset?: number }): Promise<CreditListResponse> {
    return this.client.get<CreditListResponse>('/credit', {
      limit: params?.limit,
      offset: params?.offset,
    });
  }

  /**
   * Get a credit account by ID
   */
  async get(creditAccountId: string): Promise<CreditAccount> {
    return this.client.get<CreditAccount>(`/credit/${creditAccountId}`);
  }
}
