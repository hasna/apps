import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ProductsApi } from './products';
import { SuppliersApi } from './suppliers';
import { OrdersApi } from './orders';

/**
 * Stripe Climate API Connector class.
 * Wraps the public Stripe Climate API for carbon removal products,
 * suppliers, and orders.
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules
  public readonly products: ProductsApi;
  public readonly suppliers: SuppliersApi;
  public readonly orders: OrdersApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.products = new ProductsApi(this.client);
    this.suppliers = new SuppliersApi(this.client);
    this.orders = new OrdersApi(this.client);
  }

  /**
   * Create a client from an API key directly.
   */
  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  /**
   * Create a client from environment variables.
   * Looks for STRIPE_API_KEY and optionally STRIPE_ACCOUNT_ID / STRIPE_BASE_URL.
   */
  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_API_KEY;

    if (!apiKey) {
      throw new Error('STRIPE_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      accountId: process.env.STRIPE_ACCOUNT_ID,
      baseUrl: process.env.STRIPE_BASE_URL,
    });
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
export { ProductsApi } from './products';
export { SuppliersApi } from './suppliers';
export { OrdersApi } from './orders';
