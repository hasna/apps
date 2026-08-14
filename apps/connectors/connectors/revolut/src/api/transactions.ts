import type { RevolutTransaction, TransactionListParams } from '../types';
import type { RevolutClient } from './client';

/**
 * Revolut Transactions API
 */
export class TransactionsApi {
  constructor(private readonly client: RevolutClient) {}

  /**
   * List transactions
   */
  async listTransactions(params: TransactionListParams = {}): Promise<RevolutTransaction[]> {
    return this.client.request<RevolutTransaction[]>('/transactions', {
      params: params as Record<string, string | number | boolean | undefined>,
    });
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(transactionId: string): Promise<RevolutTransaction> {
    return this.client.request<RevolutTransaction>(`/transaction/${transactionId}`);
  }

  /**
   * Get transaction by request ID (idempotency key)
   */
  async getTransactionByRequestId(requestId: string): Promise<RevolutTransaction> {
    return this.client.request<RevolutTransaction>(`/transaction/${requestId}`, {
      params: { id_type: 'request_id' },
    });
  }

  /**
   * List transactions for a specific account
   */
  async listAccountTransactions(
    accountId: string,
    params: Omit<TransactionListParams, 'counterparty'> = {}
  ): Promise<RevolutTransaction[]> {
    const transactions = await this.listTransactions(params);
    return transactions.filter(tx =>
      tx.legs.some(leg => leg.account_id === accountId)
    );
  }

  /**
   * List transactions within a date range
   */
  async listTransactionsByDateRange(
    from: string,
    to: string,
    params: Omit<TransactionListParams, 'from' | 'to'> = {}
  ): Promise<RevolutTransaction[]> {
    return this.listTransactions({
      ...params,
      from,
      to,
    });
  }
}
