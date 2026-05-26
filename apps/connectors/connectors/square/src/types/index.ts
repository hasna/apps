// Square Connector Types

// ============================================
// Configuration
// ============================================

export interface SquareConfig {
  accessToken: string;
  baseUrl?: string; // sandbox or production
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface Money {
  amount: number;
  currency: string;
}

// ============================================
// Location Types
// ============================================

export interface Location {
  id: string;
  name: string;
  address?: Address;
  timezone?: string;
  capabilities?: string[];
  status?: 'ACTIVE' | 'INACTIVE';
  created_at?: string;
  merchant_id?: string;
  country?: string;
  language_code?: string;
  currency?: string;
  phone_number?: string;
  business_name?: string;
  type?: 'PHYSICAL' | 'MOBILE';
  website_url?: string;
  business_email?: string;
  description?: string;
}

export interface Address {
  address_line_1?: string;
  address_line_2?: string;
  address_line_3?: string;
  locality?: string;
  sublocality?: string;
  administrative_district_level_1?: string;
  postal_code?: string;
  country?: string;
}

export interface LocationsListResponse {
  locations?: Location[];
  cursor?: string;
  errors?: SquareError[];
}

// ============================================
// Customer Types
// ============================================

export interface Customer {
  id: string;
  created_at?: string;
  updated_at?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  company_name?: string;
  email_address?: string;
  address?: Address;
  phone_number?: string;
  birthday?: string;
  reference_id?: string;
  note?: string;
  preferences?: CustomerPreferences;
  groups?: CustomerGroupInfo[];
  creation_source?: string;
  segment_ids?: string[];
  version?: number;
}

export interface CustomerPreferences {
  email_unsubscribed?: boolean;
}

export interface CustomerGroupInfo {
  id: string;
  name: string;
}

export interface CustomersListResponse {
  customers?: Customer[];
  cursor?: string;
  errors?: SquareError[];
}

export interface CustomerResponse {
  customer?: Customer;
  errors?: SquareError[];
}

export interface CreateCustomerRequest {
  given_name?: string;
  family_name?: string;
  company_name?: string;
  nickname?: string;
  email_address?: string;
  address?: Address;
  phone_number?: string;
  reference_id?: string;
  note?: string;
  birthday?: string;
}

// ============================================
// Payment Types
// ============================================

export interface Payment {
  id: string;
  created_at?: string;
  updated_at?: string;
  amount_money?: Money;
  tip_money?: Money;
  total_money?: Money;
  app_fee_money?: Money;
  approved_money?: Money;
  processing_fee?: ProcessingFee[];
  refunded_money?: Money;
  status?: 'APPROVED' | 'PENDING' | 'COMPLETED' | 'CANCELED' | 'FAILED';
  delay_duration?: string;
  delay_action?: string;
  delayed_until?: string;
  source_type?: string;
  card_details?: CardPaymentDetails;
  location_id?: string;
  order_id?: string;
  reference_id?: string;
  customer_id?: string;
  employee_id?: string;
  refund_ids?: string[];
  buyer_email_address?: string;
  billing_address?: Address;
  shipping_address?: Address;
  note?: string;
  receipt_number?: string;
  receipt_url?: string;
  version_token?: string;
}

export interface ProcessingFee {
  effective_at?: string;
  type?: string;
  amount_money?: Money;
}

export interface CardPaymentDetails {
  status?: string;
  card?: Card;
  entry_method?: string;
  cvv_status?: string;
  avs_status?: string;
  auth_result_code?: string;
  application_identifier?: string;
  application_name?: string;
  application_cryptogram?: string;
  verification_method?: string;
  verification_results?: string;
  statement_description?: string;
}

export interface Card {
  id?: string;
  card_brand?: string;
  last_4?: string;
  exp_month?: number;
  exp_year?: number;
  cardholder_name?: string;
  billing_address?: Address;
  fingerprint?: string;
  customer_id?: string;
  merchant_id?: string;
  reference_id?: string;
  enabled?: boolean;
  card_type?: string;
  prepaid_type?: string;
  bin?: string;
  version?: number;
  card_co_brand?: string;
}

export interface PaymentsListResponse {
  payments?: Payment[];
  cursor?: string;
  errors?: SquareError[];
}

export interface PaymentResponse {
  payment?: Payment;
  errors?: SquareError[];
}

export interface CreatePaymentRequest {
  source_id: string;
  idempotency_key: string;
  amount_money: Money;
  tip_money?: Money;
  app_fee_money?: Money;
  delay_duration?: string;
  autocomplete?: boolean;
  order_id?: string;
  customer_id?: string;
  location_id?: string;
  reference_id?: string;
  note?: string;
  buyer_email_address?: string;
  billing_address?: Address;
  shipping_address?: Address;
  verification_token?: string;
  accept_partial_authorization?: boolean;
}

// ============================================
// Order Types
// ============================================

export interface Order {
  id?: string;
  location_id: string;
  reference_id?: string;
  source?: OrderSource;
  customer_id?: string;
  line_items?: OrderLineItem[];
  taxes?: OrderLineItemTax[];
  discounts?: OrderLineItemDiscount[];
  service_charges?: OrderServiceCharge[];
  fulfillments?: OrderFulfillment[];
  returns?: OrderReturn[];
  return_amounts?: OrderMoneyAmounts;
  net_amounts?: OrderMoneyAmounts;
  rounding_adjustment?: OrderRoundingAdjustment;
  tenders?: Tender[];
  refunds?: Refund[];
  metadata?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  state?: 'OPEN' | 'COMPLETED' | 'CANCELED' | 'DRAFT';
  version?: number;
  total_money?: Money;
  total_tax_money?: Money;
  total_discount_money?: Money;
  total_tip_money?: Money;
  total_service_charge_money?: Money;
}

export interface OrderSource {
  name?: string;
}

export interface OrderLineItem {
  uid?: string;
  name?: string;
  quantity: string;
  quantity_unit?: OrderQuantityUnit;
  note?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  variation_name?: string;
  item_type?: string;
  metadata?: Record<string, string>;
  modifiers?: OrderLineItemModifier[];
  applied_taxes?: OrderLineItemAppliedTax[];
  applied_discounts?: OrderLineItemAppliedDiscount[];
  base_price_money?: Money;
  variation_total_price_money?: Money;
  gross_sales_money?: Money;
  total_tax_money?: Money;
  total_discount_money?: Money;
  total_money?: Money;
}

export interface OrderQuantityUnit {
  measurement_unit?: MeasurementUnit;
  precision?: number;
}

export interface MeasurementUnit {
  custom_unit?: MeasurementUnitCustom;
  area_unit?: string;
  length_unit?: string;
  volume_unit?: string;
  weight_unit?: string;
  generic_unit?: string;
  time_unit?: string;
  type?: string;
}

export interface MeasurementUnitCustom {
  name: string;
  abbreviation: string;
}

export interface OrderLineItemModifier {
  uid?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  name?: string;
  base_price_money?: Money;
  total_price_money?: Money;
  quantity?: string;
}

export interface OrderLineItemAppliedTax {
  uid?: string;
  tax_uid: string;
  applied_money?: Money;
}

export interface OrderLineItemAppliedDiscount {
  uid?: string;
  discount_uid: string;
  applied_money?: Money;
}

export interface OrderLineItemTax {
  uid?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  name?: string;
  type?: 'UNKNOWN_TAX' | 'ADDITIVE' | 'INCLUSIVE';
  percentage?: string;
  applied_money?: Money;
  scope?: 'OTHER_TAX_SCOPE' | 'LINE_ITEM' | 'ORDER';
}

export interface OrderLineItemDiscount {
  uid?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  name?: string;
  type?: 'UNKNOWN_DISCOUNT' | 'FIXED_PERCENTAGE' | 'FIXED_AMOUNT' | 'VARIABLE_PERCENTAGE' | 'VARIABLE_AMOUNT';
  percentage?: string;
  amount_money?: Money;
  applied_money?: Money;
  scope?: 'OTHER_DISCOUNT_SCOPE' | 'LINE_ITEM' | 'ORDER';
}

export interface OrderServiceCharge {
  uid?: string;
  name?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  percentage?: string;
  amount_money?: Money;
  applied_money?: Money;
  total_money?: Money;
  total_tax_money?: Money;
  calculation_phase?: 'SUBTOTAL_PHASE' | 'TOTAL_PHASE';
  taxable?: boolean;
  applied_taxes?: OrderLineItemAppliedTax[];
  type?: string;
}

export interface OrderFulfillment {
  uid?: string;
  type?: 'PICKUP' | 'SHIPMENT' | 'DELIVERY';
  state?: 'PROPOSED' | 'RESERVED' | 'PREPARED' | 'COMPLETED' | 'CANCELED' | 'FAILED';
  line_item_application?: 'ALL' | 'ENTRY_LIST';
  entries?: OrderFulfillmentFulfillmentEntry[];
  pickup_details?: OrderFulfillmentPickupDetails;
  shipment_details?: OrderFulfillmentShipmentDetails;
}

export interface OrderFulfillmentFulfillmentEntry {
  uid?: string;
  line_item_uid: string;
  quantity: string;
}

export interface OrderFulfillmentPickupDetails {
  recipient?: OrderFulfillmentRecipient;
  expires_at?: string;
  auto_complete_duration?: string;
  schedule_type?: 'SCHEDULED' | 'ASAP';
  pickup_at?: string;
  pickup_window_duration?: string;
  prep_time_duration?: string;
  note?: string;
  placed_at?: string;
  accepted_at?: string;
  rejected_at?: string;
  ready_at?: string;
  expired_at?: string;
  picked_up_at?: string;
  canceled_at?: string;
  cancel_reason?: string;
  is_curbside_pickup?: boolean;
  curbside_pickup_details?: CurbsidePickupDetails;
}

export interface CurbsidePickupDetails {
  curbside_details?: string;
  buyer_arrived_at?: string;
}

export interface OrderFulfillmentShipmentDetails {
  recipient?: OrderFulfillmentRecipient;
  carrier?: string;
  shipping_note?: string;
  shipping_type?: string;
  tracking_number?: string;
  tracking_url?: string;
  placed_at?: string;
  in_progress_at?: string;
  packaged_at?: string;
  expected_shipped_at?: string;
  shipped_at?: string;
  canceled_at?: string;
  cancel_reason?: string;
  failed_at?: string;
  failure_reason?: string;
}

export interface OrderFulfillmentRecipient {
  customer_id?: string;
  display_name?: string;
  email_address?: string;
  phone_number?: string;
  address?: Address;
}

export interface OrderReturn {
  uid?: string;
  source_order_id?: string;
  return_line_items?: OrderReturnLineItem[];
  return_service_charges?: OrderReturnServiceCharge[];
  return_taxes?: OrderReturnTax[];
  return_discounts?: OrderReturnDiscount[];
  rounding_adjustment?: OrderRoundingAdjustment;
  return_amounts?: OrderMoneyAmounts;
}

export interface OrderReturnLineItem {
  uid?: string;
  source_line_item_uid?: string;
  name?: string;
  quantity: string;
  quantity_unit?: OrderQuantityUnit;
  note?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  variation_name?: string;
  item_type?: string;
  return_modifiers?: OrderReturnLineItemModifier[];
  applied_taxes?: OrderLineItemAppliedTax[];
  applied_discounts?: OrderLineItemAppliedDiscount[];
  base_price_money?: Money;
  variation_total_price_money?: Money;
  gross_return_money?: Money;
  total_tax_money?: Money;
  total_discount_money?: Money;
  total_money?: Money;
}

export interface OrderReturnLineItemModifier {
  uid?: string;
  source_modifier_uid?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  name?: string;
  base_price_money?: Money;
  total_price_money?: Money;
  quantity?: string;
}

export interface OrderReturnServiceCharge {
  uid?: string;
  source_service_charge_uid?: string;
  name?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  percentage?: string;
  amount_money?: Money;
  applied_money?: Money;
  total_money?: Money;
  total_tax_money?: Money;
  calculation_phase?: string;
  taxable?: boolean;
  applied_taxes?: OrderLineItemAppliedTax[];
}

export interface OrderReturnTax {
  uid?: string;
  source_tax_uid?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  name?: string;
  type?: string;
  percentage?: string;
  applied_money?: Money;
  scope?: string;
}

export interface OrderReturnDiscount {
  uid?: string;
  source_discount_uid?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  name?: string;
  type?: string;
  percentage?: string;
  amount_money?: Money;
  applied_money?: Money;
  scope?: string;
}

export interface OrderMoneyAmounts {
  total_money?: Money;
  tax_money?: Money;
  discount_money?: Money;
  tip_money?: Money;
  service_charge_money?: Money;
}

export interface OrderRoundingAdjustment {
  uid?: string;
  name?: string;
  amount_money?: Money;
}

export interface Tender {
  id?: string;
  location_id?: string;
  transaction_id?: string;
  created_at?: string;
  note?: string;
  amount_money?: Money;
  tip_money?: Money;
  processing_fee_money?: Money;
  customer_id?: string;
  type: string;
  card_details?: TenderCardDetails;
  cash_details?: TenderCashDetails;
  payment_id?: string;
}

export interface TenderCardDetails {
  status?: string;
  card?: Card;
  entry_method?: string;
}

export interface TenderCashDetails {
  buyer_tendered_money?: Money;
  change_back_money?: Money;
}

export interface Refund {
  id: string;
  location_id?: string;
  transaction_id?: string;
  tender_id?: string;
  created_at?: string;
  reason: string;
  amount_money: Money;
  status: string;
  processing_fee_money?: Money;
}

export interface OrderResponse {
  order?: Order;
  errors?: SquareError[];
}

export interface OrdersSearchResponse {
  orders?: Order[];
  cursor?: string;
  errors?: SquareError[];
}

export interface CreateOrderRequest {
  order: {
    location_id: string;
    reference_id?: string;
    customer_id?: string;
    line_items?: OrderLineItem[];
    taxes?: OrderLineItemTax[];
    discounts?: OrderLineItemDiscount[];
    fulfillments?: OrderFulfillment[];
    metadata?: Record<string, string>;
  };
  idempotency_key?: string;
}

// ============================================
// Catalog Types
// ============================================

export interface CatalogObject {
  type: string;
  id: string;
  updated_at?: string;
  version?: number;
  is_deleted?: boolean;
  custom_attribute_values?: Record<string, CatalogCustomAttributeValue>;
  catalog_v1_ids?: CatalogV1Id[];
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
  item_data?: CatalogItem;
  category_data?: CatalogCategory;
  item_variation_data?: CatalogItemVariation;
  tax_data?: CatalogTax;
  discount_data?: CatalogDiscount;
  modifier_list_data?: CatalogModifierList;
  modifier_data?: CatalogModifier;
  image_data?: CatalogImage;
}

export interface CatalogCustomAttributeValue {
  name?: string;
  string_value?: string;
  custom_attribute_definition_id?: string;
  type?: string;
  number_value?: string;
  boolean_value?: boolean;
  selection_uid_values?: string[];
  key?: string;
}

export interface CatalogV1Id {
  catalog_v1_id?: string;
  location_id?: string;
}

export interface CatalogItem {
  name?: string;
  description?: string;
  abbreviation?: string;
  label_color?: string;
  available_online?: boolean;
  available_for_pickup?: boolean;
  available_electronically?: boolean;
  category_id?: string;
  tax_ids?: string[];
  modifier_list_info?: CatalogItemModifierListInfo[];
  variations?: CatalogObject[];
  product_type?: string;
  skip_modifier_screen?: boolean;
  item_options?: CatalogItemOptionForItem[];
  image_ids?: string[];
  sort_name?: string;
  description_html?: string;
  description_plaintext?: string;
}

export interface CatalogItemModifierListInfo {
  modifier_list_id: string;
  modifier_overrides?: CatalogModifierOverride[];
  min_selected_modifiers?: number;
  max_selected_modifiers?: number;
  enabled?: boolean;
}

export interface CatalogModifierOverride {
  modifier_id: string;
  on_by_default?: boolean;
}

export interface CatalogItemOptionForItem {
  item_option_id?: string;
}

export interface CatalogCategory {
  name?: string;
  image_ids?: string[];
}

export interface CatalogItemVariation {
  item_id?: string;
  name?: string;
  sku?: string;
  upc?: string;
  ordinal?: number;
  pricing_type?: 'FIXED_PRICING' | 'VARIABLE_PRICING';
  price_money?: Money;
  location_overrides?: ItemVariationLocationOverrides[];
  track_inventory?: boolean;
  inventory_alert_type?: string;
  inventory_alert_threshold?: number;
  user_data?: string;
  service_duration?: number;
  available_for_booking?: boolean;
  item_option_values?: CatalogItemOptionValueForItemVariation[];
  measurement_unit_id?: string;
  sellable?: boolean;
  stockable?: boolean;
  image_ids?: string[];
  team_member_ids?: string[];
  stockable_conversion?: CatalogStockConversion;
}

export interface ItemVariationLocationOverrides {
  location_id?: string;
  price_money?: Money;
  pricing_type?: string;
  track_inventory?: boolean;
  inventory_alert_type?: string;
  inventory_alert_threshold?: number;
  sold_out?: boolean;
  sold_out_valid_until?: string;
}

export interface CatalogItemOptionValueForItemVariation {
  item_option_id?: string;
  item_option_value_id?: string;
}

export interface CatalogStockConversion {
  stockable_item_variation_id: string;
  stockable_quantity: string;
  nonstockable_quantity: string;
}

export interface CatalogTax {
  name?: string;
  calculation_phase?: string;
  inclusion_type?: string;
  percentage?: string;
  applies_to_custom_amounts?: boolean;
  enabled?: boolean;
}

export interface CatalogDiscount {
  name?: string;
  discount_type?: string;
  percentage?: string;
  amount_money?: Money;
  pin_required?: boolean;
  label_color?: string;
  modify_tax_basis?: string;
  maximum_amount_money?: Money;
}

export interface CatalogModifierList {
  name?: string;
  ordinal?: number;
  selection_type?: 'SINGLE' | 'MULTIPLE';
  modifiers?: CatalogObject[];
  image_ids?: string[];
}

export interface CatalogModifier {
  name?: string;
  price_money?: Money;
  ordinal?: number;
  modifier_list_id?: string;
  image_id?: string;
}

export interface CatalogImage {
  name?: string;
  url?: string;
  caption?: string;
  photo_studio_order_id?: string;
}

export interface CatalogListResponse {
  objects?: CatalogObject[];
  cursor?: string;
  errors?: SquareError[];
}

export interface CatalogObjectResponse {
  object?: CatalogObject;
  related_objects?: CatalogObject[];
  errors?: SquareError[];
}

// ============================================
// API Error Types
// ============================================

export interface SquareError {
  category: string;
  code: string;
  detail?: string;
  field?: string;
}

export class SquareApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: SquareError[];

  constructor(message: string, statusCode: number, errors?: SquareError[]) {
    super(message);
    this.name = 'SquareApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
