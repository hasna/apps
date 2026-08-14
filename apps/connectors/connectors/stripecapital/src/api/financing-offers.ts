import type { ConnectorClient } from './client';
import type {
  FinancingOffer,
  FinancingOfferListOptions,
  FinancingOfferMarkDeliveredParams,
  StripeList,
} from '../types';

/**
 * Stripe Capital Financing Offers API
 * https://docs.stripe.com/api/capital/financing_offers
 */
export class FinancingOffersApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List financing offers.
   */
  async list(options?: FinancingOfferListOptions): Promise<StripeList<FinancingOffer>> {
    return this.client.get<StripeList<FinancingOffer>>(
      '/capital/financing_offers',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  /**
   * Retrieve a financing offer by ID.
   */
  async get(id: string): Promise<FinancingOffer> {
    return this.client.get<FinancingOffer>(`/capital/financing_offers/${id}`);
  }

  /**
   * Acknowledge that a financing offer was delivered to the connected account.
   */
  async markDelivered(id: string, params?: FinancingOfferMarkDeliveredParams): Promise<FinancingOffer> {
    return this.client.post<FinancingOffer>(
      `/capital/financing_offers/${id}/mark_delivered`,
      params ?? {},
    );
  }
}
