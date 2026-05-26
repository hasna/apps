import type { WebflowClient } from './client';
import type { Order, UpdateOrderInput } from '../types';

export interface ListOrdersOptions {
  offset?: number;
  limit?: number;
  status?: 'pending' | 'unfulfilled' | 'fulfilled' | 'disputed' | 'dispute-lost' | 'refunded';
}

/**
 * Webflow Ecommerce Orders API
 */
export class OrdersApi {
  constructor(private readonly client: WebflowClient) {}

  /**
   * List all orders for a site
   */
  async list(siteId: string, options: ListOrdersOptions = {}): Promise<{ orders: Order[]; pagination: { offset: number; limit: number; total: number } }> {
    const params: Record<string, string | number | boolean | undefined> = {
      offset: options.offset || 0,
      limit: options.limit || 100,
    };

    if (options.status) params.status = options.status;

    return this.client.request<{ orders: Order[]; pagination: { offset: number; limit: number; total: number } }>(
      `/sites/${siteId}/orders`,
      { params }
    );
  }

  /**
   * Get a single order by ID
   */
  async get(siteId: string, orderId: string): Promise<Order> {
    return this.client.request<Order>(`/sites/${siteId}/orders/${orderId}`);
  }

  /**
   * Update an order (shipping tracking, comments, etc.)
   */
  async update(siteId: string, orderId: string, order: UpdateOrderInput): Promise<Order> {
    return this.client.request<Order>(
      `/sites/${siteId}/orders/${orderId}`,
      { method: 'PATCH', body: order }
    );
  }

  /**
   * Mark an order as fulfilled
   */
  async fulfill(siteId: string, orderId: string, options?: {
    sendOrderFulfilledEmail?: boolean;
  }): Promise<Order> {
    const body: Record<string, unknown> = {};
    if (options?.sendOrderFulfilledEmail !== undefined) {
      body.sendOrderFulfilledEmail = options.sendOrderFulfilledEmail;
    }

    return this.client.request<Order>(
      `/sites/${siteId}/orders/${orderId}/fulfill`,
      { method: 'POST', body: Object.keys(body).length > 0 ? body : undefined }
    );
  }

  /**
   * Mark an order as unfulfilled
   */
  async unfulfill(siteId: string, orderId: string): Promise<Order> {
    return this.client.request<Order>(
      `/sites/${siteId}/orders/${orderId}/unfulfill`,
      { method: 'POST' }
    );
  }

  /**
   * Refund an order
   */
  async refund(siteId: string, orderId: string, reason?: string): Promise<Order> {
    const body: Record<string, unknown> = {};
    if (reason) body.reason = reason;

    return this.client.request<Order>(
      `/sites/${siteId}/orders/${orderId}/refund`,
      { method: 'POST', body: Object.keys(body).length > 0 ? body : undefined }
    );
  }
}
