import type { ConnectorClient } from './client';
import type { DeletedObject, Metadata } from '../types';

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
  productIds: string[];
  /** Action to perform */
  action: 'delete' | 'activate' | 'deactivate';
}

export interface BulkProductResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ productId: string; error: string }>;
  results: Array<{ productId: string; response: unknown }>;
}

// --- Price Bulk Operations ---

export interface BulkPriceOptions extends BulkOperationOptions {
  priceIds: string[];
  /** Action to perform */
  action: 'activate' | 'deactivate';
}

export interface BulkPriceResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ priceId: string; error: string }>;
  results: Array<{ priceId: string; response: unknown }>;
}

// --- Customer Bulk Operations ---

export interface BulkCustomerOptions extends BulkOperationOptions {
  customerIds: string[];
}

export interface BulkCustomerResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ customerId: string; error: string }>;
  results: Array<{ customerId: string; response: DeletedObject }>;
}

// --- Subscription Bulk Operations ---

export interface BulkSubscriptionOptions extends BulkOperationOptions {
  subscriptionIds: string[];
  /** Action to perform */
  action: 'cancel' | 'resume';
  /** Cancel immediately instead of at period end */
  cancelImmediately?: boolean;
}

export interface BulkSubscriptionResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ subscriptionId: string; error: string }>;
  results: Array<{ subscriptionId: string; response: unknown }>;
}

// --- Coupon Bulk Operations ---

export interface BulkCouponOptions extends BulkOperationOptions {
  couponIds: string[];
}

export interface BulkCouponResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ couponId: string; error: string }>;
  results: Array<{ couponId: string; response: DeletedObject }>;
}

// --- Invoice Bulk Operations ---

export interface BulkInvoiceOptions extends BulkOperationOptions {
  invoiceIds: string[];
  /** Action to perform (only draft invoices can be deleted) */
  action: 'delete' | 'void' | 'finalize';
}

export interface BulkInvoiceResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ invoiceId: string; error: string }>;
  results: Array<{ invoiceId: string; response: unknown }>;
}

// --- Webhook Bulk Operations ---

export interface BulkWebhookOptions extends BulkOperationOptions {
  webhookIds: string[];
}

export interface BulkWebhookResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ webhookId: string; error: string }>;
  results: Array<{ webhookId: string; response: DeletedObject }>;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: ConnectorClient;

  constructor(client: ConnectorClient) {
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
                response = await this.client.products.del(productId);
              } else {
                response = await this.client.products.update(productId, {
                  active: action === 'activate',
                });
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
  // Bulk Price Operations
  // ============================================

  async prices(options: BulkPriceOptions): Promise<BulkPriceResult> {
    const { priceIds, action, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkPriceResult = {
      total: priceIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (priceIds.length === 0) return result;

    const chunks = this.chunkArray(priceIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (priceId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const response = await this.client.prices.update(priceId, {
                active: action === 'activate',
              });
              result.success++;
              result.results.push({ priceId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, priceId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ priceId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), priceId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Customer Operations
  // ============================================

  async customers(options: BulkCustomerOptions): Promise<BulkCustomerResult> {
    const { customerIds, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkCustomerResult = {
      total: customerIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (customerIds.length === 0) return result;

    const chunks = this.chunkArray(customerIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (customerId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const response = await this.client.customers.del(customerId);
              result.success++;
              result.results.push({ customerId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, customerId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ customerId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), customerId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Subscription Operations
  // ============================================

  async subscriptions(options: BulkSubscriptionOptions): Promise<BulkSubscriptionResult> {
    const { subscriptionIds, action, cancelImmediately = false, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkSubscriptionResult = {
      total: subscriptionIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (subscriptionIds.length === 0) return result;

    const chunks = this.chunkArray(subscriptionIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (subscriptionId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              let response: unknown;
              if (action === 'cancel') {
                response = await this.client.subscriptions.cancel(subscriptionId, {
                  prorate: cancelImmediately,
                  invoice_now: cancelImmediately,
                });
              } else {
                response = await this.client.subscriptions.resume(subscriptionId);
              }
              result.success++;
              result.results.push({ subscriptionId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, subscriptionId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ subscriptionId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), subscriptionId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Coupon Operations
  // ============================================

  async coupons(options: BulkCouponOptions): Promise<BulkCouponResult> {
    const { couponIds, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkCouponResult = {
      total: couponIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (couponIds.length === 0) return result;

    const chunks = this.chunkArray(couponIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (couponId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const response = await this.client.coupons.del(couponId);
              result.success++;
              result.results.push({ couponId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, couponId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ couponId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), couponId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Invoice Operations
  // ============================================

  async invoices(options: BulkInvoiceOptions): Promise<BulkInvoiceResult> {
    const { invoiceIds, action, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkInvoiceResult = {
      total: invoiceIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (invoiceIds.length === 0) return result;

    const chunks = this.chunkArray(invoiceIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (invoiceId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              let response: unknown;
              if (action === 'delete') {
                response = await this.client.invoices.del(invoiceId);
              } else if (action === 'void') {
                response = await this.client.invoices.void(invoiceId);
              } else {
                response = await this.client.invoices.finalize(invoiceId);
              }
              result.success++;
              result.results.push({ invoiceId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, invoiceId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ invoiceId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), invoiceId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Webhook Operations
  // ============================================

  async webhooks(options: BulkWebhookOptions): Promise<BulkWebhookResult> {
    const { webhookIds, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkWebhookResult = {
      total: webhookIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (webhookIds.length === 0) return result;

    const chunks = this.chunkArray(webhookIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (webhookId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const response = await this.client.webhooks.del(webhookId);
              result.success++;
              result.results.push({ webhookId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, webhookId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ webhookId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), webhookId);
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
