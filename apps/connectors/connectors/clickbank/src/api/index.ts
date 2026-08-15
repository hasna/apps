import type { ClickBankConfig } from '../types';
import { ClickBankClient } from './client';
import { OrdersApi } from './orders';
import { ProductsApi } from './products';
import { TicketsApi } from './tickets';
import { ShippingApi } from './shipping';
import { QuickstatsApi } from './quickstats';
import { AnalyticsApi } from './analytics';
import { ImagesApi } from './images';

export class ClickBank {
  private readonly client: ClickBankClient;

  public readonly orders: OrdersApi;
  public readonly products: ProductsApi;
  public readonly tickets: TicketsApi;
  public readonly shipping: ShippingApi;
  public readonly quickstats: QuickstatsApi;
  public readonly analytics: AnalyticsApi;
  public readonly images: ImagesApi;

  constructor(config: ClickBankConfig) {
    this.client = new ClickBankClient(config);

    this.orders = new OrdersApi(this.client);
    this.products = new ProductsApi(this.client);
    this.tickets = new TicketsApi(this.client);
    this.shipping = new ShippingApi(this.client);
    this.quickstats = new QuickstatsApi(this.client);
    this.analytics = new AnalyticsApi(this.client);
    this.images = new ImagesApi(this.client);
  }

  /**
   * Create a ClickBank client from environment variables
   * Looks for CLICKBANK_API_KEY
   */
  static fromEnv(): ClickBank {
    const apiKey = process.env.CLICKBANK_API_KEY;
    if (!apiKey) {
      throw new Error('CLICKBANK_API_KEY environment variable is required');
    }
    return new ClickBank({ apiKey });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { ClickBankClient } from './client';
export { OrdersApi } from './orders';
export { ProductsApi } from './products';
export { TicketsApi } from './tickets';
export { ShippingApi } from './shipping';
export { QuickstatsApi } from './quickstats';
export { AnalyticsApi } from './analytics';
export { ImagesApi } from './images';
