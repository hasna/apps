import type { ShopifyClient } from './client';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, item: unknown) => void;
  /** Error callback */
  onError?: (error: Error, item: unknown) => void;
}

// --- Product Bulk Operations ---

export interface BulkProductOptions extends BulkOperationOptions {
  productIds: number[];
  /** Action to perform */
  action: 'delete' | 'activate' | 'archive';
}

export interface BulkProductResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ productId: number; error: string }>;
  results: Array<{ productId: number; response: unknown }>;
}

// --- Order Bulk Operations ---

export interface BulkOrderOptions extends BulkOperationOptions {
  orderIds: number[];
  /** Action to perform */
  action: 'close' | 'open' | 'cancel';
  /** Cancel reason (for cancel action only) */
  cancelReason?: 'customer' | 'inventory' | 'fraud' | 'declined' | 'other';
  /** Send cancel email notification */
  cancelEmail?: boolean;
  /** Restock items on cancel */
  cancelRestock?: boolean;
}

export interface BulkOrderResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ orderId: number; error: string }>;
  results: Array<{ orderId: number; response: unknown }>;
}

// --- Inventory Bulk Operations ---

export interface BulkInventoryOptions extends BulkOperationOptions {
  /** Items with their target levels per location */
  items: Array<{ inventoryItemId: number; locationId: number; available: number }>;
  /** Action: set to exact value, or adjust by amount */
  action: 'set' | 'adjust';
}

export interface BulkInventoryResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ inventoryItemId: number; locationId: number; error: string }>;
  results: Array<{ inventoryItemId: number; locationId: number; response: unknown }>;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: ShopifyClient;

  constructor(client: ShopifyClient) {
    this.client = client;
  }

  // ============================================
  // Bulk Product Operations
  // ============================================

  async products(options: BulkProductOptions): Promise<BulkProductResult> {
    const { productIds, action, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkProductResult = {
      total: productIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (productIds.length === 0) return result;

    const chunks = this.chunkArray(productIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (productId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              let response: unknown;
              if (action === 'delete') {
                await this.client.request<void>(`/products/${productId}.json`, { method: 'DELETE' });
                response = { deleted: productId };
              } else {
                response = await this.client.request<{ product: Record<string, unknown> }>(
                  `/products/${productId}.json`,
                  {
                    method: 'PUT',
                    body: { product: { id: productId, status: action === 'activate' ? 'active' : 'archived' } },
                  }
                );
              }
              result.success++;
              result.results.push({ productId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, productId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ productId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), productId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Order Operations
  // ============================================

  async orders(options: BulkOrderOptions): Promise<BulkOrderResult> {
    const { orderIds, action, cancelReason, cancelEmail, cancelRestock, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkOrderResult = {
      total: orderIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (orderIds.length === 0) return result;

    const chunks = this.chunkArray(orderIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (orderId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              let response: unknown;
              if (action === 'close') {
                response = await this.client.request<{ order: Record<string, unknown> }>(
                  `/orders/${orderId}/close.json`,
                  { method: 'POST' }
                );
              } else if (action === 'open') {
                response = await this.client.request<{ order: Record<string, unknown> }>(
                  `/orders/${orderId}/open.json`,
                  { method: 'POST' }
                );
              } else {
                const body: Record<string, unknown> = {};
                if (cancelReason) body.reason = cancelReason;
                if (cancelEmail !== undefined) body.email = cancelEmail;
                if (cancelRestock !== undefined) body.restock = cancelRestock;
                response = await this.client.request<{ order: Record<string, unknown> }>(
                  `/orders/${orderId}/cancel.json`,
                  { method: 'POST', body: Object.keys(body).length > 0 ? body : undefined }
                );
              }
              result.success++;
              result.results.push({ orderId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, orderId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ orderId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), orderId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Inventory Operations
  // ============================================

  async inventory(options: BulkInventoryOptions): Promise<BulkInventoryResult> {
    const { items, action, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkInventoryResult = {
      total: items.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (items.length === 0) return result;

    const chunks = this.chunkArray(items, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (item) => {
          const { inventoryItemId, locationId, available } = item;
          try {
            if (dryRun) {
              result.success++;
            } else {
              let response: unknown;
              if (action === 'set') {
                response = await this.client.request<{ inventory_level: Record<string, unknown> }>(
                  '/inventory_levels/set.json',
                  {
                    method: 'POST',
                    body: {
                      location_id: locationId,
                      inventory_item_id: inventoryItemId,
                      available,
                    },
                  }
                );
              } else {
                response = await this.client.request<{ inventory_level: Record<string, unknown> }>(
                  '/inventory_levels/adjust.json',
                  {
                    method: 'POST',
                    body: {
                      location_id: locationId,
                      inventory_item_id: inventoryItemId,
                      available_adjustment: available,
                    },
                  }
                );
              }
              result.success++;
              result.results.push({ inventoryItemId, locationId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, item);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ inventoryItemId, locationId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), item);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
