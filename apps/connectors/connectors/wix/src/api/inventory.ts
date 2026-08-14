import type { WixClient } from './client';
import type { InventoryItem, InventoryVariant, PreorderInfo, UpdateInventoryRequest } from '../types';

export interface ListInventoryOptions {
  limit?: number;
  offset?: number;
}

export interface QueryInventoryOptions extends ListInventoryOptions {
  filter?: Record<string, unknown>;
}

/**
 * Wix Stores Inventory API
 * Endpoint: /stores/v2/inventoryItems
 */
export class InventoryApi {
  constructor(private readonly client: WixClient) {}

  /**
   * List inventory items
   */
  async list(options: ListInventoryOptions = {}): Promise<InventoryItem[]> {
    const response = await this.client.request<{ inventoryItems: Record<string, unknown>[] }>(
      '/stores/v2/inventoryItems/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
          },
        },
      }
    );

    return this.transformInventoryItems(response.inventoryItems || []);
  }

  /**
   * Query inventory with filters
   */
  async query(options: QueryInventoryOptions = {}): Promise<InventoryItem[]> {
    const response = await this.client.request<{ inventoryItems: Record<string, unknown>[] }>(
      '/stores/v2/inventoryItems/query',
      {
        method: 'POST',
        body: {
          query: {
            filter: options.filter,
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
          },
        },
      }
    );

    return this.transformInventoryItems(response.inventoryItems || []);
  }

  /**
   * Get inventory by product ID
   */
  async getByProduct(productId: string): Promise<InventoryItem | null> {
    const response = await this.client.request<{ inventoryItems: Record<string, unknown>[] }>(
      '/stores/v2/inventoryItems/query',
      {
        method: 'POST',
        body: {
          query: {
            filter: { productId: { $eq: productId } },
            paging: { limit: 1, offset: 0 },
          },
        },
      }
    );

    const items = response.inventoryItems || [];
    if (items.length === 0) return null;

    return this.transformInventoryItem(items[0]);
  }

  /**
   * Get a single inventory item by ID
   */
  async get(inventoryId: string): Promise<InventoryItem> {
    const response = await this.client.request<{ inventoryItem: Record<string, unknown> }>(
      `/stores/v2/inventoryItems/${inventoryId}`
    );

    return this.transformInventoryItem(response.inventoryItem);
  }

  /**
   * Update inventory
   */
  async update(inventoryId: string, inventory: UpdateInventoryRequest): Promise<InventoryItem> {
    const body: Record<string, unknown> = {
      inventoryItem: {
        trackQuantity: inventory.trackQuantity,
        variants: inventory.variants?.map(v => ({
          variantId: v.variantId,
          quantity: v.quantity,
          inStock: v.inStock,
        })),
      },
    };

    const response = await this.client.request<{ inventoryItem: Record<string, unknown> }>(
      `/stores/v2/inventoryItems/${inventoryId}`,
      { method: 'PATCH', body }
    );

    return this.transformInventoryItem(response.inventoryItem);
  }

  /**
   * Decrement inventory (reduce stock)
   */
  async decrement(inventoryId: string, decrementData: { variantId: string; quantity: number }[]): Promise<void> {
    await this.client.request<void>(
      `/stores/v2/inventoryItems/${inventoryId}/decrementQuantity`,
      {
        method: 'POST',
        body: {
          decrementData: decrementData.map(d => ({
            variantId: d.variantId,
            quantity: d.quantity,
          })),
        },
      }
    );
  }

  /**
   * Increment inventory (add stock)
   */
  async increment(inventoryId: string, incrementData: { variantId: string; quantity: number }[]): Promise<void> {
    await this.client.request<void>(
      `/stores/v2/inventoryItems/${inventoryId}/incrementQuantity`,
      {
        method: 'POST',
        body: {
          incrementData: incrementData.map(d => ({
            variantId: d.variantId,
            quantity: d.quantity,
          })),
        },
      }
    );
  }

  /**
   * Transform API response to our types
   */
  private transformInventoryItem(item: Record<string, unknown>): InventoryItem {
    const variants = item.variants as Record<string, unknown>[] | undefined;
    const preorderInfo = item.preorderInfo as Record<string, unknown> | undefined;

    return {
      id: item.id as string || item._id as string || '',
      productId: item.productId as string | undefined,
      trackQuantity: item.trackQuantity as boolean | undefined,
      variants: variants?.map(v => this.transformVariant(v)),
      lastUpdated: item.lastUpdated as string | undefined,
      numericId: item.numericId as string | undefined,
      preorderInfo: preorderInfo ? this.transformPreorderInfo(preorderInfo) : undefined,
    };
  }

  private transformInventoryItems(items: Record<string, unknown>[]): InventoryItem[] {
    return items.map(i => this.transformInventoryItem(i));
  }

  private transformVariant(variant: Record<string, unknown>): InventoryVariant {
    return {
      variantId: variant.variantId as string | undefined,
      inStock: variant.inStock as boolean | undefined,
      quantity: variant.quantity as number | undefined,
    };
  }

  private transformPreorderInfo(info: Record<string, unknown>): PreorderInfo {
    return {
      enabled: info.enabled as boolean | undefined,
      message: info.message as string | undefined,
      limit: info.limit as number | undefined,
    };
  }
}
