import type { SquarespaceClient } from './client';
import type { Order } from '../types';

export interface ListOrdersOptions {
  cursor?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  fulfillmentStatus?: string;
}

export interface OrdersListResponse {
  result: Order[];
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export class OrdersApi {
  constructor(private readonly client: SquarespaceClient) {}

  async list(options: ListOrdersOptions = {}): Promise<OrdersListResponse> {
    return this.client.request<OrdersListResponse>('/commerce/orders', {
      params: {
        cursor: options.cursor,
        modifiedAfter: options.modifiedAfter,
        modifiedBefore: options.modifiedBefore,
        fulfillmentStatus: options.fulfillmentStatus,
      },
    });
  }

  async get(id: string): Promise<Order> {
    return this.client.request<Order>(`/commerce/orders/${encodeURIComponent(id)}`);
  }

  async create(order: Record<string, unknown>, idempotencyKey: string): Promise<Order> {
    if (!idempotencyKey) {
      throw new Error('Idempotency key is required for order creation');
    }

    return this.client.request<Order>('/commerce/orders', {
      method: 'POST',
      body: order,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  async fulfill(
    id: string,
    payload: { shouldSendNotification?: boolean; shipments?: Array<Record<string, unknown>> },
  ): Promise<unknown> {
    return this.client.request(`/commerce/orders/${encodeURIComponent(id)}/fulfillments`, {
      method: 'POST',
      body: payload,
    });
  }

}
