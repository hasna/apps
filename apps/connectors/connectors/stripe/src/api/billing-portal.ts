import type { ConnectorClient } from './client';
import type {
  BillingPortalSession,
  BillingPortalSessionCreateParams,
  BillingPortalConfiguration,
  BillingPortalConfigurationCreateParams,
  BillingPortalConfigurationUpdateParams,
  BillingPortalConfigurationListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Billing Portal API
 * https://stripe.com/docs/api/customer_portal
 *
 * Creates portal sessions for customers to manage their subscriptions and billing.
 */
export class BillingPortalApi {
  constructor(private readonly client: ConnectorClient) {}

  // ============================================
  // Portal Sessions
  // ============================================

  /**
   * Create a billing portal session
   * Returns a session with a URL that customers can visit to manage billing
   */
  async createSession(params: BillingPortalSessionCreateParams): Promise<BillingPortalSession> {
    return this.client.post<BillingPortalSession>('/billing_portal/sessions', params);
  }

  // ============================================
  // Portal Configurations
  // ============================================

  /**
   * Create a billing portal configuration
   */
  async createConfiguration(params: BillingPortalConfigurationCreateParams): Promise<BillingPortalConfiguration> {
    return this.client.post<BillingPortalConfiguration>('/billing_portal/configurations', params);
  }

  /**
   * Retrieve a billing portal configuration
   */
  async getConfiguration(id: string): Promise<BillingPortalConfiguration> {
    return this.client.get<BillingPortalConfiguration>(`/billing_portal/configurations/${id}`);
  }

  /**
   * Update a billing portal configuration
   */
  async updateConfiguration(id: string, params: BillingPortalConfigurationUpdateParams): Promise<BillingPortalConfiguration> {
    return this.client.post<BillingPortalConfiguration>(`/billing_portal/configurations/${id}`, params);
  }

  /**
   * List all billing portal configurations
   */
  async listConfigurations(options?: BillingPortalConfigurationListOptions): Promise<StripeList<BillingPortalConfiguration>> {
    return this.client.get<StripeList<BillingPortalConfiguration>>('/billing_portal/configurations', options as Record<string, string | number | boolean | undefined>);
  }
}
