import type { MercuryClient } from './client';
import type {
  Transaction,
  TransactionListResponse,
  TransactionListParams,
  TransactionAttachment,
} from '../types';

/**
 * Mercury Transactions API
 * View and manage transactions
 */
export class TransactionsApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List all transactions across all accounts
   */
  async listAll(params?: TransactionListParams): Promise<TransactionListResponse> {
    return this.client.get<TransactionListResponse>('/transactions', {
      limit: params?.limit,
      offset: params?.offset,
      status: params?.status,
      start: params?.start,
      end: params?.end,
      search: params?.search,
    });
  }

  /**
   * Get a transaction by ID (global, across all accounts)
   */
  async getById(transactionId: string): Promise<Transaction> {
    return this.client.get<Transaction>(`/transaction/${transactionId}`);
  }

  /**
   * List transactions for a specific account
   */
  async list(accountId: string, params?: TransactionListParams): Promise<TransactionListResponse> {
    return this.client.get<TransactionListResponse>(`/account/${accountId}/transactions`, {
      limit: params?.limit,
      offset: params?.offset,
      status: params?.status,
      start: params?.start,
      end: params?.end,
      search: params?.search,
    });
  }

  /**
   * Get a single transaction for a specific account
   */
  async get(accountId: string, transactionId: string): Promise<Transaction> {
    return this.client.get<Transaction>(`/account/${accountId}/transactions/${transactionId}`);
  }

  /**
   * Create a transaction (send money)
   * Note: May require approval depending on token permissions
   */
  async create(accountId: string, params: {
    recipientId: string;
    amount: number;
    note?: string;
    idempotencyKey?: string;
  }): Promise<Transaction> {
    return this.client.post<Transaction>(`/account/${accountId}/transactions`, params);
  }

  /**
   * Add a note to a transaction (account-specific)
   */
  async addNote(accountId: string, transactionId: string, note: string): Promise<Transaction> {
    return this.client.patch<Transaction>(`/account/${accountId}/transactions/${transactionId}`, {
      note,
    });
  }

  /**
   * Update transaction metadata (global endpoint)
   * @param transactionId - The transaction ID
   * @param params - Fields to update: note, categoryId
   */
  async updateMetadata(transactionId: string, params: { note?: string; categoryId?: string }): Promise<Transaction> {
    return this.client.patch<Transaction>(`/transaction/${transactionId}`, params);
  }

  /**
   * Upload an attachment to a transaction (global endpoint)
   */
  async uploadAttachmentGlobal(
    transactionId: string,
    file: { fileName: string; fileType: string; content: string }
  ): Promise<TransactionAttachment> {
    return this.client.post<TransactionAttachment>(`/transaction/${transactionId}/attachment`, file);
  }

  /**
   * List attachments for a transaction
   */
  async listAttachments(accountId: string, transactionId: string): Promise<{ attachments: TransactionAttachment[] }> {
    return this.client.get<{ attachments: TransactionAttachment[] }>(
      `/account/${accountId}/transactions/${transactionId}/attachments`
    );
  }

  /**
   * Upload an attachment to a transaction
   */
  async uploadAttachment(
    accountId: string,
    transactionId: string,
    file: { fileName: string; fileType: string; content: string }
  ): Promise<TransactionAttachment> {
    return this.client.post<TransactionAttachment>(
      `/account/${accountId}/transactions/${transactionId}/attachments`,
      file
    );
  }

  /**
   * Delete an attachment from a transaction
   */
  async deleteAttachment(accountId: string, transactionId: string, attachmentId: string): Promise<void> {
    await this.client.delete(`/account/${accountId}/transactions/${transactionId}/attachments/${attachmentId}`);
  }
}
