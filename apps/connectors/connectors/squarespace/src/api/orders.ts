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

  async create(order: Record<string, unknown>): Promise<Order> {
    return this.client.request<Order>('/commerce/orders', {
      method: 'POST',
      body: order,
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

  async refund(
    id: string,
    payload: {
      idempotencyKey: string;
      reason?: string;
      refundType?: string;
      amounts?: Array<Record<string, unknown>>;
    },
  ): Promise<unknown> {
    return this.client.request(`/commerce/orders/${encodeURIComponent(id)}/refund`, {
      method: 'POST',
      body: payload,
    });
  }
}
