import type { ConnectorClient } from './client';
import type {
  CreateTaxCalculationParams,
  ListOptions,
  StripeList,
  TaxCalculation,
  TaxCalculationLineItemResult,
} from '../types';

/**
 * Stripe Tax Calculations API
 * https://docs.stripe.com/api/tax/calculations
 */
export class CalculationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: CreateTaxCalculationParams): Promise<TaxCalculation> {
    return this.client.post<TaxCalculation>('/tax/calculations', params as unknown as Record<string, unknown>);
  }

  async get(id: string, expand?: string[]): Promise<TaxCalculation> {
    const params: Record<string, string> = {};
    if (expand?.length) {
      params.expand = expand.join(',');
    }
    return this.client.get<TaxCalculation>(`/tax/calculations/${id}`, params);
  }

  async listLineItems(
    id: string,
    options?: ListOptions
  ): Promise<StripeList<TaxCalculationLineItemResult>> {
    return this.client.get<StripeList<TaxCalculationLineItemResult>>(
      `/tax/calculations/${id}/line_items`,
      options as Record<string, string | number | boolean | undefined>
    );
  }
}
