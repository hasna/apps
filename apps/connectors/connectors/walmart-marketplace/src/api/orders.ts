import type { WalmartMarketplaceClient } from './client';
import type { WalmartOrder, WalmartOrdersListResponse, WalmartOrderResponse } from '../types';

export interface ListOrdersOptions {
  limit?: number;
  offset?: number;
  createdStartDate?: string;
  createdEndDate?: string;
  shipNodeType?: 'SellerFulfilled' | 'WFSFulfilled' | '3PLFulfilled';
  productInfo?: boolean;
  replacementInfo?: boolean;
  incentiveInfo?: boolean;
  nextCursor?: string;
}

export class OrdersApi {
  constructor(private readonly client: WalmartMarketplaceClient) {}

  async list(options: ListOrdersOptions = {}): Promise<WalmartOrdersListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    if (options.createdStartDate) params.createdStartDate = options.createdStartDate;
    if (options.createdEndDate) params.createdEndDate = options.createdEndDate;
    if (options.shipNodeType) params.shipNodeType = options.shipNodeType;
    if (options.productInfo !== undefined) params.productInfo = options.productInfo;
    if (options.replacementInfo !== undefined) params.replacementInfo = options.replacementInfo;
    if (options.incentiveInfo !== undefined) params.incentiveInfo = options.incentiveInfo;
    if (options.nextCursor) params.nextCursor = options.nextCursor;

    return this.client.get<WalmartOrdersListResponse>('/orders', params);
  }

  async get(purchaseOrderId: string): Promise<WalmartOrder> {
    const response = await this.client.get<WalmartOrderResponse>(
      `/orders/${encodeURIComponent(purchaseOrderId)}`
    );
    if (!response.order) {
      throw new Error(`Order not found: ${purchaseOrderId}`);
    }
    return response.order;
  }
}
