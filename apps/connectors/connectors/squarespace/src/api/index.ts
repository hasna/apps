import type { SquarespaceConfig } from '../types';
import { SquarespaceClient } from './client';
import { InventoryApi } from './inventory';
import { OrdersApi } from './orders';
import { ProductsApi } from './products';
import { TransactionsApi } from './transactions';
import { ProfilesApi } from './profiles';
import { StorePagesApi } from './store-pages';
import { WebhooksApi } from './webhooks';

export class Squarespace {
  private readonly client: SquarespaceClient;

  public readonly inventory: InventoryApi;
  public readonly orders: OrdersApi;
  public readonly products: ProductsApi;
  public readonly transactions: TransactionsApi;
  public readonly profiles: ProfilesApi;
  public readonly storePages: StorePagesApi;
  public readonly webhooks: WebhooksApi;

  constructor(config: SquarespaceConfig) {
    this.client = new SquarespaceClient(config);
    this.inventory = new InventoryApi(this.client);
    this.orders = new OrdersApi(this.client);
    this.products = new ProductsApi(this.client);
    this.transactions = new TransactionsApi(this.client);
    this.profiles = new ProfilesApi(this.client);
    this.storePages = new StorePagesApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
  }

  static fromEnv(): Squarespace {
    const apiKey = process.env.SQUARESPACE_API_KEY;
    if (!apiKey) {
      throw new Error('SQUARESPACE_API_KEY environment variable is required');
    }
    return new Squarespace({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): SquarespaceClient {
    return this.client;
  }
}

export { SquarespaceClient } from './client';
export { InventoryApi } from './inventory';
export { OrdersApi } from './orders';
export { ProductsApi } from './products';
export { TransactionsApi } from './transactions';
export { ProfilesApi } from './profiles';
export { StorePagesApi } from './store-pages';
export { WebhooksApi } from './webhooks';
