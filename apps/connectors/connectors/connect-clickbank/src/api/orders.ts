import { ClickBankClient } from './client';
import type {
  OrderData,
  OrdersListParams,
  ChangeProductParams,
  ChangeAddressParams,
  ChangeDateParams,
  ExtendParams,
  PauseParams,
  ReinstateParams,
} from '../types';

interface OrderDataResponse {
  orderData?: OrderData | OrderData[];
}

interface OrderListResponse {
  orderData?: OrderData[];
  _hasMore?: boolean;
}

export class OrdersApi {
  constructor(private readonly client: ClickBankClient) {}

  /**
   * Get the XML schema for order data results
   */
  async getSchema(): Promise<string> {
    return this.client.get<string>('/orders2/schema', undefined, 'xml');
  }

  /**
   * Get order details by receipt number
   */
  async getOrder(receipt: string, sku?: string): Promise<OrderData> {
    const params = sku ? { sku } : undefined;
    const response = await this.client.get<OrderDataResponse>(`/orders2/${receipt}`, params);
    const data = response.orderData;
    if (Array.isArray(data) && data[0]) {
      return data[0];
    }
    if (data && !Array.isArray(data)) {
      return data;
    }
    throw new Error('Order not found');
  }

  /**
   * Get all upsell transactions for a given receipt
   */
  async getUpsells(receipt: string): Promise<OrderData[]> {
    const response = await this.client.get<OrderDataResponse>(`/orders2/${receipt}/upsells`);
    if (!response.orderData) return [];
    return Array.isArray(response.orderData) ? response.orderData : [response.orderData];
  }

  /**
   * Count orders matching the search criteria
   */
  async count(params?: OrdersListParams): Promise<number> {
    const response = await this.client.get<{ count: number }>('/orders2/count', params as Record<string, string | number | boolean | undefined>);
    return response.count || 0;
  }

  /**
   * List orders matching the search criteria
   */
  async list(params?: OrdersListParams): Promise<{ orders: OrderData[]; hasMore: boolean }> {
    const { page, ...queryParams } = params || {};
    const headers = page ? { page: String(page) } : undefined;

    const response = await this.client.request<OrderListResponse>('/orders2/list', {
      method: 'GET',
      params: queryParams as Record<string, string | number | boolean | undefined>,
      headers,
    });

    const orders = response.orderData || [];
    return {
      orders: Array.isArray(orders) ? orders : [orders],
      hasMore: !!response._hasMore,
    };
  }

  /**
   * Change subscription from one product to another
   */
  async changeProduct(receipt: string, params: ChangeProductParams): Promise<void> {
    await this.client.post(`/orders2/${receipt}/changeProduct`, { ...params });
  }

  /**
   * Change customer's shipping address
   */
  async changeAddress(receipt: string, params: ChangeAddressParams): Promise<void> {
    await this.client.post(`/orders2/${receipt}/changeAddress`, { ...params });
  }

  /**
   * Change the date of the next rebill for a recurring product
   */
  async changeDate(receipt: string, params: ChangeDateParams): Promise<void> {
    await this.client.post(`/orders2/${receipt}/changeDate`, { ...params });
  }

  /**
   * Extend a subscription by a specified number of periods
   */
  async extend(receipt: string, params: ExtendParams): Promise<void> {
    await this.client.post(`/orders2/${receipt}/extend`, { ...params });
  }

  /**
   * Pause a subscription until a specified date
   */
  async pause(receipt: string, params: PauseParams): Promise<void> {
    await this.client.post(`/orders2/${receipt}/pause`, { ...params });
  }

  /**
   * Reinstate a cancelled subscription
   */
  async reinstate(receipt: string, params?: ReinstateParams): Promise<void> {
    await this.client.post(`/orders2/${receipt}/reinstate`, params as Record<string, unknown>);
  }

  /**
   * Check if a subscription is active
   */
  async isActive(receipt: string, sku?: string): Promise<boolean> {
    const params = sku ? { sku } : undefined;
    const response = await this.client.head<{ active: boolean }>(`/orders2/${receipt}`, params);
    return response.active;
  }
}
