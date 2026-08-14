import type { StampedioClient } from './client';
import type { LoyaltyPointAdjustment, LoyaltyPointAdjustmentInput } from '../types';

/**
 * Loyalty & Rewards API — award or deduct points for a customer.
 */
export class LoyaltyApi {
  constructor(private readonly client: StampedioClient) {}

  /**
   * Adjust loyalty points for a customer.
   * POST /v3/loyalty/shops/{shopId}/customers/{customerId}/adjust-points
   */
  async adjustPoints(input: LoyaltyPointAdjustmentInput): Promise<LoyaltyPointAdjustment> {
    if (!input.customerId) {
      throw new Error('Stamped.io customerId is required to adjust loyalty points');
    }

    return this.client.request<LoyaltyPointAdjustment>(
      this.client.loyaltyPath(`/customers/${encodeURIComponent(input.customerId)}/adjust-points`),
      {
        method: 'POST',
        body: {
          points: input.points,
          reason: input.reason,
        },
      }
    );
  }

  /** Backward-compatible alias for adjustPoints. */
  async createTransaction(input: LoyaltyPointAdjustmentInput): Promise<LoyaltyPointAdjustment> {
    return this.adjustPoints(input);
  }

  /** Award points to a customer (convenience wrapper around adjustPoints). */
  async awardPoints(customerId: string, points: number, reason?: string): Promise<LoyaltyPointAdjustment> {
    return this.adjustPoints({ customerId, points: Math.abs(points), reason });
  }

  /** Deduct points from a customer (convenience wrapper around adjustPoints). */
  async deductPoints(customerId: string, points: number, reason?: string): Promise<LoyaltyPointAdjustment> {
    return this.adjustPoints({ customerId, points: -Math.abs(points), reason });
  }
}
