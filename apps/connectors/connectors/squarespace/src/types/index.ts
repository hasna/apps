export type OutputFormat = 'json' | 'pretty' | 'table';

export interface SquarespaceConfig {
  apiKey: string;
}

export interface CursorPagination {
  nextPageCursor?: string;
  hasNextPage?: boolean;
}

export interface PaginatedResponse<T> extends CursorPagination {
  [key: string]: T[] | string | boolean | undefined;
}

export interface InventoryItem {
  variantId: string;
  sku?: string;
  descriptor?: string;
  isUnlimited?: boolean;
  quantity?: number;
}

export interface InventoryAdjustmentRequest {
  incrementOperations?: Array<Record<string, unknown>>;
  decrementOperations?: Array<Record<string, unknown>>;
  setFiniteOperations?: Array<Record<string, unknown>>;
  setUnlimitedOperations?: Array<Record<string, unknown>>;
}

export interface Order {
  id: string;
  orderNumber?: string;
  createdOn?: string;
  modifiedOn?: string;
  channel?: string;
  testmode?: boolean;
  customerEmail?: string;
  billingAddress?: Record<string, unknown>;
  shippingAddress?: Record<string, unknown>;
  fulfillmentStatus?: string;
  lineItems?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface Product {
  id: string;
  type?: string;
  storePageId?: string;
  name?: string;
  description?: string;
  url?: string;
  urlSlug?: string;
  tags?: string[];
  isVisible?: boolean;
  variants?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface Transaction {
  id: string;
  createdOn?: string;
  modifiedOn?: string;
  amount?: Record<string, unknown>;
  status?: string;
  type?: string;
  [key: string]: unknown;
}

export interface Profile {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  acceptsMarketing?: boolean;
  [key: string]: unknown;
}

export interface StorePage {
  id: string;
  title?: string;
  isEnabled?: boolean;
  [key: string]: unknown;
}

export interface Form {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface WebhookSubscription {
  id: string;
  endpointUrl?: string;
  topics?: string[];
  secret?: string;
  [key: string]: unknown;
}

export class SquarespaceApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly type?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SquarespaceApiError';
  }
}
