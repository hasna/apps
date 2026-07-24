// Walmart Marketplace Connector Types

export interface WalmartMarketplaceConfig {
  accessToken: string;
  serviceName: string;
  baseUrl?: string;
  correlationId?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface WalmartError {
  code?: string;
  field?: string;
  description?: string;
  info?: string;
  severity?: string;
  category?: string;
}

export interface WalmartListMeta {
  totalCount?: number;
  limit?: number;
  offset?: number;
  nextCursor?: string;
}

export interface WalmartItem {
  sku?: string;
  wpid?: string;
  upc?: string;
  gtin?: string;
  productName?: string;
  shelf?: string;
  productType?: string;
  price?: {
    currency?: string;
    amount?: number;
  };
  publishedStatus?: string;
  lifecycleStatus?: string;
  variantGroupId?: string;
  variantGroupInfo?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WalmartItemsListResponse {
  ItemResponse?: WalmartItem[];
  totalItems?: number;
  nextCursor?: string;
  errors?: WalmartError[];
}

export interface WalmartItemResponse {
  ItemResponse?: WalmartItem[];
  errors?: WalmartError[];
}

export interface WalmartInventory {
  sku?: string;
  quantity?: {
    unit?: string;
    amount?: number;
  };
  shipNode?: string;
  [key: string]: unknown;
}

export interface WalmartInventoryListResponse {
  elements?: {
    inventories?: WalmartInventory[];
  };
  meta?: WalmartListMeta;
  errors?: WalmartError[];
}

export interface WalmartOrderLine {
  lineNumber?: string;
  item?: {
    sku?: string;
    productName?: string;
    condition?: string;
  };
  orderLineQuantity?: {
    unitOfMeasurement?: string;
    amount?: string;
  };
  charges?: Record<string, unknown>;
  statusDate?: number;
  [key: string]: unknown;
}

export interface WalmartOrder {
  purchaseOrderId?: string;
  customerOrderId?: string;
  customerEmailId?: string;
  orderDate?: number;
  shippingInfo?: Record<string, unknown>;
  orderLines?: {
    orderLine?: WalmartOrderLine[];
  };
  shipNode?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WalmartOrdersListResponse {
  list?: {
    meta?: WalmartListMeta;
    elements?: {
      order?: WalmartOrder[];
    };
  };
  errors?: WalmartError[];
}

export interface WalmartOrderResponse {
  order?: WalmartOrder;
  errors?: WalmartError[];
}

export class WalmartMarketplaceApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: WalmartError[];

  constructor(message: string, statusCode: number, errors?: WalmartError[]) {
    super(message);
    this.name = 'WalmartMarketplaceApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
