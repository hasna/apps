import type { ConnectorClient } from './client';
import type { ClimateSupplier, ClimateSupplierListOptions, StripeList } from '../types';

/**
 * Stripe Climate Suppliers API
 * https://docs.stripe.com/api/climate/supplier
 */
export class SuppliersApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List all Climate supplier objects.
   */
  async list(options?: ClimateSupplierListOptions): Promise<StripeList<ClimateSupplier>> {
    return this.client.get<StripeList<ClimateSupplier>>(
      '/climate/suppliers',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  /**
   * Retrieve a Climate supplier by ID.
   */
  async get(id: string): Promise<ClimateSupplier> {
    return this.client.get<ClimateSupplier>(`/climate/suppliers/${id}`);
  }
}
