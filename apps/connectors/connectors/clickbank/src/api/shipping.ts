import { ClickBankClient } from './client';
import type {
  OrderShipData,
  ShippingListParams,
  ShipNoticeParams,
} from '../types';

interface ShippingResponse {
  orderShipData?: OrderShipData | OrderShipData[];
}

interface ShippingListResponse {
  orderShipData?: OrderShipData[];
  _hasMore?: boolean;
}

export class ShippingApi {
  constructor(private readonly client: ClickBankClient) {}

  /**
   * Get the XML schema for shipping data results
   */
  async getSchema(): Promise<string> {
    return this.client.get<string>('/shipping2/schema', undefined, 'xml');
  }

  /**
   * Count physical goods orders matching the shipping criteria
   */
  async count(params?: Omit<ShippingListParams, 'page'>): Promise<number> {
    const response = await this.client.get<{ count: number }>(
      '/shipping2/count',
      params as Record<string, string | number | boolean | undefined>
    );
    return response.count || 0;
  }

  /**
   * List physical goods orders matching the shipping criteria
   */
  async list(params?: ShippingListParams): Promise<{ orders: OrderShipData[]; hasMore: boolean }> {
    const { page, ...queryParams } = params || {};
    const headers = page ? { page: String(page) } : undefined;

    const response = await this.client.request<ShippingListResponse>('/shipping2/list', {
      method: 'GET',
      params: queryParams as Record<string, string | number | boolean | undefined>,
      headers,
    });

    const orders = response.orderShipData || [];
    return {
      orders: Array.isArray(orders) ? orders : [orders],
      hasMore: !!response._hasMore,
    };
  }

  /**
   * Get shipping details for a specific receipt
   */
  async getByReceipt(receipt: string): Promise<OrderShipData | null> {
    const response = await this.list({ receipt });
    return response.orders[0] || null;
  }

  /**
   * Get unshipped orders
   */
  async getUnshipped(params?: Omit<ShippingListParams, 'status'>): Promise<{ orders: OrderShipData[]; hasMore: boolean }> {
    return this.list({ ...params, status: 'notshipped' });
  }

  /**
   * Get shipped orders
   */
  async getShipped(params?: Omit<ShippingListParams, 'status'>): Promise<{ orders: OrderShipData[]; hasMore: boolean }> {
    return this.list({ ...params, status: 'shipped' });
  }

  /**
   * Create a shipping notification
   */
  async createShipNotice(params: ShipNoticeParams): Promise<void> {
    await this.client.post('/shipping2/shipnotice', { ...params });
  }

  /**
   * Mark an order as shipped
   */
  async markShipped(
    receipt: string,
    itemNo: string,
    trackingId?: string,
    carrier?: string
  ): Promise<void> {
    await this.createShipNotice({
      receipt,
      itemNo,
      trackingId,
      carrier,
      date: new Date().toISOString().split('T')[0],
    });
  }
}
