import type { ValenceClient } from './client';
import { encodePathSegment } from './client';
import type { CreateOrderRequest, ListParams } from '../types';

export class OrdersApi {
  constructor(private readonly client: ValenceClient) {}

  async listOrders(params?: ListParams): Promise<unknown> {
    return this.client.request('/orders', { params });
  }

  async createOrder(body: CreateOrderRequest): Promise<unknown> {
    return this.client.request('/orders', { method: 'POST', body });
  }

  async cancelOrder(orderId: string, body?: Record<string, unknown>): Promise<unknown> {
    return this.client.request(`/orders/${encodePathSegment(orderId)}/cancel`, {
      method: 'POST',
      body: body ?? {},
    });
  }
}
