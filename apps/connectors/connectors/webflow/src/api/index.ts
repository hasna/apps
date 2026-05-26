import type { WebflowConfig } from '../types';
import { WebflowClient } from './client';
import { SitesApi } from './sites';
import { CollectionsApi } from './collections';
import { ItemsApi } from './items';
import { PagesApi } from './pages';
import { AssetsApi } from './assets';
import { FormsApi } from './forms';
import { UsersApi } from './users';
import { ProductsApi } from './products';
import { OrdersApi } from './orders';

/**
 * Main Webflow Connector class
 * Provides access to Sites, Collections, Items, Pages, Assets, Forms, Users, Products, and Orders APIs
 */
export class Webflow {
  private readonly client: WebflowClient;
  private readonly defaultSiteId?: string;

  // Service APIs
  public readonly sites: SitesApi;
  public readonly collections: CollectionsApi;
  public readonly items: ItemsApi;
  public readonly pages: PagesApi;
  public readonly assets: AssetsApi;
  public readonly forms: FormsApi;
  public readonly users: UsersApi;
  public readonly products: ProductsApi;
  public readonly orders: OrdersApi;

  constructor(config: WebflowConfig) {
    this.client = new WebflowClient(config);
    this.defaultSiteId = config.siteId;

    this.sites = new SitesApi(this.client);
    this.collections = new CollectionsApi(this.client);
    this.items = new ItemsApi(this.client);
    this.pages = new PagesApi(this.client);
    this.assets = new AssetsApi(this.client);
    this.forms = new FormsApi(this.client);
    this.users = new UsersApi(this.client);
    this.products = new ProductsApi(this.client);
    this.orders = new OrdersApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for WEBFLOW_ACCESS_TOKEN and optionally WEBFLOW_SITE_ID
   */
  static fromEnv(): Webflow {
    const accessToken = process.env.WEBFLOW_ACCESS_TOKEN;
    const siteId = process.env.WEBFLOW_SITE_ID;

    if (!accessToken) {
      throw new Error('WEBFLOW_ACCESS_TOKEN environment variable is required');
    }

    return new Webflow({ accessToken, siteId });
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the default site ID
   */
  getDefaultSiteId(): string | undefined {
    return this.defaultSiteId;
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): WebflowClient {
    return this.client;
  }
}

export { WebflowClient } from './client';
export { SitesApi } from './sites';
export { CollectionsApi } from './collections';
export { ItemsApi } from './items';
export { PagesApi } from './pages';
export { AssetsApi } from './assets';
export { FormsApi } from './forms';
export { UsersApi } from './users';
export { ProductsApi } from './products';
export { OrdersApi } from './orders';
