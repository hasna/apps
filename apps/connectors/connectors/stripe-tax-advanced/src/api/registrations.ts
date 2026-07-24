import type { ConnectorClient } from './client';
import type {
  CreateTaxRegistrationParams,
  ListOptions,
  StripeList,
  TaxRegistration,
  UpdateTaxRegistrationParams,
} from '../types';

/**
 * Stripe Tax Registrations API
 * https://docs.stripe.com/api/tax/registrations
 */
export class RegistrationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: CreateTaxRegistrationParams): Promise<TaxRegistration> {
    return this.client.post<TaxRegistration>('/tax/registrations', params as unknown as Record<string, unknown>);
  }

  async list(options?: ListOptions & { status?: string }): Promise<StripeList<TaxRegistration>> {
    return this.client.get<StripeList<TaxRegistration>>(
      '/tax/registrations',
      options as Record<string, string | number | boolean | undefined>
    );
  }

  async get(id: string): Promise<TaxRegistration> {
    return this.client.get<TaxRegistration>(`/tax/registrations/${id}`);
  }

  async update(id: string, params: UpdateTaxRegistrationParams): Promise<TaxRegistration> {
    return this.client.patch<TaxRegistration>(
      `/tax/registrations/${id}`,
      params as unknown as Record<string, unknown>
    );
  }
}
