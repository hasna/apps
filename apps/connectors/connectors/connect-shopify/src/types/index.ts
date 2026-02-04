export type OutputFormat = 'json' | 'pretty';

export interface ShopifyConfig {
  store: string; // mystore.myshopify.com or just "mystore"
  accessToken: string;
  apiVersion?: string;
}

// Shop
export interface Shop {
  id: number;
  name: string;
  email: string;
  domain: string;
  myshopify_domain: string;
  shop_owner: string;
  phone: string;
  address1: string;
  city: string;
  province: string;
  country: string;
  zip: string;
  currency: string;
  money_format: string;
  timezone: string;
  plan_name: string;
  created_at: string;
  updated_at: string;
}

// Product
export interface Product {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  handle: string;
  status: 'active' | 'archived' | 'draft';
  tags: string;
  variants: Variant[];
  images: ProductImage[];
  options: ProductOption[];
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface Variant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  compare_at_price: string | null;
  sku: string;
  barcode: string | null;
  inventory_quantity: number;
  inventory_item_id: number;
  weight: number;
  weight_unit: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: number;
  product_id: number;
  position: number;
  src: string;
  width: number;
  height: number;
  alt: string | null;
}

export interface ProductOption {
  id: number;
  product_id: number;
  name: string;
  position: number;
  values: string[];
}

export interface ProductCreateInput {
  title: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  status?: 'active' | 'archived' | 'draft';
  tags?: string;
  variants?: Partial<Variant>[];
}

// Order
export interface Order {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  order_number: number;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  confirmed: boolean;
  cancelled_at: string | null;
  cancel_reason: string | null;
  line_items: LineItem[];
  shipping_address: Address | null;
  billing_address: Address | null;
  customer: Customer | null;
  fulfillments: Fulfillment[];
  created_at: string;
  updated_at: string;
  processed_at: string;
  note: string | null;
  tags: string;
}

export interface LineItem {
  id: number;
  product_id: number;
  variant_id: number;
  title: string;
  variant_title: string;
  sku: string;
  quantity: number;
  price: string;
  total_discount: string;
  fulfillment_status: string | null;
}

export interface Fulfillment {
  id: number;
  order_id: number;
  status: string;
  tracking_number: string | null;
  tracking_url: string | null;
  tracking_company: string | null;
  line_items: LineItem[];
  created_at: string;
  updated_at: string;
}

export interface Address {
  first_name: string;
  last_name: string;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  province_code: string;
  country: string;
  country_code: string;
  zip: string;
  phone: string | null;
}

// Customer
export interface Customer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  orders_count: number;
  total_spent: string;
  verified_email: boolean;
  state: string;
  tags: string;
  addresses: Address[];
  default_address: Address | null;
  created_at: string;
  updated_at: string;
  note: string | null;
}

export interface CustomerCreateInput {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  tags?: string;
  note?: string;
  addresses?: Partial<Address>[];
}

// Inventory
export interface InventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

export interface InventoryItem {
  id: number;
  sku: string;
  tracked: boolean;
  cost: string | null;
  country_code_of_origin: string | null;
}

export interface Location {
  id: number;
  name: string;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  country: string;
  zip: string;
  phone: string | null;
  active: boolean;
  legacy: boolean;
}

// Collection
export interface Collection {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  sort_order: string;
  products_count: number;
  published_at: string | null;
  updated_at: string;
}

// Pagination
export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pageInfo?: PageInfo;
}

// Error
export class ShopifyError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errors?: Record<string, string[]> | string
  ) {
    super(message);
    this.name = 'ShopifyError';
  }
}

// Alias for backwards compatibility
export { ShopifyError as ShopifyApiError };
