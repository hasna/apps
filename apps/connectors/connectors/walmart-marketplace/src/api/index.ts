import type { WalmartMarketplaceConfig } from '../types';
import { WalmartMarketplaceClient } from './client';
import { ItemsApi } from './items';
import { InventoryApi } from './inventory';
import { OrdersApi } from './orders';

export class WalmartMarketplace {
  private readonly client: WalmartMarketplaceClient;

  public readonly items: ItemsApi;
  public readonly inventory: InventoryApi;
  public readonly orders: OrdersApi;

  constructor(config: WalmartMarketplaceConfig) {
    this.client = new WalmartMarketplaceClient(config);
    this.items = new ItemsApi(this.client);
    this.inventory = new InventoryApi(this.client);
    this.orders = new OrdersApi(this.client);
  }

  static fromEnv(): WalmartMarketplace {
    const accessToken = process.env.WALMART_ACCESS_TOKEN;
    const serviceName = process.env.WALMART_SERVICE_NAME;
    const baseUrl = process.env.WALMART_BASE_URL;
    const correlationId = process.env.WALMART_CORRELATION_ID;

    if (!accessToken) {
      throw new Error('WALMART_ACCESS_TOKEN environment variable is required');
    }
    if (!serviceName) {
      throw new Error('WALMART_SERVICE_NAME environment variable is required');
    }

    return new WalmartMarketplace({ accessToken, serviceName, baseUrl, correlationId });
  }

  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  getServiceName(): string {
    return this.client.getServiceName();
  }

  getClient(): WalmartMarketplaceClient {
    return this.client;
  }
}

export { WalmartMarketplaceClient, DEFAULT_BASE_URL } from './client';
export { ItemsApi } from './items';
export { InventoryApi } from './inventory';
export { OrdersApi } from './orders';
