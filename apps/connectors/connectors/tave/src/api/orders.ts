import type { ConnectorClient } from './client';
import type { ListParams, ListResponse, Order } from '../types';

function toQuery(params?: ListParams): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (params?.page !== undefined) query.page = params.page;
  if (params?.perPage !== undefined) query.per_page = params.perPage;
  if (params?.search) query.search = params.search;
  if (params?.status) query.status = params.status;
  return query;
}

export class OrdersApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<ListResponse<Order>> {
    return this.client.get<ListResponse<Order>>('/orders', toQuery(params));
  }

  async get(id: string | number): Promise<Order> {
    return this.client.get<Order>(`/orders/${id}`);
  }
}
