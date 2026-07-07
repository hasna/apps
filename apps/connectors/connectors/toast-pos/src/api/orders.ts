import type { Order, OrdersBulkResponse } from '../types';
import type { ToastClient } from './client';

export class OrdersApi {
  constructor(private readonly client: ToastClient) {}

  async getOrder(orderGuid: string): Promise<Order> {
    return this.client.get<Order>(`/orders/v2/orders/${encodeURIComponent(orderGuid)}`);
  }

  async listOrdersBulk(options?: {
    startDate?: string;
    endDate?: string;
    businessDate?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<OrdersBulkResponse> {
    return this.client.get<OrdersBulkResponse>('/orders/v2/ordersBulk', options);
  }
}
