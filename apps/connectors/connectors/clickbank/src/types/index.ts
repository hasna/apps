// ClickBank API Types

// Configuration
export interface ClickBankConfig {
  apiKey: string;
  baseUrl?: string;
}

// Common types
export type OutputFormat = 'json' | 'xml';

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  hasMore: boolean;
}

// Role types
export type Role = 'VENDOR' | 'AFFILIATE';

// Transaction types
export type TransactionType =
  | 'SALE' | 'RFND' | 'CGBK' | 'FEE' | 'BILL'
  | 'TEST_SALE' | 'TEST_RFND' | 'TEST_CGBK' | 'TEST_FEE' | 'TEST_BILL';

// Customer refundable state
export type CustomerRefundableState =
  | 'REFUNDABLE' | 'SUGGESTED_REFUND_BLOCK' | 'UNREFUNDABLE'
  | 'ALREADY_REFUNDED' | 'TO_OLD' | 'REFUND_BLOCKED'
  | 'HAS_OPEN_REFUND' | 'OVER_ELV_LIMIT' | 'PROVIDER_DISCONNECTED';

// Line item status
export type LineItemStatus = 'ACTIVE' | 'CANCELED' | 'COMPLETED' | 'REFUNDED';

// ============================================
// Orders API Types
// ============================================

export interface LineItemData {
  itemNo: string;
  productTitle: string;
  recurring: boolean;
  shippable: boolean;
  customerAmount: number;
  accountAmount: number;
  quantity: number;
  rebillAmount?: number;
  processedPayments?: number;
  futurePayments?: number;
  nextPaymentDate?: string;
  status: LineItemStatus;
}

export interface CustomerContactInfo {
  type: string;
  value: string;
}

export interface VendorVariable {
  name: string;
  value: string;
}

export interface OrderData {
  transactionTime: string;
  receipt: string;
  trackingId?: string;
  paymentMethod: string;
  transactionType: TransactionType;
  totalOrderAmount: number;
  totalShippingAmount: number;
  totalTaxAmount: number;
  vendor: string;
  affiliate?: string;
  country: string;
  state?: string;
  lastName: string;
  firstName: string;
  currency: string;
  email: string;
  postalCode?: string;
  role: Role;
  fullName: string;
  customerRefundableState: CustomerRefundableState;
  lineItemData: LineItemData[];
  customerContactInfo?: CustomerContactInfo[];
  vendorVariables?: VendorVariable[];
}

export interface OrdersListParams {
  affiliate?: string;
  item?: string;
  email?: string;
  lastName?: string;
  role?: Role;
  startDate?: string;
  endDate?: string;
  tid?: string;
  type?: TransactionType;
  vendor?: string;
  amount?: number;
  postalCode?: string;
  page?: number;
}

export interface ChangeProductParams {
  newSku: string;
  oldSku: string;
  carryAffiliate?: boolean;
  applyProratedRefund?: boolean;
  nextRebillDate?: string;
}

export interface ChangeAddressParams {
  address1: string;
  city: string;
  countryCode: string;
  firstName?: string;
  lastName?: string;
  address2?: string;
  county?: string;
  province?: string;
  postalCode?: string;
}

export interface ChangeDateParams {
  changeDate: string;
  sku?: string;
}

export interface ExtendParams {
  numPeriods: number;
  sku?: string;
}

export interface PauseParams {
  restartDate: string;
  sku?: string;
}

export interface ReinstateParams {
  sku?: string;
}

// ============================================
// Products API Types
// ============================================

export type ProductType = 'STANDARD' | 'RECURRING';

export interface ProductPricing {
  price: number;
  currency: string;
}

export interface ProductCommission {
  purchaseCommission?: number;
  rebillCommission?: number;
}

export interface Product {
  sku: string;
  site: string;
  title: string;
  description?: string;
  language: string;
  currency: string;
  price: number;
  pitchPage: string;
  thankYouPage: string;
  digital: boolean;
  physical?: boolean;
  recurring?: boolean;
  rebillPrice?: number;
  rebillCommission?: number;
  duration?: number;
  frequency?: string;
  trialPeriod?: number;
  categories?: string[];
  image?: string;
  purchaseCommission?: number;
}

export interface CreateProductParams {
  sku: string;
  site: string;
  title: string;
  currency: string;
  language: string;
  price: number;
  pitchPage: string;
  thankYouPage: string;
  digital: boolean;
  description?: string;
  categories?: string[];
  physical?: boolean;
  deliveryMethod?: string;
  deliverySpeed?: string;
  recurring?: boolean;
  rebillPrice?: number;
  rebillCommission?: number;
  duration?: number;
  frequency?: string;
  trialPeriod?: number;
  image?: string;
  purchaseCommission?: number;
  skipConfirmationPage?: boolean;
}

export interface ProductsListParams {
  site: string;
  type?: ProductType;
}

// ============================================
// Tickets API Types
// ============================================

export type TicketStatus = 'open' | 'reopened' | 'closed';
export type TicketType = 'rfnd' | 'cncl' | 'tech';
export type RefundType = 'FULL' | 'PARTIAL_PERCENT' | 'PARTIAL_AMOUNT';

export type TicketAction = 'change' | 'close' | 'reopen';

export interface TicketComment {
  commentId: string;
  date: string;
  comment: string;
  action?: string;
  commentRole: 'VENDOR' | 'CUSTOMER' | 'CBCSR' | 'CBSYSTEM' | 'USER';
}

export interface Ticket {
  ticketid: string;
  receipt: string;
  status: TicketStatus;
  type: TicketType;
  comments?: TicketComment[];
  openedDate: string;
  closedDate?: string;
  description?: string;
  refundType?: RefundType;
  refundAmount?: number;
  customerFirstName?: string;
  customerLastName?: string;
  email?: string;
  emailAtOrderTime?: string;
  expirationDate?: string;
  locale?: string;
  note?: string;
  productItemNo?: string;
  updateTime?: string;
  source?: string;
}

export interface TicketsListParams {
  closeDateFrom?: string;
  closeDateTo?: string;
  createDateFrom?: string;
  createDateTo?: string;
  updateDateFrom?: string;
  updateDateTo?: string;
  receipt?: string;
  status?: TicketStatus;
  type?: TicketType;
  page?: number;
}

export interface TicketsCountParams {
  receipt?: string;
  status?: TicketStatus;
  type?: TicketType;
}

export interface CreateTicketParams {
  type: TicketType;
  reason: string;
  refundType?: RefundType;
  refundAmount?: number;
  sku?: string;
  comment?: string;
  retainSubscription?: boolean;
}

export interface UpdateTicketParams {
  action?: TicketAction;
  type?: TicketType;
  comment?: string;
}

export interface RefundAmountsParams {
  refundType: RefundType;
  refundAmount?: number;
  sku?: string;
}

export interface RefundAmountData {
  vendorAmount: number;
  affiliateAmount: number;
  customerAmount: number;
}

// ============================================
// Shipping API Types
// ============================================

export type ShippingStatus = 'shipped' | 'notshipped' | 'all';

export interface ShippingLineItem {
  itemNo: string;
  productTitle: string;
  quantity: number;
  shippingMethod?: string;
  refunded?: boolean;
  chargedBack?: boolean;
}

export interface OrderShipData {
  receipt: string;
  transactionTime: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phoneNumber?: string;
  address1: string;
  address2?: string;
  city: string;
  county?: string;
  state?: string;
  postalCode?: string;
  country: string;
  lineItems: ShippingLineItem[];
}

export interface ShippingListParams {
  days?: number;
  startDate?: string;
  endDate?: string;
  receipt?: string;
  status?: ShippingStatus;
  page?: number;
}

export interface ShipNoticeParams {
  receipt: string;
  itemNo: string;
  trackingId?: string;
  carrier?: string;
  date?: string;
  comments?: string;
}

// ============================================
// Quickstats API Types
// ============================================

export interface QuickstatsAccount {
  nickname: string;
  role: Role;
}

export interface QuickstatsData {
  date: string;
  sales: number;
  salesAmount: number;
  refunds: number;
  refundsAmount: number;
  chargebacks: number;
  chargebacksAmount: number;
}

export interface QuickstatsCount {
  totalSales: number;
  totalSalesAmount: number;
  totalRefunds: number;
  totalRefundsAmount: number;
  totalChargebacks: number;
  totalChargebacksAmount: number;
}

export interface QuickstatsParams {
  account?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
}

// ============================================
// Analytics API Types
// ============================================

export type AnalyticsDimension =
  | 'PRODUCT_SKU'
  | 'VENDOR_PRODUCT_SKU'
  | 'AFFILIATE'
  | 'VENDOR'
  | 'COUNTRY';

export interface SubscriptionTrend {
  date: string;
  activeSubscriptions: number;
  newSubscriptions: number;
  canceledSubscriptions: number;
  revenue: number;
}

export interface SubscriptionDetails {
  receipt: string;
  productTitle: string;
  sku: string;
  status: string;
  startDate: string;
  nextPaymentDate?: string;
  cancelDate?: string;
  processedPayments: number;
  futurePayments: number;
  totalRevenue: number;
}

export interface AnalyticsStats {
  dimension: string;
  value: string;
  sales: number;
  revenue: number;
  refunds: number;
  refundAmount: number;
}

export interface AnalyticsStatus {
  status: 'GREEN' | 'YELLOW' | 'RED';
  lastUpdate: string;
  message?: string;
}

export interface SubscriptionTrendsParams {
  role: Role;
  account?: string;
  startDate?: string;
  endDate?: string;
}

export interface SubscriptionDetailsParams {
  role: Role;
  account?: string;
  status?: string;
  orderBy?: SubscriptionOrderBy;
  sortDirection?: 'ASC' | 'DESC';
  page?: number;
}

// Subscription detail filter type
export type SubscriptionDetailFilter =
  | 'canceldate'
  | 'cancelsixty'
  | 'cancelthirty'
  | 'compsixty'
  | 'compthirty'
  | 'nextpmtdate'
  | 'startdate'
  | 'status';

// Subscription status values for the status filter
export type SubscriptionStatusFilter =
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELED'
  | 'RETRY_PAYMENT'
  | 'REQUEST_NEW_CARD';

// OrderBy options for subscription details
export type SubscriptionOrderBy =
  | 'AFFILIATE_NICK_NAME'
  | 'CUSTOMER_FIRST_NAME'
  | 'CUSTOMER_LAST_NAME'
  | 'CUSTOMER_DISPLAY_NAME'
  | 'CUSTOMER_EMAIL'
  | 'DURATION'
  | 'FUTURE_PAYMENTS_COUNT'
  | 'INITIAL_SALE_AMOUNT'
  | 'INITIAL_SALE_COUNT'
  | 'ITEM_NUMBER'
  | 'NEXT_PAYMENT_DATE'
  | 'PROCESSED_PAYMENTS_COUNT'
  | 'PUB_NICK_NAME'
  | 'PURCHASE_DATE'
  | 'REBILL_SALE_AMOUNT'
  | 'REBILL_SALE_COUNT'
  | 'RECEIPT'
  | 'RETURN_AMOUNT'
  | 'RETURN_COUNT'
  | 'STATUS'
  | 'SUB_CANCEL_DATE'
  | 'SUB_END_DATE'
  | 'SUB_VALUE';

export interface SubscriptionDetailFilterParams {
  role: Role;
  account: string;
  startDate?: string;
  endDate?: string;
  status?: SubscriptionStatusFilter;
  orderBy?: SubscriptionOrderBy;
  sortDirection?: 'ASC' | 'DESC';
  page?: number;
}

export interface AnalyticsSummaryParams {
  role: Role;
  dimension: AnalyticsDimension;
  account?: string;
  startDate?: string;
  endDate?: string;
  summaryType?: 'VENDOR_ONLY' | 'AFFILIATE_ONLY';
}

export interface AnalyticsStatsParams {
  role: Role;
  dimension: AnalyticsDimension;
  account?: string;
  startDate?: string;
  endDate?: string;
}

// ============================================
// Images API Types
// ============================================

export interface ImageData {
  id: string;
  url: string;
  title?: string;
  description?: string;
  uploadDate: string;
}

// Image type filter
export type ImageType =
  | 'PRODUCT'
  | 'BANNER'
  | 'BANNER_CLASSIC'
  | 'BANNER_NEW'
  | 'BANNER_BG'
  | 'CUSTOM_BANNER'
  | 'CUSTOM_BANNER_BG'
  | 'CUSTOM_ORDERFORM';

export interface ImagesListParams {
  site: string;
  approvedOnly?: boolean;
  type?: ImageType;
  page?: number;
}

// ============================================
// API Error Types
// ============================================

export interface ClickBankError {
  code: number;
  message: string;
  field?: string;
}

export class ClickBankApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ClickBankError[];

  constructor(message: string, statusCode: number, errors?: ClickBankError[]) {
    super(message);
    this.name = 'ClickBankApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
