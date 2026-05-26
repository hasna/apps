// Google Ads API Types

// ============================================
// Configuration
// ============================================

export interface GoogleAdsConfig {
  accessToken?: string;
  developerToken?: string;
  customerId?: string;
  loginCustomerId?: string; // For manager accounts
  apiVersion?: string;
}

// ============================================
// OAuth2 Types
// ============================================

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
}

export interface CliConfig {
  clientId?: string;
  clientSecret?: string;
  developerToken?: string;
  defaultCustomerId?: string;
  loginCustomerId?: string;
}

// ============================================
// Common Types
// ============================================

export interface GoogleAdsRow {
  [key: string]: unknown;
}

export interface SearchResponse {
  results: GoogleAdsRow[];
  nextPageToken?: string;
  totalResultsCount?: string;
  fieldMask?: string;
}

export interface MutateResponse {
  results: MutateResult[];
  partialFailureError?: PartialFailureError;
}

export interface MutateResult {
  resourceName: string;
}

export interface PartialFailureError {
  code: number;
  message: string;
  details: unknown[];
}

// ============================================
// Campaign Types
// ============================================

export type CampaignStatus = 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN' | 'UNSPECIFIED';
export type AdvertisingChannelType = 'SEARCH' | 'DISPLAY' | 'SHOPPING' | 'VIDEO' | 'MULTI_CHANNEL' | 'LOCAL' | 'SMART' | 'PERFORMANCE_MAX' | 'DEMAND_GEN' | 'TRAVEL' | 'UNKNOWN' | 'UNSPECIFIED';
export type BiddingStrategyType = 'MANUAL_CPC' | 'MANUAL_CPM' | 'MANUAL_CPV' | 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CONVERSION_VALUE' | 'TARGET_CPA' | 'TARGET_ROAS' | 'TARGET_SPEND' | 'TARGET_IMPRESSION_SHARE' | 'UNKNOWN' | 'UNSPECIFIED';

export interface Campaign {
  resourceName: string;
  id: string;
  name: string;
  status: CampaignStatus;
  advertisingChannelType: AdvertisingChannelType;
  biddingStrategyType?: BiddingStrategyType;
  campaignBudget?: string;
  startDate?: string;
  endDate?: string;
  targetSpend?: {
    targetSpendMicros?: string;
    cpcBidCeilingMicros?: string;
  };
  manualCpc?: {
    enhancedCpcEnabled?: boolean;
  };
  maximizeConversions?: {
    targetCpaMicros?: string;
  };
  maximizeConversionValue?: {
    targetRoas?: number;
  };
}

export interface CampaignBudget {
  resourceName: string;
  id: string;
  name?: string;
  amountMicros: string;
  deliveryMethod?: 'STANDARD' | 'ACCELERATED' | 'UNKNOWN' | 'UNSPECIFIED';
  explicitlyShared?: boolean;
  totalAmountMicros?: string;
  status?: 'ENABLED' | 'REMOVED' | 'UNKNOWN' | 'UNSPECIFIED';
}

// ============================================
// Ad Group Types
// ============================================

export type AdGroupStatus = 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN' | 'UNSPECIFIED';
export type AdGroupType = 'SEARCH_STANDARD' | 'DISPLAY_STANDARD' | 'SHOPPING_PRODUCT_ADS' | 'VIDEO_BUMPER' | 'VIDEO_TRUE_VIEW_IN_STREAM' | 'VIDEO_TRUE_VIEW_IN_DISPLAY' | 'UNKNOWN' | 'UNSPECIFIED';

export interface AdGroup {
  resourceName: string;
  id: string;
  name: string;
  status: AdGroupStatus;
  type: AdGroupType;
  campaign: string;
  cpcBidMicros?: string;
  cpmBidMicros?: string;
  targetCpaMicros?: string;
  targetRoas?: number;
}

// ============================================
// Ad Types
// ============================================

export type AdType = 'TEXT_AD' | 'EXPANDED_TEXT_AD' | 'RESPONSIVE_SEARCH_AD' | 'RESPONSIVE_DISPLAY_AD' | 'IMAGE_AD' | 'VIDEO_AD' | 'CALL_AD' | 'SHOPPING_PRODUCT_AD' | 'UNKNOWN' | 'UNSPECIFIED';
export type AdStatus = 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN' | 'UNSPECIFIED';

export interface Ad {
  resourceName: string;
  id: string;
  type: AdType;
  finalUrls?: string[];
  finalMobileUrls?: string[];
  trackingUrlTemplate?: string;
  displayUrl?: string;
  responsiveSearchAd?: ResponsiveSearchAd;
  responsiveDisplayAd?: ResponsiveDisplayAd;
  callAd?: CallAd;
}

export interface ResponsiveSearchAd {
  headlines: AdTextAsset[];
  descriptions: AdTextAsset[];
  path1?: string;
  path2?: string;
}

export interface ResponsiveDisplayAd {
  marketingImages: AdImageAsset[];
  squareMarketingImages: AdImageAsset[];
  logos: AdImageAsset[];
  squareLogos?: AdImageAsset[];
  headlines: AdTextAsset[];
  longHeadline: AdTextAsset;
  descriptions: AdTextAsset[];
  businessName: string;
}

export interface CallAd {
  countryCode: string;
  phoneNumber: string;
  businessName: string;
  headline1: string;
  headline2: string;
  description1: string;
  description2?: string;
}

export interface AdTextAsset {
  text: string;
  pinnedField?: 'HEADLINE_1' | 'HEADLINE_2' | 'HEADLINE_3' | 'DESCRIPTION_1' | 'DESCRIPTION_2' | 'UNSPECIFIED';
}

export interface AdImageAsset {
  asset: string;
}

export interface AdGroupAd {
  resourceName: string;
  status: AdStatus;
  adGroup: string;
  ad: Ad;
  policySummary?: PolicySummary;
}

export interface PolicySummary {
  approvalStatus: 'APPROVED' | 'APPROVED_LIMITED' | 'AREA_OF_INTEREST_ONLY' | 'DISAPPROVED' | 'UNKNOWN' | 'UNSPECIFIED';
  reviewStatus: 'REVIEW_IN_PROGRESS' | 'REVIEWED' | 'UNDER_APPEAL' | 'ELIGIBLE_MAY_SERVE' | 'UNKNOWN' | 'UNSPECIFIED';
  policyTopicEntries?: PolicyTopicEntry[];
}

export interface PolicyTopicEntry {
  topic: string;
  type: string;
  evidences?: unknown[];
  constraints?: unknown[];
}

// ============================================
// Keyword Types
// ============================================

export type KeywordMatchType = 'EXACT' | 'PHRASE' | 'BROAD' | 'UNKNOWN' | 'UNSPECIFIED';
export type CriterionStatus = 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN' | 'UNSPECIFIED';
export type AdGroupCriterionStatus = CriterionStatus;

// Alias for easier usage
export type Keyword = AdGroupCriterion;

export interface AdGroupCriterion {
  resourceName: string;
  criterionId: string;
  adGroup: string;
  status: CriterionStatus;
  keyword?: {
    text: string;
    matchType: KeywordMatchType;
  };
  qualityInfo?: {
    qualityScore?: number;
    creativityScore?: 'BELOW_AVERAGE' | 'AVERAGE' | 'ABOVE_AVERAGE' | 'UNKNOWN' | 'UNSPECIFIED';
    postClickQualityScore?: 'BELOW_AVERAGE' | 'AVERAGE' | 'ABOVE_AVERAGE' | 'UNKNOWN' | 'UNSPECIFIED';
    searchPredictedCtr?: 'BELOW_AVERAGE' | 'AVERAGE' | 'ABOVE_AVERAGE' | 'UNKNOWN' | 'UNSPECIFIED';
  };
  cpcBidMicros?: string;
  effectiveCpcBidMicros?: string;
  finalUrls?: string[];
}

// ============================================
// Asset Types
// ============================================

export type AssetType = 'TEXT' | 'IMAGE' | 'MEDIA_BUNDLE' | 'YOUTUBE_VIDEO' | 'LEAD_FORM' | 'BOOK_ON_GOOGLE' | 'PROMOTION' | 'CALLOUT' | 'STRUCTURED_SNIPPET' | 'SITELINK' | 'PAGE_FEED' | 'DYNAMIC_EDUCATION' | 'MOBILE_APP' | 'HOTEL_CALLOUT' | 'CALL' | 'PRICE' | 'CALL_TO_ACTION' | 'DYNAMIC_REAL_ESTATE' | 'DYNAMIC_CUSTOM' | 'DYNAMIC_HOTELS_AND_RENTALS' | 'DYNAMIC_FLIGHTS' | 'DYNAMIC_TRAVEL' | 'DYNAMIC_LOCAL' | 'DYNAMIC_JOBS' | 'LOCATION' | 'HOTEL_PROPERTY' | 'UNKNOWN' | 'UNSPECIFIED';

export interface Asset {
  resourceName: string;
  id: string;
  name?: string;
  type: AssetType;
  finalUrls?: string[];
  textAsset?: { text: string };
  imageAsset?: { data: string; fileSize: string; mimeType: string; fullSize?: ImageDimension };
  youtubeVideoAsset?: { youtubeVideoId: string; youtubeVideoTitle?: string };
  sitelinkAsset?: { linkText: string; description1?: string; description2?: string };
  callAsset?: { countryCode: string; phoneNumber: string; callConversionAction?: string };
  calloutAsset?: { calloutText: string };
  structuredSnippetAsset?: { header: string; values: string[] };
  leadFormAsset?: LeadFormAsset;
}

export interface ImageDimension {
  heightPixels: string;
  widthPixels: string;
  url: string;
}

export interface LeadFormAsset {
  businessName: string;
  callToActionType: string;
  callToActionDescription: string;
  headline: string;
  description: string;
  privacyPolicyUrl: string;
  fields: LeadFormField[];
}

export interface LeadFormField {
  inputType: string;
  singleChoiceAnswers?: { answers: string[] };
}

// ============================================
// Conversion Types
// ============================================

export type ConversionActionCategory = 'DEFAULT' | 'PAGE_VIEW' | 'PURCHASE' | 'SIGNUP' | 'LEAD' | 'DOWNLOAD' | 'ADD_TO_CART' | 'BEGIN_CHECKOUT' | 'SUBSCRIBE_PAID' | 'PHONE_CALL_LEAD' | 'IMPORTED_LEAD' | 'SUBMIT_LEAD_FORM' | 'BOOK_APPOINTMENT' | 'REQUEST_QUOTE' | 'GET_DIRECTIONS' | 'OUTBOUND_CLICK' | 'CONTACT' | 'ENGAGEMENT' | 'STORE_VISIT' | 'STORE_SALE' | 'QUALIFIED_LEAD' | 'CONVERTED_LEAD' | 'UNKNOWN' | 'UNSPECIFIED';
export type ConversionActionType = 'AD_CALL' | 'CLICK_TO_CALL' | 'GOOGLE_PLAY_DOWNLOAD' | 'GOOGLE_PLAY_IN_APP_PURCHASE' | 'UPLOAD_CALLS' | 'UPLOAD_CLICKS' | 'WEBPAGE' | 'WEBSITE_CALL' | 'STORE_SALES_DIRECT_UPLOAD' | 'STORE_SALES' | 'FIREBASE_ANDROID_FIRST_OPEN' | 'FIREBASE_ANDROID_IN_APP_PURCHASE' | 'FIREBASE_ANDROID_CUSTOM' | 'FIREBASE_IOS_FIRST_OPEN' | 'FIREBASE_IOS_IN_APP_PURCHASE' | 'FIREBASE_IOS_CUSTOM' | 'THIRD_PARTY_APP_ANALYTICS_ANDROID_FIRST_OPEN' | 'THIRD_PARTY_APP_ANALYTICS_ANDROID_IN_APP_PURCHASE' | 'THIRD_PARTY_APP_ANALYTICS_ANDROID_CUSTOM' | 'THIRD_PARTY_APP_ANALYTICS_IOS_FIRST_OPEN' | 'THIRD_PARTY_APP_ANALYTICS_IOS_IN_APP_PURCHASE' | 'THIRD_PARTY_APP_ANALYTICS_IOS_CUSTOM' | 'ANDROID_APP_PRE_REGISTRATION' | 'ANDROID_INSTALLS_ALL_OTHER_APPS' | 'FLOODLIGHT_ACTION' | 'FLOODLIGHT_TRANSACTION' | 'GOOGLE_HOSTED' | 'LEAD_FORM_SUBMIT' | 'SALESFORCE' | 'SEARCH_ADS_360' | 'SMART_CAMPAIGN_AD_CLICKS_TO_CALL' | 'SMART_CAMPAIGN_MAP_CLICKS_TO_CALL' | 'SMART_CAMPAIGN_MAP_DIRECTIONS' | 'SMART_CAMPAIGN_TRACKED_CALLS' | 'STORE_VISITS' | 'WEBPAGE_CODELESS' | 'UNKNOWN' | 'UNSPECIFIED';

export interface ConversionAction {
  resourceName: string;
  id: string;
  name: string;
  status: 'ENABLED' | 'REMOVED' | 'HIDDEN' | 'UNKNOWN' | 'UNSPECIFIED';
  type: ConversionActionType;
  category: ConversionActionCategory;
  valueSettings?: {
    defaultValue?: number;
    defaultCurrencyCode?: string;
    alwaysUseDefaultValue?: boolean;
  };
  attributionModelSettings?: {
    attributionModel: string;
    dataDrivenModelStatus?: string;
  };
  countingType?: 'ONE_PER_CLICK' | 'MANY_PER_CLICK' | 'UNKNOWN' | 'UNSPECIFIED';
  clickThroughLookbackWindowDays?: number;
  viewThroughLookbackWindowDays?: number;
  includeInConversionsMetric?: boolean;
}

// ============================================
// Audience Types
// ============================================

export interface UserList {
  resourceName: string;
  id: string;
  name: string;
  description?: string;
  membershipStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN' | 'UNSPECIFIED';
  membershipLifeSpan?: string;
  sizeForDisplay?: string;
  sizeForSearch?: string;
  type: 'REMARKETING' | 'LOGICAL' | 'EXTERNAL_REMARKETING' | 'RULE_BASED' | 'SIMILAR' | 'CRM_BASED' | 'UNKNOWN' | 'UNSPECIFIED';
  closingReason?: 'UNUSED' | 'UNKNOWN' | 'UNSPECIFIED';
}

// Alias for easier usage
export type Audience = UserList;

// ============================================
// Metrics Types
// ============================================

export interface Metrics {
  impressions?: string;
  clicks?: string;
  costMicros?: string;
  conversions?: number;
  conversionsValue?: number;
  allConversions?: number;
  allConversionsValue?: number;
  ctr?: number;
  averageCpc?: number;
  averageCpm?: number;
  averageCpv?: number;
  videoViews?: string;
  videoViewRate?: number;
  interactionRate?: number;
  engagementRate?: number;
  absoluteTopImpressionPercentage?: number;
  topImpressionPercentage?: number;
  searchImpressionShare?: number;
  searchRankLostImpressionShare?: number;
  searchBudgetLostImpressionShare?: number;
}

// ============================================
// Customer Types
// ============================================

export interface Customer {
  resourceName: string;
  id: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  trackingUrlTemplate?: string;
  autoTaggingEnabled?: boolean;
  hasPartnersBadge?: boolean;
  manager?: boolean;
  testAccount?: boolean;
  conversionTrackingId?: string;
}

export interface CustomerClient {
  resourceName: string;
  clientCustomer: string;
  hidden?: boolean;
  level?: string;
  timeZone?: string;
  testAccount?: boolean;
  manager?: boolean;
  descriptiveName?: string;
  currencyCode?: string;
  id?: string;
}

// ============================================
// API Error Types
// ============================================

export interface GoogleAdsApiErrorDetail {
  errorCode: {
    [key: string]: string;
  };
  message: string;
  trigger?: {
    stringValue?: string;
  };
  location?: {
    fieldPathElements?: Array<{
      fieldName: string;
      index?: number;
    }>;
  };
}

export interface GoogleAdsApiError {
  error: {
    code: number;
    message: string;
    status: string;
    details?: Array<{
      '@type': string;
      errors?: GoogleAdsApiErrorDetail[];
      requestId?: string;
    }>;
  };
}

export class GoogleAdsError extends Error {
  public readonly statusCode: number;
  public readonly errors?: GoogleAdsApiErrorDetail[];
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, errors?: GoogleAdsApiErrorDetail[], requestId?: string) {
    super(message);
    this.name = 'GoogleAdsError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.requestId = requestId;
  }
}
