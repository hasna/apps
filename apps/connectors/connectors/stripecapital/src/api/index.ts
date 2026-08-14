import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { FinancingOffersApi } from './financing-offers';
import { FinancingSummaryApi } from './financing-summary';

/**
 * Stripe Capital API Connector class.
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules
  public readonly financingOffers: FinancingOffersApi;
  public readonly financingSummary: FinancingSummaryApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.financingOffers = new FinancingOffersApi(this.client);
    this.financingSummary = new FinancingSummaryApi(this.client);
  }

  /**
   * Create a client from an API key directly.
   */
  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  /**
   * Create a client from environment variables.
   * Looks for STRIPE_CAPITAL_API_KEY and optionally STRIPE_CAPITAL_ACCOUNT_ID.
   */
  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_CAPITAL_API_KEY;
    const accountId = process.env.STRIPE_CAPITAL_ACCOUNT_ID;

    if (!apiKey) {
      throw new Error('STRIPE_CAPITAL_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, accountId });
  }

  /**
   * Get a preview of the API key (for debugging).
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access.
   */
  getClient(): ConnectorClient {
    return this.client;
  }
}

// Export client and all API classes
export { ConnectorClient } from './client';
export { FinancingOffersApi } from './financing-offers';
export { FinancingSummaryApi } from './financing-summary';
