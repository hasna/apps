import type { ConnectorClient } from './client';
import type {
  PromotionCode,
  PromotionCodeCreateParams,
  PromotionCodeUpdateParams,
  PromotionCodeListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Promotion Codes API
 * https://stripe.com/docs/api/promotion_codes
 */
export class PromotionCodesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a promotion code
   */
  async create(params: PromotionCodeCreateParams): Promise<PromotionCode> {
    return this.client.post<PromotionCode>('/promotion_codes', params);
  }

  /**
   * Retrieve a promotion code by ID
   */
  async get(id: string): Promise<PromotionCode> {
    return this.client.get<PromotionCode>(`/promotion_codes/${id}`);
  }

  /**
   * Update a promotion code
   */
  async update(id: string, params: PromotionCodeUpdateParams): Promise<PromotionCode> {
    return this.client.post<PromotionCode>(`/promotion_codes/${id}`, params);
  }

  /**
   * List all promotion codes
   */
  async list(options?: PromotionCodeListOptions): Promise<StripeList<PromotionCode>> {
    return this.client.get<StripeList<PromotionCode>>('/promotion_codes', options as Record<string, string | number | boolean | undefined>);
  }
}
