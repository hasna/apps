import type { WixConfig } from '../types';
import { WixClient } from './client';
import { SitesApi } from './sites';
import { ContactsApi } from './contacts';
import { MembersApi } from './members';
import { ProductsApi } from './products';
import { OrdersApi } from './orders';
import { InventoryApi } from './inventory';
import { BookingsApi } from './bookings';

/**
 * Main Wix Connector class
 * Provides access to Sites, Contacts, Members, Products, Orders, Inventory, and Bookings APIs
 */
export class Wix {
  private readonly client: WixClient;

  // Service APIs
  public readonly sites: SitesApi;
  public readonly contacts: ContactsApi;
  public readonly members: MembersApi;
  public readonly products: ProductsApi;
  public readonly orders: OrdersApi;
  public readonly inventory: InventoryApi;
  public readonly bookings: BookingsApi;

  constructor(config: WixConfig) {
    this.client = new WixClient(config);
    this.sites = new SitesApi(this.client);
    this.contacts = new ContactsApi(this.client);
    this.members = new MembersApi(this.client);
    this.products = new ProductsApi(this.client);
    this.orders = new OrdersApi(this.client);
    this.inventory = new InventoryApi(this.client);
    this.bookings = new BookingsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for WIX_API_KEY, WIX_SITE_ID, and WIX_ACCOUNT_ID
   */
  static fromEnv(): Wix {
    const apiKey = process.env.WIX_API_KEY;
    const siteId = process.env.WIX_SITE_ID;
    const accountId = process.env.WIX_ACCOUNT_ID;

    if (!apiKey) {
      throw new Error('WIX_API_KEY environment variable is required');
    }

    return new Wix({ apiKey, siteId, accountId });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get site ID
   */
  getSiteId(): string | undefined {
    return this.client.getSiteId();
  }

  /**
   * Get account ID
   */
  getAccountId(): string | undefined {
    return this.client.getAccountId();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): WixClient {
    return this.client;
  }
}

export { WixClient } from './client';
export { SitesApi } from './sites';
export { ContactsApi } from './contacts';
export { MembersApi } from './members';
export { ProductsApi } from './products';
export { OrdersApi } from './orders';
export { InventoryApi } from './inventory';
export { BookingsApi } from './bookings';
