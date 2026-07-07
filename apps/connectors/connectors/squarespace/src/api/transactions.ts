import type { SquarespaceClient } from './client';
import type { Transaction } from '../types';

export interface ListTransactionsOptions {
  cursor?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface TransactionsListResponse {
  documents: Transaction[];
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export class TransactionsApi {
  constructor(private readonly client: SquarespaceClient) {}

  async list(options: ListTransactionsOptions = {}): Promise<TransactionsListResponse> {
    return this.client.request<TransactionsListResponse>('/commerce/transactions', {
      params: {
        cursor: options.cursor,
        modifiedAfter: options.modifiedAfter,
        modifiedBefore: options.modifiedBefore,
      },
    });
  }

  async get(id: string): Promise<Transaction> {
    return this.client.request<Transaction>(`/commerce/transactions/${encodeURIComponent(id)}`);
  }
}
