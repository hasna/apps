import type { ConnectorClient } from './client';
import type { TaxSettings, UpdateTaxSettingsParams } from '../types';

/**
 * Stripe Tax Settings API
 * https://docs.stripe.com/api/tax/settings
 */
export class SettingsApi {
  constructor(private readonly client: ConnectorClient) {}

  async get(): Promise<TaxSettings> {
    return this.client.get<TaxSettings>('/tax/settings');
  }

  async update(params: UpdateTaxSettingsParams): Promise<TaxSettings> {
    return this.client.patch<TaxSettings>('/tax/settings', params as unknown as Record<string, unknown>);
  }
}
