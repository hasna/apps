import type { ConnectorClient } from './client';
import type {
  Coupon,
  CouponCreateParams,
  CouponUpdateParams,
  CouponListOptions,
  StripeList,
  DeletedObject,
} from '../types';

/**
 * Stripe Coupons API
 * https://stripe.com/docs/api/coupons
 */
export class CouponsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a coupon
   */
  async create(params: CouponCreateParams): Promise<Coupon> {
    return this.client.post<Coupon>('/coupons', params);
  }

  /**
   * Retrieve a coupon by ID
   */
  async get(id: string): Promise<Coupon> {
    return this.client.get<Coupon>(`/coupons/${id}`);
  }

  /**
   * Update a coupon
   */
  async update(id: string, params: CouponUpdateParams): Promise<Coupon> {
    return this.client.post<Coupon>(`/coupons/${id}`, params);
  }

  /**
   * List all coupons
   */
  async list(options?: CouponListOptions): Promise<StripeList<Coupon>> {
    return this.client.get<StripeList<Coupon>>('/coupons', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Delete a coupon
   */
  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/coupons/${id}`);
  }
}
