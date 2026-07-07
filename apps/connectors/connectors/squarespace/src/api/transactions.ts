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

export interface TransactionsGetResponse {
  documents: Transaction[];
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

  async get(documentIds: string | string[]): Promise<TransactionsGetResponse> {
    const ids = (Array.isArray(documentIds) ? documentIds : [documentIds]).map(encodeURIComponent).join(',');
    return this.client.request<TransactionsGetResponse>(`/commerce/transactions/${ids}`);
  }
}
