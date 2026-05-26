export type OutputFormat = 'json' | 'pretty';

export interface WixConfig {
  apiKey: string;
  siteId?: string; // Optional, for site-specific calls
  accountId?: string; // Optional, for account-level calls
}

// ============================================
// Site Types
// ============================================

export interface Site {
  id: string;
  name: string;
  url: string;
  description?: string;
  createdDate: string;
  published: boolean;
  thumbnailUrl?: string;
  siteDisplayName?: string;
  namespace?: string;
  viewUrl?: string;
  editUrl?: string;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: string;
  revision: number;
  source: ContactSource;
  createdDate: string;
  updatedDate: string;
  lastActivity?: ContactActivity;
  primaryInfo?: PrimaryContactInfo;
  info?: ContactInfo;
  picture?: string;
}

export interface ContactSource {
  sourceType: string;
  appId?: string;
  wixAppType?: string;
}

export interface ContactActivity {
  activityDate: string;
  activityType: string;
}

export interface PrimaryContactInfo {
  email?: string;
  phone?: string;
}

export interface ContactInfo {
  name?: ContactName;
  emails?: ContactEmail[];
  phones?: ContactPhone[];
  addresses?: ContactAddress[];
  company?: string;
  jobTitle?: string;
  birthdate?: string;
  locale?: string;
  labelKeys?: string[];
  extendedFields?: Record<string, unknown>;
}

export interface ContactName {
  first?: string;
  last?: string;
}

export interface ContactEmail {
  id?: string;
  tag?: string;
  email: string;
  primary?: boolean;
}

export interface ContactPhone {
  id?: string;
  tag?: string;
  countryCode?: string;
  phone: string;
  e164Phone?: string;
  primary?: boolean;
}

export interface ContactAddress {
  id?: string;
  tag?: string;
  address?: Address;
}

export interface Address {
  country?: string;
  subdivision?: string;
  city?: string;
  postalCode?: string;
  addressLine?: string;
  addressLine2?: string;
  streetAddress?: StreetAddress;
}

export interface StreetAddress {
  number?: string;
  name?: string;
  apt?: string;
}

export interface CreateContactRequest {
  info?: ContactInfo;
  allowDuplicates?: boolean;
}

export interface UpdateContactRequest {
  info?: ContactInfo;
  revision: number;
}

// ============================================
// Member Types
// ============================================

export interface Member {
  id: string;
  loginEmail?: string;
  loginEmailVerified?: boolean;
  status: 'PENDING' | 'APPROVED' | 'OFFLINE' | 'BLOCKED' | 'UNKNOWN';
  contact?: MemberContact;
  profile?: MemberProfile;
  privacyStatus?: 'PUBLIC' | 'PRIVATE' | 'UNKNOWN';
  activityStatus?: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  createdDate?: string;
  updatedDate?: string;
  lastLoginDate?: string;
}

export interface MemberContact {
  contactId?: string;
  firstName?: string;
  lastName?: string;
  phones?: string[];
  emails?: string[];
  addresses?: MemberAddress[];
  birthdate?: string;
  company?: string;
  jobTitle?: string;
  customFields?: Record<string, unknown>;
}

export interface MemberAddress {
  id?: string;
  addressLine?: string;
  addressLine2?: string;
  city?: string;
  subdivision?: string;
  country?: string;
  postalCode?: string;
}

export interface MemberProfile {
  nickname?: string;
  slug?: string;
  photo?: MemberPhoto;
  coverPhoto?: MemberPhoto;
  title?: string;
}

export interface MemberPhoto {
  id?: string;
  url?: string;
  height?: number;
  width?: number;
  offsetX?: number;
  offsetY?: number;
}

// ============================================
// Product Types (Stores)
// ============================================

export interface Product {
  id: string;
  name: string;
  slug: string;
  visible: boolean;
  productType: 'physical' | 'digital';
  description?: string;
  sku?: string;
  weight?: number;
  weightRange?: WeightRange;
  stock?: Stock;
  price?: Price;
  priceData?: PriceData;
  convertedPriceData?: PriceData;
  priceRange?: PriceRange;
  costAndProfitData?: CostAndProfitData;
  costRange?: CostRange;
  additionalInfoSections?: ProductInfoSection[];
  ribbons?: Ribbon[];
  media?: ProductMedia;
  customTextFields?: CustomTextField[];
  manageVariants?: boolean;
  productOptions?: ProductOption[];
  productPageUrl?: ProductPageUrl;
  numericId?: string;
  inventoryItemId?: string;
  discount?: Discount;
  collectionIds?: string[];
  variants?: ProductVariant[];
  lastUpdated?: string;
  createdDate?: string;
  brand?: string;
}

export interface WeightRange {
  minValue?: number;
  maxValue?: number;
}

export interface Stock {
  trackInventory?: boolean;
  quantity?: number;
  inStock?: boolean;
  inventoryStatus?: 'IN_STOCK' | 'OUT_OF_STOCK' | 'PARTIALLY_OUT_OF_STOCK';
}

export interface Price {
  amount: string;
  currency: string;
  formattedAmount?: string;
}

export interface PriceData {
  currency?: string;
  price?: number;
  discountedPrice?: number;
  formatted?: FormattedPrice;
}

export interface FormattedPrice {
  price?: string;
  discountedPrice?: string;
  pricePerUnit?: string;
}

export interface PriceRange {
  minValue?: number;
  maxValue?: number;
}

export interface CostAndProfitData {
  itemCost?: number;
  formattedItemCost?: string;
  profit?: number;
  formattedProfit?: string;
  profitMargin?: number;
}

export interface CostRange {
  minValue?: number;
  maxValue?: number;
}

export interface ProductInfoSection {
  title?: string;
  description?: string;
}

export interface Ribbon {
  text: string;
}

export interface ProductMedia {
  mainMedia?: MediaItem;
  items?: MediaItem[];
}

export interface MediaItem {
  id?: string;
  title?: string;
  mediaType?: 'IMAGE' | 'VIDEO';
  image?: ImageInfo;
  video?: VideoInfo;
  thumbnail?: ImageInfo;
}

export interface ImageInfo {
  url?: string;
  width?: number;
  height?: number;
  format?: string;
  altText?: string;
}

export interface VideoInfo {
  url?: string;
}

export interface CustomTextField {
  title?: string;
  maxLength?: number;
  mandatory?: boolean;
}

export interface ProductOption {
  id?: string;
  name?: string;
  optionType?: 'DROP_DOWN' | 'COLOR' | 'FREE_TEXT';
  choices?: ProductOptionChoice[];
}

export interface ProductOptionChoice {
  id?: string;
  value?: string;
  description?: string;
  media?: MediaItem;
  inStock?: boolean;
  visible?: boolean;
}

export interface ProductPageUrl {
  base?: string;
  path?: string;
}

export interface Discount {
  type?: 'NONE' | 'AMOUNT' | 'PERCENT';
  value?: number;
}

export interface ProductVariant {
  id?: string;
  choices?: Record<string, string>;
  variant?: VariantData;
  stock?: Stock;
}

export interface VariantData {
  priceData?: PriceData;
  convertedPriceData?: PriceData;
  costAndProfitData?: CostAndProfitData;
  weight?: number;
  sku?: string;
  visible?: boolean;
}

export interface CreateProductRequest {
  name: string;
  productType?: 'physical' | 'digital';
  description?: string;
  sku?: string;
  visible?: boolean;
  price?: number;
  currency?: string;
  weight?: number;
  ribbons?: string[];
  brand?: string;
  manageVariants?: boolean;
  trackInventory?: boolean;
  quantity?: number;
}

export interface UpdateProductRequest {
  name?: string;
  description?: string;
  sku?: string;
  visible?: boolean;
  price?: number;
  weight?: number;
  ribbons?: string[];
  brand?: string;
}

// ============================================
// Order Types (Stores)
// ============================================

export interface Order {
  id: string;
  number: number;
  createdDate: string;
  updatedDate?: string;
  lineItems: OrderLineItem[];
  buyerInfo?: BuyerInfo;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  buyerNote?: string;
  currency?: string;
  weightUnit?: string;
  totals?: OrderTotals;
  billingInfo?: OrderBillingInfo;
  shippingInfo?: OrderShippingInfo;
  activities?: OrderActivity[];
  archived?: boolean;
  channelInfo?: ChannelInfo;
  enteredBy?: EnteredBy;
  lastUpdated?: string;
  numericId?: string;
}

export interface OrderLineItem {
  id?: string;
  productId?: string;
  name?: string;
  quantity?: number;
  price?: string;
  totalPrice?: string;
  sku?: string;
  weight?: number;
  lineItemType?: string;
  options?: OrderLineItemOption[];
  customTextFields?: OrderCustomTextField[];
  fulfillerId?: string;
  mediaItem?: MediaItem;
  discount?: OrderLineItemDiscount;
  tax?: number;
  taxIncludedInPrice?: boolean;
  priceData?: LineItemPriceData;
}

export interface OrderLineItemOption {
  option?: string;
  selection?: string;
}

export interface OrderCustomTextField {
  title?: string;
  value?: string;
}

export interface OrderLineItemDiscount {
  amount?: string;
}

export interface LineItemPriceData {
  price?: string;
  totalPrice?: string;
  taxIncludedInPrice?: boolean;
}

export interface BuyerInfo {
  id?: string;
  type?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
}

export interface OrderTotals {
  subtotal?: string;
  shipping?: string;
  tax?: string;
  discount?: string;
  total?: string;
  weight?: string;
  quantity?: number;
}

export interface OrderBillingInfo {
  address?: Address;
  paymentMethod?: string;
  paymentGatewayTransactionId?: string;
  paymentProviderTransactionId?: string;
  paidDate?: string;
}

export interface OrderShippingInfo {
  deliveryOption?: string;
  estimatedDeliveryTime?: string;
  shipmentDetails?: ShipmentDetails;
  shippingRegion?: string;
  pickupDetails?: PickupDetails;
}

export interface ShipmentDetails {
  address?: Address;
  trackingInfo?: TrackingInfo;
}

export interface TrackingInfo {
  trackingNumber?: string;
  shippingProvider?: string;
  trackingLink?: string;
}

export interface PickupDetails {
  pickupAddress?: Address;
  buyerDetails?: BuyerDetails;
  pickupInstructions?: string;
}

export interface BuyerDetails {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export interface OrderActivity {
  type?: string;
  timestamp?: string;
}

export interface ChannelInfo {
  type?: string;
}

export interface EnteredBy {
  id?: string;
  identityType?: string;
}

export interface UpdateOrderRequest {
  buyerNote?: string;
  archived?: boolean;
}

// ============================================
// Inventory Types (Stores)
// ============================================

export interface InventoryItem {
  id: string;
  productId?: string;
  trackQuantity?: boolean;
  variants?: InventoryVariant[];
  lastUpdated?: string;
  numericId?: string;
  preorderInfo?: PreorderInfo;
}

export interface InventoryVariant {
  variantId?: string;
  inStock?: boolean;
  quantity?: number;
}

export interface PreorderInfo {
  enabled?: boolean;
  message?: string;
  limit?: number;
}

export interface UpdateInventoryRequest {
  trackQuantity?: boolean;
  variants?: InventoryVariantUpdate[];
}

export interface InventoryVariantUpdate {
  variantId: string;
  quantity?: number;
  inStock?: boolean;
}

// ============================================
// Bookings Types
// ============================================

export interface Service {
  id: string;
  scheduleId?: string;
  name: string;
  description?: string;
  category?: ServiceCategory;
  tagLine?: string;
  defaultCapacity?: number;
  media?: ServiceMedia;
  hidden?: boolean;
  form?: ServiceForm;
  payment?: ServicePayment;
  onlineBooking?: OnlineBooking;
  locations?: ServiceLocation[];
  bookingPolicy?: BookingPolicy;
  schedule?: ServiceSchedule;
  staffMemberIds?: string[];
  resourceGroups?: ResourceGroup[];
  conferencing?: ConferencingOptions;
  slug?: string;
  createdDate?: string;
  updatedDate?: string;
}

export interface ServiceCategory {
  id?: string;
  name?: string;
  sortOrder?: number;
}

export interface ServiceMedia {
  mainMedia?: MediaItem;
  items?: MediaItem[];
  coverMedia?: MediaItem;
}

export interface ServiceForm {
  id?: string;
}

export interface ServicePayment {
  rateType?: 'NO_FEE' | 'FIXED' | 'VARIED' | 'CUSTOM';
  fixed?: ServicePaymentFixed;
  varied?: ServicePaymentVaried;
  custom?: ServicePaymentCustom;
  options?: PaymentOptions;
}

export interface ServicePaymentFixed {
  price?: Price;
  deposit?: Price;
}

export interface ServicePaymentVaried {
  defaultPrice?: Price;
  minPrice?: Price;
  maxPrice?: Price;
  deposit?: Price;
}

export interface ServicePaymentCustom {
  description?: string;
}

export interface PaymentOptions {
  online?: boolean;
  inPerson?: boolean;
  pricingPlan?: boolean;
}

export interface OnlineBooking {
  enabled?: boolean;
}

export interface ServiceLocation {
  type?: 'OWNER_BUSINESS' | 'OWNER_CUSTOM' | 'CUSTOM';
  business?: BusinessLocation;
  custom?: CustomLocation;
}

export interface BusinessLocation {
  id?: string;
  name?: string;
  address?: Address;
}

export interface CustomLocation {
  address?: Address;
}

export interface BookingPolicy {
  id?: string;
  name?: string;
}

export interface ServiceSchedule {
  id?: string;
  firstSessionStart?: string;
  lastSessionEnd?: string;
}

export interface ResourceGroup {
  id?: string;
  name?: string;
}

export interface ConferencingOptions {
  enabled?: boolean;
}

export interface Booking {
  id: string;
  bookedEntity?: BookedEntity;
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELED' | 'PENDING_CHECKOUT' | 'PENDING_APPROVAL' | 'DECLINED';
  paymentStatus?: 'NOT_PAID' | 'PAID' | 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED' | 'PENDING' | 'CANCELED' | 'UNDEFINED' | 'PARTIALLY_PAID';
  selectedPaymentOption?: string;
  contactDetails?: BookingContactDetails;
  additionalFields?: BookingField[];
  numberOfParticipants?: number;
  createdDate?: string;
  updatedDate?: string;
  startDate?: string;
  endDate?: string;
  externalCalendarOverrides?: ExternalCalendarOverrides;
  revision?: string;
  extendedFields?: Record<string, unknown>;
}

export interface BookedEntity {
  slot?: BookedSlot;
  schedule?: BookedSchedule;
  title?: string;
  tags?: string[];
}

export interface BookedSlot {
  sessionId?: string;
  serviceId?: string;
  scheduleId?: string;
  startDate?: string;
  endDate?: string;
  timezone?: string;
  resource?: BookedResource;
  location?: ServiceLocation;
}

export interface BookedSchedule {
  scheduleId?: string;
  serviceId?: string;
  timezone?: string;
  firstSessionStart?: string;
  lastSessionEnd?: string;
  location?: ServiceLocation;
}

export interface BookedResource {
  id?: string;
  name?: string;
}

export interface BookingContactDetails {
  contactId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  fullAddress?: Address;
  timeZone?: string;
  countryCode?: string;
}

export interface BookingField {
  fieldId?: string;
  label?: string;
  valueType?: 'SHORT_TEXT' | 'LONG_TEXT' | 'CHECK_BOX';
  value?: string;
}

export interface ExternalCalendarOverrides {
  title?: string;
  description?: string;
}

// ============================================
// Pagination
// ============================================

export interface PagingMetadata {
  count?: number;
  offset?: number;
  total?: number;
  tooManyToCount?: boolean;
  cursors?: Cursors;
}

export interface Cursors {
  next?: string;
  prev?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagingMetadata?: PagingMetadata;
}

// ============================================
// Error Types
// ============================================

export class WixError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WixError';
  }
}

export { WixError as WixApiError };
