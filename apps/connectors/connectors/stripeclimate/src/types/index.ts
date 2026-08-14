// Stripe Climate Connector Types
// Scoped to the public Stripe Climate API:
// https://docs.stripe.com/api/climate

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string; // Override default base URL
  accountId?: string; // Connected account ID (Stripe-Account header)
  apiVersion?: string; // Stripe API version
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

/** Key-value metadata */
export type Metadata = Record<string, string>;

/** Stripe list response wrapper */
export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

/** Common list options for pagination */
export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

// ============================================
// Climate Product Types
// https://docs.stripe.com/api/climate/product
// ============================================

/** A price for a Climate product in a specific currency. */
export interface ClimateProductPrice {
  /** ISO currency code, e.g. "usd". */
  currency: string;
  /** Amount charged, in the smallest currency unit, for one metric ton. */
  amount_total: string;
  /** Fees, in the smallest currency unit, for one metric ton. */
  amount_fees: string;
  /** Subtotal, in the smallest currency unit, for one metric ton. */
  amount_subtotal: string;
}

export interface ClimateProduct {
  id: string;
  object: 'climate.product';
  created: number;
  /** Current prices per metric ton, keyed by currency code. */
  current_prices_per_metric_ton: Record<string, ClimateProductPrice>;
  /** The year in which the carbon removal is expected to be delivered. */
  delivery_year: number | null;
  livemode: boolean;
  /** The quantity of carbon removal available for purchase, in metric tons. */
  metric_tons_available: string;
  /** The Stripe-assigned display name for the product. */
  name: string;
  /** The carbon removal suppliers for the product. */
  suppliers: ClimateSupplier[];
}

export interface ClimateProductListOptions extends ListOptions {}

// ============================================
// Climate Supplier Types
// https://docs.stripe.com/api/climate/supplier
// ============================================

export interface ClimateSupplierLocation {
  city: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  region: string | null;
}

export type ClimateRemovalPathway =
  | 'biomass_carbon_removal_and_storage'
  | 'direct_air_capture'
  | 'enhanced_weathering'
  | string;

export interface ClimateSupplier {
  id: string;
  object: 'climate.supplier';
  /** Link to a webpage with more information about the supplier. */
  info_url: string;
  livemode: boolean;
  /** The locations in which the supplier operates. */
  locations: ClimateSupplierLocation[];
  /** The Stripe-assigned display name for the supplier. */
  name: string;
  /** The scientific pathway used for carbon removal. */
  removal_pathway: ClimateRemovalPathway;
}

export interface ClimateSupplierListOptions extends ListOptions {}

// ============================================
// Climate Order Types
// https://docs.stripe.com/api/climate/order
// ============================================

export type ClimateOrderStatus =
  | 'awaiting_funds'
  | 'canceled'
  | 'confirmed'
  | 'delivered'
  | 'open';

export interface ClimateOrderBeneficiary {
  /** Publicly displayable name for the end beneficiary of carbon removal. */
  public_name: string;
}

export interface ClimateOrderDeliveryDetail {
  /** The above-ground biomass amount delivered, in metric tons. */
  delivered_at: number;
  /** A supplier location associated with this delivery. */
  location: ClimateSupplierLocation | null;
  /** Quantity of carbon removal supplied by this delivery, in metric tons. */
  metric_tons: string;
  /** Once retired, a URL to the registry entry for the carbon removal. */
  registry_url: string | null;
  supplier: ClimateSupplier | null;
}

export interface ClimateOrder {
  id: string;
  object: 'climate.order';
  /** Total amount of Frontier fees, in the currency's smallest unit. */
  amount_fees: number;
  /** Total amount of the carbon removal, in the currency's smallest unit. */
  amount_subtotal: number;
  /** Total amount of the order including fees, in the smallest unit. */
  amount_total: number;
  beneficiary: ClimateOrderBeneficiary | null;
  /** Time at which the order was canceled, as a Unix timestamp. */
  canceled_at: number | null;
  /** Reason for the cancellation of this order. */
  cancellation_reason: 'expired' | 'product_unavailable' | 'requested' | null;
  /** For delivered orders, a URL to the carbon removal certificate. */
  certificate: string | null;
  /** Time at which the order was confirmed, as a Unix timestamp. */
  confirmed_at: number | null;
  created: number;
  /** ISO currency code for the order. */
  currency: string;
  /** Time at which the order's expected delivery year was delayed. */
  delayed_at: number | null;
  /** Time at which the order was delivered, as a Unix timestamp. */
  delivered_at: number | null;
  /** Details about the delivery of carbon removal for this order. */
  delivery_details: ClimateOrderDeliveryDetail[];
  /** The year this order is expected to be delivered. */
  expected_delivery_year: number;
  livemode: boolean;
  metadata: Metadata;
  /** Quantity of carbon removal that is included in this order. */
  metric_tons: string;
  /** The Climate product for this order. */
  product: string | ClimateProduct;
  /** Time at which the order's product was substituted. */
  product_substituted_at: number | null;
  status: ClimateOrderStatus;
}

export interface ClimateOrderCreateParams {
  /** Unique Climate product ID. */
  product: string;
  /**
   * Requested amount of carbon removal units, in the currency's smallest unit.
   * Exactly one of `amount` or `metric_tons` must be provided.
   */
  amount?: number;
  /**
   * Requested number of tons for the order.
   * Exactly one of `amount` or `metric_tons` must be provided.
   */
  metric_tons?: string;
  /** Currency for the order (ISO code). Defaults to the product's currency. */
  currency?: string;
  /** Publicly displayable name for the end beneficiary of carbon removal. */
  beneficiary?: ClimateOrderBeneficiary;
  /** Set of key-value pairs to attach to the order. */
  metadata?: Metadata;
}

export interface ClimateOrderUpdateParams {
  /** Publicly displayable name for the end beneficiary of carbon removal. */
  beneficiary?: ClimateOrderBeneficiary | '';
  /** Set of key-value pairs to attach to the order. */
  metadata?: Metadata;
}

export interface ClimateOrderListOptions extends ListOptions {}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code?: string;
  message: string;
  type?: string;
  param?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly detail?: ApiErrorDetail;

  constructor(message: string, statusCode: number, detail?: ApiErrorDetail) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}
