import type { SmileClient } from './client';
import type {
  ListRewardFulfillmentsOptions,
  ListRewardFulfillmentsResponse,
} from '../types';

/**
 * Reward Fulfillments API — rewards issued to customers.
 * Endpoint: GET /reward_fulfillments
 */
export class RewardFulfillmentsApi {
  constructor(private readonly client: SmileClient) {}

  /** List reward fulfillments with optional filters and cursor pagination. */
  async list(
    options: ListRewardFulfillmentsOptions = {},
  ): Promise<ListRewardFulfillmentsResponse> {
    return this.client.request<ListRewardFulfillmentsResponse>('/reward_fulfillments', {
      params: {
        customer_id: options.customer_id,
        fulfillment_status: options.fulfillment_status,
        usage_status: options.usage_status,
        updated_at_min: options.updated_at_min,
        limit: options.limit,
        cursor: options.cursor,
      },
    });
  }
}
