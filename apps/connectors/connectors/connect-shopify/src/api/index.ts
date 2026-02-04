import type { ShopifyConfig } from '../types';
import { ShopifyClient } from './client';
import { ProductsApi } from './products';
import { OrdersApi } from './orders';
import { CustomersApi } from './customers';
import { InventoryApi } from './inventory';
import { CollectionsApi } from './collections';
import { ShopApi } from './shop';

/**
 * Main Shopify Connector class
 * Provides access to Products, Orders, Customers, Inventory, Collections, and Shop APIs
 */
export class Shopify {
  private readonly client: ShopifyClient;

  // Service APIs
  public readonly products: ProductsApi;
  public readonly orders: OrdersApi;
  public readonly customers: CustomersApi;
  public readonly inventory: InventoryApi;
  public readonly collections: CollectionsApi;
  public readonly shop: ShopApi;

  constructor(config: ShopifyConfig) {
    this.client = new ShopifyClient(config);
    this.products = new ProductsApi(this.client);
    this.orders = new OrdersApi(this.client);
    this.customers = new CustomersApi(this.client);
    this.inventory = new InventoryApi(this.client);
    this.collections = new CollectionsApi(this.client);
    this.shop = new ShopApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN, and optionally SHOPIFY_API_VERSION
   */
  static fromEnv(): Shopify {
    const store = process.env.SHOPIFY_STORE;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    const apiVersion = process.env.SHOPIFY_API_VERSION;

    if (!store) {
      throw new Error('SHOPIFY_STORE environment variable is required');
    }
    if (!accessToken) {
      throw new Error('SHOPIFY_ACCESS_TOKEN environment variable is required');
    }

    return new Shopify({ store, accessToken, apiVersion });
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get store name
   */
  getStore(): string {
    return this.client.getStore();
  }

  /**
   * Get API version
   */
  getApiVersion(): string {
    return this.client.getApiVersion();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ShopifyClient {
    return this.client;
  }
}

export { ShopifyClient } from './client';
export { ProductsApi } from './products';
export { OrdersApi } from './orders';
export { CustomersApi } from './customers';
export { InventoryApi } from './inventory';
export { CollectionsApi } from './collections';
export { ShopApi } from './shop';
