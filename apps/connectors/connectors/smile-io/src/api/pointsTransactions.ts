import type { SmileClient } from './client';
import type {
  CreatePointsTransactionInput,
  ListPointsTransactionsOptions,
  ListPointsTransactionsResponse,
  PointsTransaction,
  PointsTransactionResponse,
} from '../types';

/**
 * Points Transactions API — award or deduct points.
 * Endpoints: GET /points_transactions, GET /points_transactions/{id},
 *            POST /points_transactions
 */
export class PointsTransactionsApi {
  constructor(private readonly client: SmileClient) {}

  /** List points transactions, optionally filtered by customer. */
  async list(options: ListPointsTransactionsOptions = {}): Promise<ListPointsTransactionsResponse> {
    return this.client.request<ListPointsTransactionsResponse>('/points_transactions', {
      params: {
        customer_id: options.customer_id,
        updated_at_min: options.updated_at_min,
        limit: options.limit,
        cursor: options.cursor,
      },
    });
  }

  /** Retrieve a single points transaction by ID. */
  async get(id: number): Promise<PointsTransaction> {
    const response = await this.client.request<PointsTransactionResponse>(
      `/points_transactions/${id}`,
    );
    return response.points_transaction;
  }

  /**
   * Create a points transaction. Use a positive `points_change` to add points
   * and a negative value to subtract. Requests that would drive the balance
   * negative are rejected by the API.
   */
  async create(input: CreatePointsTransactionInput): Promise<PointsTransaction> {
    const response = await this.client.request<PointsTransactionResponse>('/points_transactions', {
      method: 'POST',
      body: { ...input },
    });
    return response.points_transaction;
  }
}
