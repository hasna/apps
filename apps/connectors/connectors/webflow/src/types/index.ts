export type OutputFormat = 'json' | 'pretty';

export interface WebflowConfig {
  accessToken: string;
  siteId?: string;
}

// Site
export interface Site {
  id: string;
  workspaceId: string;
  displayName: string;
  shortName: string;
  previewUrl: string;
  timeZone: string;
  createdOn: string;
  lastUpdated: string;
  lastPublished: string | null;
  customDomains: CustomDomain[];
  locales: Locale;
  dataCollectionEnabled: boolean;
  dataCollectionType: string;
}

export interface CustomDomain {
  id: string;
  url: string;
  lastPublished: string | null;
}

export interface Locale {
  primary: LocaleInfo;
  secondary: LocaleInfo[];
}

export interface LocaleInfo {
  id: string;
  cmsLocaleId: string;
  enabled: boolean;
  displayName: string;
  redirect: boolean;
  subdirectory: string;
  tag: string;
}

// Collection
export interface Collection {
  id: string;
  displayName: string;
  singularName: string;
  slug: string;
  createdOn: string;
  lastUpdated: string;
  fields: CollectionField[];
}

export interface CollectionField {
  id: string;
  isEditable: boolean;
  isRequired: boolean;
  type: string;
  slug: string;
  displayName: string;
  helpText?: string;
  validations?: Record<string, unknown>;
}

export interface CreateCollectionInput {
  displayName: string;
  singularName: string;
  slug?: string;
  fields?: Partial<CollectionField>[];
}

// Collection Item
export interface CollectionItem {
  id: string;
  cmsLocaleId: string;
  lastPublished: string | null;
  lastUpdated: string;
  createdOn: string;
  isArchived: boolean;
  isDraft: boolean;
  fieldData: Record<string, unknown>;
}

export interface CreateItemInput {
  isArchived?: boolean;
  isDraft?: boolean;
  fieldData: Record<string, unknown>;
}

export interface UpdateItemInput {
  isArchived?: boolean;
  isDraft?: boolean;
  fieldData?: Record<string, unknown>;
}

// Page
export interface Page {
  id: string;
  siteId: string;
  title: string;
  slug: string;
  parentId: string | null;
  collectionId: string | null;
  createdOn: string;
  lastUpdated: string;
  archived: boolean;
  draft: boolean;
  canBranch: boolean;
  seo: PageSeo;
  openGraph: PageOpenGraph;
  localeId: string;
  publishedPath: string;
}

export interface PageSeo {
  title: string;
  description: string;
}

export interface PageOpenGraph {
  title: string;
  titleCopied: boolean;
  description: string;
  descriptionCopied: boolean;
}

// Asset
export interface Asset {
  id: string;
  contentType: string;
  size: number;
  siteId: string;
  hostedUrl: string;
  originalFileName: string;
  displayName: string;
  lastUpdated: string;
  createdOn: string;
  variants?: AssetVariant[];
  altText?: string;
}

export interface AssetVariant {
  hostedUrl: string;
  originalFileName: string;
  displayName: string;
  format: string;
  width: number;
  height: number;
  quality: number;
  error?: string;
}

export interface CreateAssetInput {
  fileName: string;
  fileHash: string;
  parentFolder?: string;
}

export interface UploadAssetDetails {
  uploadUrl: string;
  uploadDetails: Record<string, string>;
}

// Form
export interface Form {
  id: string;
  displayName: string;
  siteId: string;
  siteDomainId: string;
  pageId: string;
  pageName: string;
  responsesCount: number;
  lastSubmitted: string;
  createdOn: string;
  fields: Record<string, FormField>;
}

export interface FormField {
  displayName: string;
  type: string;
  placeholder?: string;
  userVisible: boolean;
}

export interface FormSubmission {
  id: string;
  formId: string;
  siteId: string;
  formResponse: Record<string, unknown>;
  dateSubmitted: string;
}

// User
export interface User {
  id: string;
  isEmailVerified: boolean;
  lastUpdated: string;
  invitedOn: string;
  createdOn: string;
  lastLogin: string | null;
  status: string;
  accessGroups: AccessGroup[];
  data: UserData;
}

export interface AccessGroup {
  slug: string;
  type: string;
}

export interface UserData {
  name: string;
  email: string;
  acceptPrivacy: boolean;
  acceptCommunications: boolean;
}

export interface InviteUserInput {
  email: string;
  accessGroups?: string[];
  data?: Partial<UserData>;
}

// Ecommerce Product
export interface Product {
  id: string;
  cmsLocaleId: string;
  lastPublished: string | null;
  lastUpdated: string;
  createdOn: string;
  isArchived: boolean;
  isDraft: boolean;
  fieldData: ProductFieldData;
  product: ProductDetails;
}

export interface ProductFieldData {
  name: string;
  slug: string;
  description?: string;
  'sku-properties'?: SkuProperty[];
  category?: string[];
  'tax-category'?: string;
  'default-sku'?: string;
  'ec-product-type'?: string;
}

export interface ProductDetails {
  id: string;
  cmsLocaleId: string;
  lastPublished: string | null;
  lastUpdated: string;
  createdOn: string;
  isArchived: boolean;
  isDraft: boolean;
  fieldData: Record<string, unknown>;
}

export interface SkuProperty {
  id: string;
  name: string;
  enum: SkuPropertyEnum[];
}

export interface SkuPropertyEnum {
  id: string;
  name: string;
  slug: string;
}

export interface CreateProductInput {
  isArchived?: boolean;
  isDraft?: boolean;
  fieldData: Partial<ProductFieldData>;
  product?: {
    fieldData: Record<string, unknown>;
  };
}

export interface UpdateProductInput {
  isArchived?: boolean;
  isDraft?: boolean;
  fieldData?: Partial<ProductFieldData>;
}

// SKU
export interface Sku {
  id: string;
  cmsLocaleId: string;
  lastPublished: string | null;
  lastUpdated: string;
  createdOn: string;
  isArchived: boolean;
  isDraft: boolean;
  fieldData: SkuFieldData;
}

export interface SkuFieldData {
  name: string;
  slug: string;
  price: PriceData;
  'compare-at-price'?: PriceData;
  'sku-values'?: Record<string, string>;
  width?: number;
  height?: number;
  length?: number;
  weight?: number;
  quantity?: number;
  'main-image'?: string;
  'more-images'?: string[];
  'download-files'?: DownloadFile[];
}

export interface PriceData {
  value: number;
  unit: string;
}

export interface DownloadFile {
  id: string;
  name: string;
  url: string;
}

// Ecommerce Order
export interface Order {
  orderId: string;
  status: string;
  comment: string;
  orderComment: string;
  acceptedOn: string;
  fulfilledOn: string | null;
  refundedOn: string | null;
  disputedOn: string | null;
  disputeUpdatedOn: string | null;
  disputeLastStatus: string | null;
  customerPaid: PriceData;
  netAmount: PriceData;
  applicationFee: PriceData;
  allAddresses: OrderAddress[];
  shippingAddress: OrderAddress;
  billingAddress: OrderAddress;
  shippingProvider: string | null;
  shippingTracking: string | null;
  shippingTrackingUrl: string | null;
  customerInfo: CustomerInfo;
  purchasedItems: PurchasedItem[];
  purchasedItemsCount: number;
  stripeDetails: StripeDetails;
  stripeCard: StripeCard | null;
  paypalDetails: PaypalDetails | null;
  customData: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  isCustomerDeleted: boolean;
  isShippingRequired: boolean;
  hasDownloads: boolean;
  downloadFiles: DownloadFile[];
  totals: OrderTotals;
}

export interface OrderAddress {
  type: string;
  japanType: string | null;
  addressee: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface CustomerInfo {
  fullName: string;
  email: string;
}

export interface PurchasedItem {
  count: number;
  rowTotal: PriceData;
  productId: string;
  productName: string;
  productSlug: string;
  variantId: string;
  variantName: string;
  variantSlug: string;
  variantSku: string;
  variantPrice: PriceData;
  weight: number | null;
  width: number | null;
  height: number | null;
  length: number | null;
  variantImage: VariantImage;
}

export interface VariantImage {
  url: string;
  file: {
    size: number;
    originalFileName: string;
    createdOn: string;
    contentType: string;
    width: number;
    height: number;
    variants: unknown[];
  };
}

export interface StripeDetails {
  subscriptionId: string | null;
  paymentMethod: string;
  paymentIntentId: string;
  customerId: string;
  chargeId: string;
  disputeId: string | null;
  refundId: string | null;
  refundReason: string | null;
}

export interface StripeCard {
  last4: string;
  brand: string;
  ownerName: string;
  expires: {
    month: number;
    year: number;
  };
}

export interface PaypalDetails {
  orderId: string;
  payerId: string;
  captureId: string;
  refundId: string | null;
  refundReason: string | null;
  disputeId: string | null;
}

export interface OrderTotals {
  subtotal: PriceData;
  extras: OrderExtra[];
  total: PriceData;
}

export interface OrderExtra {
  type: string;
  name: string;
  description: string;
  price: PriceData;
}

export interface UpdateOrderInput {
  comment?: string;
  shippingProvider?: string;
  shippingTracking?: string;
  shippingTrackingUrl?: string;
}

// Pagination
export interface PaginationInfo {
  limit: number;
  offset: number;
  total: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationInfo;
}

// Error
export class WebflowError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WebflowError';
  }
}

// Alias for backwards compatibility
export { WebflowError as WebflowApiError };
