import type { ConnectorClient } from './client';
import type {
  Charge,
  ChargeCreateParams,
  ChargeUpdateParams,
  ChargeCaptureParams,
  ChargeListOptions,
  StripeList,
  StripeSearchResult,
} from '../types';

/**
 * Stripe Charges API
 * https://stripe.com/docs/api/charges
 */
export class ChargesApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a charge
   */
  async create(params: ChargeCreateParams): Promise<Charge> {
    return this.client.post<Charge>('/charges', params);
  }

  /**
   * Retrieve a charge by ID
   */
  async get(id: string): Promise<Charge> {
    return this.client.get<Charge>(`/charges/${id}`);
  }

  /**
   * Update a charge
   */
  async update(id: string, params: ChargeUpdateParams): Promise<Charge> {
    return this.client.post<Charge>(`/charges/${id}`, params);
  }

  /**
   * List all charges
   */
  async list(options?: ChargeListOptions): Promise<StripeList<Charge>> {
    return this.client.get<StripeList<Charge>>('/charges', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Capture a charge (for uncaptured charges)
   */
  async capture(id: string, params?: ChargeCaptureParams): Promise<Charge> {
    return this.client.post<Charge>(`/charges/${id}/capture`, params || {});
  }

  /**
   * Search charges
   * Query syntax: https://stripe.com/docs/search#query-fields-for-charges
   */
  async search(query: string, options?: { limit?: number; page?: string }): Promise<StripeSearchResult<Charge>> {
    return this.client.get<StripeSearchResult<Charge>>('/charges/search', {
      query,
      limit: options?.limit,
      page: options?.page,
    });
  }
}
