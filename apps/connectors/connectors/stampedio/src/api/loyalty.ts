import type { StampedioClient } from './client';
import type { LoyaltyTransaction, LoyaltyTransactionInput } from '../types';

/**
 * Loyalty & Rewards API — award or deduct points for a customer.
 */
export class LoyaltyApi {
  constructor(private readonly client: StampedioClient) {}

  /**
   * Create a loyalty transaction (award/deduct points).
   * POST /v2/{storeHash}/loyalty/transactions
   */
  async createTransaction(input: LoyaltyTransactionInput): Promise<LoyaltyTransaction> {
    return this.client.request<LoyaltyTransaction>(this.client.storePath('/loyalty/transactions'), {
      method: 'POST',
      body: {
        email: input.email,
        points: input.points,
        reason: input.reason,
        reference: input.reference,
      },
    });
  }

  /** Award points to a customer (convenience wrapper around createTransaction). */
  async awardPoints(email: string, points: number, reason?: string): Promise<LoyaltyTransaction> {
    return this.createTransaction({ email, points: Math.abs(points), reason });
  }

  /** Deduct points from a customer (convenience wrapper around createTransaction). */
  async deductPoints(email: string, points: number, reason?: string): Promise<LoyaltyTransaction> {
    return this.createTransaction({ email, points: -Math.abs(points), reason });
  }
}
