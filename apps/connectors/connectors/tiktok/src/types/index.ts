// TikTok Marketing API Types
// Marketing API for TikTok advertising

// ============================================
// Configuration
// ============================================

export interface TikTokConfig {
  accessToken: string;
  advertiserId?: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface TikTokApiResponse<T> {
  code: number;
  message: string;
  request_id: string;
  data: T;
}

export interface PaginatedData<T> {
  list: T[];
  page_info: PageInfo;
}

export interface PageInfo {
  page: number;
  page_size: number;
  total_number: number;
  total_page: number;
}

// ISO 8601 date string
export type DateString = string;

// ============================================
// Advertiser Types
// ============================================

export type AdvertiserStatus = 'STATUS_ENABLE' | 'STATUS_DISABLE' | 'STATUS_PENDING_CONFIRM' | 'STATUS_PENDING_VERIFIED' | 'STATUS_CONFIRM_FAIL' | 'STATUS_CONFIRM_FAIL_END' | 'STATUS_LIMIT' | 'STATUS_WAIT_FOR_BPM_AUDIT' | 'STATUS_WAIT_FOR_PUBLIC_AUTH' | 'STATUS_SELF_SERVICE_UNAUDITED' | 'STATUS_CONTRACT_PENDING';

export interface Advertiser {
  advertiser_id: string;
  advertiser_name: string;
  status: AdvertiserStatus;
  description?: string;
  create_time: string;
  address?: string;
  company?: string;
  contacter?: string;
  email?: string;
  phone_number?: string;
  license_no?: string;
  license_province?: string;
  license_city?: string;
  country?: string;
  currency?: string;
  timezone?: string;
  language?: string;
  balance?: number;
  industry?: string;
  brand?: string;
  promotion_area?: string;
  role?: string;
  reason?: string;
}

export interface AdvertiserUpdateParams {
  advertiser_id: string;
  advertiser_name?: string;
  company?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
}

// ============================================
// Campaign Types
// ============================================

export type CampaignObjective =
  | 'REACH'
  | 'TRAFFIC'
  | 'VIDEO_VIEWS'
  | 'ENGAGEMENT'
  | 'APP_PROMOTION'
  | 'LEAD_GENERATION'
  | 'WEBSITE_CONVERSIONS'
  | 'PRODUCT_SALES'
  | 'RF_REACH';

export type CampaignStatus =
  | 'CAMPAIGN_STATUS_NOT_DELETE'
  | 'CAMPAIGN_STATUS_DELETE'
  | 'CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY'
  | 'CAMPAIGN_STATUS_ADVERTISER_AUDIT';

export type OperationStatus =
  | 'ENABLE'
  | 'DISABLE';

export type BudgetMode = 'BUDGET_MODE_INFINITE' | 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL';

export interface Campaign {
  campaign_id: string;
  campaign_name: string;
  advertiser_id: string;
  objective_type: CampaignObjective;
  status: CampaignStatus;
  operation_status: OperationStatus;
  budget_mode: BudgetMode;
  budget?: number;
  roas_bid?: number;
  deep_bid_type?: string;
  is_search_campaign?: boolean;
  is_smart_performance_campaign?: boolean;
  app_promotion_type?: string;
  create_time: string;
  modify_time: string;
  is_new_structure?: boolean;
  campaign_type?: string;
  campaign_app_profile_page_state?: string;
  objective?: string;
}

export interface CampaignCreateParams {
  advertiser_id: string;
  campaign_name: string;
  objective_type: CampaignObjective;
  budget_mode?: BudgetMode;
  budget?: number;
  operation_status?: OperationStatus;
  special_industries?: string[];
  app_promotion_type?: 'APP_INSTALL' | 'APP_RETARGETING';
  campaign_type?: 'REGULAR_CAMPAIGN' | 'GMV_MAX_CAMPAIGN';
  rf_campaign_type?: 'STANDARD' | 'RESERVED';
}

export interface CampaignUpdateParams {
  advertiser_id: string;
  campaign_id: string;
  campaign_name?: string;
  budget_mode?: BudgetMode;
  budget?: number;
  operation_status?: OperationStatus;
  special_industries?: string[];
}

export interface CampaignListParams {
  advertiser_id: string;
  filtering?: {
    campaign_ids?: string[];
    campaign_name?: string;
    objective_type?: CampaignObjective;
    primary_status?: string;
    secondary_status?: string;
  };
  page?: number;
  page_size?: number;
  fields?: string[];
}

// ============================================
// Ad Group Types
// ============================================

export type AdGroupStatus =
  | 'ADGROUP_STATUS_ALL'
  | 'ADGROUP_STATUS_DELETE'
  | 'ADGROUP_STATUS_NOT_DELETE'
  | 'ADGROUP_STATUS_CAMPAIGN_DELETE'
  | 'ADGROUP_STATUS_ADVERTISER_AUDIT_DENY'
  | 'ADGROUP_STATUS_ADVERTISER_AUDIT';

export type PlacementType =
  | 'PLACEMENT_TYPE_AUTOMATIC'
  | 'PLACEMENT_TYPE_NORMAL';

export type PromotionType =
  | 'WEBSITE'
  | 'APP_ANDROID'
  | 'APP_IOS';

export type BillingEvent =
  | 'CPC'
  | 'CPM'
  | 'CPV'
  | 'OCPM';

export type BidStrategy =
  | 'BID_TYPE_CUSTOM'
  | 'BID_TYPE_NO_BID';

export type OptimizationGoal =
  | 'CLICK'
  | 'CONVERT'
  | 'INSTALL'
  | 'REACH'
  | 'SHOW'
  | 'ENGAGED_VIEW'
  | 'VIDEO_VIEW'
  | 'VALUE';

export type ScheduleType =
  | 'SCHEDULE_FROM_NOW'
  | 'SCHEDULE_START_END';

export type PacingMode =
  | 'PACING_MODE_SMOOTH'
  | 'PACING_MODE_FAST';

export interface AdGroup {
  adgroup_id: string;
  adgroup_name: string;
  advertiser_id: string;
  campaign_id: string;
  status: AdGroupStatus;
  operation_status: OperationStatus;
  placement_type: PlacementType;
  placements?: string[];
  promotion_type?: PromotionType;
  billing_event: BillingEvent;
  bid_type: BidStrategy;
  bid_price?: number;
  optimization_goal: OptimizationGoal;
  budget_mode: BudgetMode;
  budget?: number;
  schedule_type: ScheduleType;
  schedule_start_time?: string;
  schedule_end_time?: string;
  dayparting?: string;
  pacing?: PacingMode;
  pixel_id?: string;
  optimization_event?: string;
  deep_bid_type?: string;
  deep_cpa_bid?: number;
  roas_bid?: number;
  create_time: string;
  modify_time: string;
  // Targeting
  age_groups?: string[];
  gender?: string;
  languages?: string[];
  location_ids?: string[];
  interest_category_ids?: string[];
  interest_keyword_ids?: string[];
  device_model_ids?: string[];
  device_price_ranges?: string[];
  operating_systems?: string[];
  network_types?: string[];
  carriers?: string[];
  household_income?: string[];
  spending_power?: string[];
  audience_ids?: string[];
  excluded_audience_ids?: string[];
}

export interface AdGroupCreateParams {
  advertiser_id: string;
  campaign_id: string;
  adgroup_name: string;
  placement_type?: PlacementType;
  placements?: string[];
  promotion_type?: PromotionType;
  promotion_website_type?: string;
  billing_event: BillingEvent;
  bid_type?: BidStrategy;
  bid_price?: number;
  optimization_goal: OptimizationGoal;
  budget_mode?: BudgetMode;
  budget?: number;
  schedule_type?: ScheduleType;
  schedule_start_time?: string;
  schedule_end_time?: string;
  dayparting?: string;
  pacing?: PacingMode;
  pixel_id?: string;
  optimization_event?: string;
  deep_bid_type?: string;
  deep_cpa_bid?: number;
  roas_bid?: number;
  conversion_bid_price?: number;
  // Targeting
  age_groups?: string[];
  gender?: 'GENDER_UNLIMITED' | 'GENDER_MALE' | 'GENDER_FEMALE';
  languages?: string[];
  location_ids?: string[];
  interest_category_ids?: string[];
  interest_keyword_ids?: string[];
  device_model_ids?: string[];
  device_price_ranges?: string[];
  operating_systems?: string[];
  network_types?: string[];
  carriers?: string[];
  household_income?: string[];
  spending_power?: string[];
  audience_ids?: string[];
  excluded_audience_ids?: string[];
  identity_id?: string;
  identity_type?: 'CUSTOMIZED_USER' | 'AUTH_CODE' | 'TT_USER' | 'BC_AUTH_TT';
  app_id?: string;
  external_action?: string;
}

export interface AdGroupUpdateParams {
  advertiser_id: string;
  adgroup_id: string;
  adgroup_name?: string;
  operation_status?: OperationStatus;
  budget?: number;
  schedule_start_time?: string;
  schedule_end_time?: string;
  bid_price?: number;
  conversion_bid_price?: number;
  deep_cpa_bid?: number;
  roas_bid?: number;
  dayparting?: string;
  // Targeting updates
  age_groups?: string[];
  gender?: string;
  languages?: string[];
  location_ids?: string[];
  interest_category_ids?: string[];
  interest_keyword_ids?: string[];
  audience_ids?: string[];
  excluded_audience_ids?: string[];
}

export interface AdGroupListParams {
  advertiser_id: string;
  filtering?: {
    campaign_ids?: string[];
    adgroup_ids?: string[];
    adgroup_name?: string;
    primary_status?: string;
    secondary_status?: string;
  };
  page?: number;
  page_size?: number;
  fields?: string[];
}

// ============================================
// Ad Types
// ============================================

export type AdStatus =
  | 'AD_STATUS_ALL'
  | 'AD_STATUS_DELETE'
  | 'AD_STATUS_NOT_DELETE'
  | 'AD_STATUS_ADGROUP_DELETE'
  | 'AD_STATUS_CAMPAIGN_DELETE'
  | 'AD_STATUS_ADVERTISER_AUDIT_DENY'
  | 'AD_STATUS_ADVERTISER_AUDIT';

export type AdFormat =
  | 'SINGLE_IMAGE'
  | 'SINGLE_VIDEO'
  | 'CAROUSEL';

export type CallToAction =
  | 'APPLY_NOW'
  | 'BOOK_NOW'
  | 'BUY_TICKETS'
  | 'CALL_NOW'
  | 'CONTACT_US'
  | 'DOWNLOAD'
  | 'GET_DIRECTIONS'
  | 'GET_QUOTE'
  | 'GET_SHOWTIMES'
  | 'INSTALL_NOW'
  | 'INTERESTED'
  | 'LEARN_MORE'
  | 'LISTEN_NOW'
  | 'ORDER_NOW'
  | 'PLAY_GAME'
  | 'READ_MORE'
  | 'SHOP_NOW'
  | 'SIGN_UP'
  | 'SUBSCRIBE'
  | 'VIEW_NOW'
  | 'WATCH_MORE';

export interface Ad {
  ad_id: string;
  ad_name: string;
  advertiser_id: string;
  campaign_id: string;
  adgroup_id: string;
  status: AdStatus;
  operation_status: OperationStatus;
  ad_format: AdFormat;
  ad_text: string;
  landing_page_url?: string;
  display_name?: string;
  profile_image_url?: string;
  call_to_action?: CallToAction;
  call_to_action_id?: string;
  app_name?: string;
  image_ids?: string[];
  video_id?: string;
  image_mode?: string;
  is_aco?: boolean;
  is_creative_authorized?: boolean;
  playable_url?: string;
  vast_moat_enabled?: boolean;
  identity_id?: string;
  identity_type?: string;
  page_id?: string;
  brand_safety_postbid_partner?: string;
  brand_safety_vast_url?: string;
  viewability_postbid_partner?: string;
  viewability_vast_url?: string;
  create_time: string;
  modify_time: string;
}

export interface AdCreateParams {
  advertiser_id: string;
  adgroup_id: string;
  ad_name: string;
  ad_format?: AdFormat;
  ad_text: string;
  landing_page_url?: string;
  display_name?: string;
  profile_image?: string;
  call_to_action?: CallToAction;
  call_to_action_id?: string;
  app_name?: string;
  image_ids?: string[];
  video_id?: string;
  playable_url?: string;
  identity_id?: string;
  identity_type?: 'CUSTOMIZED_USER' | 'AUTH_CODE' | 'TT_USER' | 'BC_AUTH_TT';
  tiktok_item_id?: string;
  page_id?: string;
  deeplink?: string;
  deeplink_type?: string;
  fallback_type?: string;
  vast_moat_enabled?: boolean;
  brand_safety_postbid_partner?: string;
  brand_safety_vast_url?: string;
  viewability_postbid_partner?: string;
  viewability_vast_url?: string;
}

export interface AdUpdateParams {
  advertiser_id: string;
  ad_id: string;
  ad_name?: string;
  ad_text?: string;
  landing_page_url?: string;
  display_name?: string;
  call_to_action?: CallToAction;
  operation_status?: OperationStatus;
}

export interface AdListParams {
  advertiser_id: string;
  filtering?: {
    campaign_ids?: string[];
    adgroup_ids?: string[];
    ad_ids?: string[];
    ad_name?: string;
    primary_status?: string;
    secondary_status?: string;
  };
  page?: number;
  page_size?: number;
  fields?: string[];
}

// ============================================
// Creative Types
// ============================================

export interface ImageInfo {
  image_id: string;
  material_id?: string;
  width: number;
  height: number;
  size: number;
  format: string;
  url: string;
  signature?: string;
  file_name?: string;
}

export interface VideoInfo {
  video_id: string;
  material_id?: string;
  width: number;
  height: number;
  size: number;
  format: string;
  duration: number;
  url: string;
  preview_url?: string;
  poster_url?: string;
  display_name?: string;
  bit_rate?: number;
  signature?: string;
  file_name?: string;
  allow_download?: boolean;
  allowed_placements?: string[];
}

export interface ImageUploadParams {
  advertiser_id: string;
  upload_type?: 'UPLOAD_BY_FILE' | 'UPLOAD_BY_URL' | 'UPLOAD_BY_FILE_ID';
  image_file?: Blob;
  image_url?: string;
  file_id?: string;
  file_name?: string;
}

export interface VideoUploadParams {
  advertiser_id: string;
  upload_type?: 'UPLOAD_BY_FILE' | 'UPLOAD_BY_URL' | 'UPLOAD_BY_FILE_ID';
  video_file?: Blob;
  video_url?: string;
  file_id?: string;
  file_name?: string;
  flaw_detect?: boolean;
  auto_fix_enabled?: boolean;
  auto_bind_enabled?: boolean;
}

// ============================================
// Audience Types
// ============================================

export type AudienceType =
  | 'CUSTOM_AUDIENCE'
  | 'LOOKALIKE_AUDIENCE'
  | 'SAVED_AUDIENCE';

export type CustomAudienceSubType =
  | 'CUSTOMER_FILE'
  | 'ENGAGEMENT'
  | 'APP_ACTIVITY'
  | 'LEAD_GEN'
  | 'BUSINESS_ACCOUNT'
  | 'SHOP_ACTIVITY'
  | 'OFFLINE_ACTIVITY'
  | 'WEBSITE_TRAFFIC';

export type AudienceStatus =
  | 'PROCESSING'
  | 'READY'
  | 'EXPIRED'
  | 'FAILED';

export interface Audience {
  audience_id: string;
  name: string;
  advertiser_id: string;
  audience_type: AudienceType;
  audience_sub_type?: CustomAudienceSubType;
  status: AudienceStatus;
  cover_num: number;
  calculate_type?: string;
  create_time: string;
  modify_time: string;
  is_expiring?: boolean;
  is_expired?: boolean;
  expire_time?: string;
  rules?: AudienceRule[];
  lookalike_source_audience_id?: string;
  lookalike_spec?: LookalikeSpec;
}

export interface AudienceRule {
  rule_type: string;
  retention_days?: number;
  value?: string[];
  filters?: AudienceFilter[];
}

export interface AudienceFilter {
  field: string;
  operator: string;
  value: string;
}

export interface LookalikeSpec {
  location_ids?: string[];
  audience_size?: 'NARROW' | 'BALANCED' | 'BROAD';
  include_source?: boolean;
}

export interface AudienceCreateParams {
  advertiser_id: string;
  audience_name: string;
  audience_type?: AudienceType;
  custom_audience_type?: CustomAudienceSubType;
  file_paths?: string[];
  id_type?: 'DEVICE_ID' | 'AAID' | 'IDFA' | 'EMAIL' | 'PHONE';
  retention_in_days?: number;
  rules?: AudienceRule[];
  // For lookalike
  source_audience_id?: string;
  lookalike_spec?: LookalikeSpec;
}

export interface AudienceUpdateParams {
  advertiser_id: string;
  audience_id: string;
  audience_name?: string;
  action?: 'APPEND' | 'REMOVE' | 'REPLACE';
  file_paths?: string[];
}

export interface AudienceListParams {
  advertiser_id: string;
  filtering?: {
    audience_ids?: string[];
  };
  page?: number;
  page_size?: number;
}

// ============================================
// Targeting Types
// ============================================

export interface TargetingCategory {
  id: string;
  name: string;
  parent_id?: string;
  level?: number;
  type?: string;
}

export interface Location {
  location_id: string;
  name: string;
  level: 'COUNTRY' | 'STATE' | 'CITY' | 'REGION' | 'DMA';
  parent_id?: string;
  path_ids?: string[];
}

export interface Interest {
  interest_id: string;
  interest_name: string;
  parent_id?: string;
  level?: number;
  audience_size?: number;
}

export interface DeviceModel {
  device_model_id: string;
  device_model_name: string;
  brand?: string;
}

export interface Language {
  language_code: string;
  language_name: string;
}

export interface Carrier {
  carrier_id: string;
  carrier_name: string;
  country_code?: string;
}

// ============================================
// Report Types
// ============================================

export type ReportType =
  | 'BASIC'
  | 'AUDIENCE'
  | 'PLAYABLE'
  | 'CATALOG';

export type DataLevel =
  | 'AUCTION_ADVERTISER'
  | 'AUCTION_CAMPAIGN'
  | 'AUCTION_ADGROUP'
  | 'AUCTION_AD';

export type ReportDimension =
  | 'advertiser_id'
  | 'campaign_id'
  | 'adgroup_id'
  | 'ad_id'
  | 'stat_time_day'
  | 'stat_time_hour'
  | 'country_code'
  | 'province_id'
  | 'dma_id'
  | 'gender'
  | 'age'
  | 'platform'
  | 'ac'
  | 'language';

export type ReportMetric =
  | 'spend'
  | 'impressions'
  | 'clicks'
  | 'ctr'
  | 'cpc'
  | 'cpm'
  | 'reach'
  | 'frequency'
  | 'conversion'
  | 'cost_per_conversion'
  | 'conversion_rate'
  | 'video_play_actions'
  | 'video_watched_2s'
  | 'video_watched_6s'
  | 'video_views_p25'
  | 'video_views_p50'
  | 'video_views_p75'
  | 'video_views_p100'
  | 'average_video_play'
  | 'engaged_view'
  | 'engaged_view_15s'
  | 'profile_visits'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'follows'
  | 'real_time_conversion'
  | 'real_time_cost_per_conversion'
  | 'total_purchase_value'
  | 'total_sales_lead_value'
  | 'total_onsite_shopping_value'
  | 'roas'
  | 'skan_conversion'
  | 'skan_cost_per_conversion';

export interface ReportParams {
  advertiser_id: string;
  report_type?: ReportType;
  data_level: DataLevel;
  dimensions: ReportDimension[];
  metrics: ReportMetric[];
  start_date: string;
  end_date: string;
  lifetime?: boolean;
  filtering?: {
    campaign_ids?: string[];
    adgroup_ids?: string[];
    ad_ids?: string[];
  };
  page?: number;
  page_size?: number;
  order_field?: string;
  order_type?: 'ASC' | 'DESC';
}

export interface ReportData {
  dimensions: Record<string, string>;
  metrics: Record<string, number | string>;
}

// ============================================
// Business Center Types
// ============================================

export type BusinessCenterRole =
  | 'ADMIN'
  | 'ANALYST'
  | 'OPERATOR';

export interface BusinessCenter {
  bc_id: string;
  bc_name: string;
  status: string;
  user_role: BusinessCenterRole;
  created_time: string;
}

export interface BusinessCenterMember {
  user_id: string;
  user_email: string;
  user_name?: string;
  role: BusinessCenterRole;
  status: string;
  created_time: string;
}

export interface BusinessCenterAsset {
  asset_id: string;
  asset_type: 'ADVERTISER' | 'CATALOG' | 'PIXEL' | 'TIKTOK_ACCOUNT';
  asset_name?: string;
  status: string;
  created_time: string;
}

// ============================================
// Pixel Types
// ============================================

export type PixelType =
  | 'STANDARD'
  | 'ADVANCED_MATCHING';

export interface Pixel {
  pixel_id: string;
  pixel_name: string;
  pixel_code?: string;
  advertiser_id: string;
  advanced_matching_enabled: boolean;
  status: string;
  create_time: string;
}

export interface PixelCreateParams {
  advertiser_id: string;
  pixel_name: string;
  advanced_matching?: boolean;
}

export interface PixelUpdateParams {
  advertiser_id: string;
  pixel_id: string;
  pixel_name?: string;
  advanced_matching?: boolean;
}

// ============================================
// Events API Types
// ============================================

export type EventType =
  | 'AddPaymentInfo'
  | 'AddToCart'
  | 'AddToWishlist'
  | 'ClickButton'
  | 'CompletePayment'
  | 'CompleteRegistration'
  | 'Contact'
  | 'Download'
  | 'InitiateCheckout'
  | 'PlaceAnOrder'
  | 'Search'
  | 'SubmitForm'
  | 'Subscribe'
  | 'ViewContent';

export interface EventProperties {
  contents?: EventContent[];
  content_type?: 'product' | 'product_group';
  currency?: string;
  value?: number;
  query?: string;
  description?: string;
  status?: string;
}

export interface EventContent {
  content_id?: string;
  content_type?: string;
  content_name?: string;
  content_category?: string;
  quantity?: number;
  price?: number;
  brand?: string;
}

export interface EventUser {
  ttclid?: string;
  external_id?: string;
  phone?: string;
  email?: string;
  ttp?: string;
  ip?: string;
  user_agent?: string;
  locale?: string;
}

export interface EventContext {
  user_agent?: string;
  ip?: string;
  page?: {
    url?: string;
    referrer?: string;
  };
  ad?: {
    callback?: string;
  };
}

export interface Event {
  event: EventType;
  event_time: number;
  event_id?: string;
  user: EventUser;
  properties?: EventProperties;
  page?: {
    url?: string;
    referrer?: string;
  };
  test_event_code?: string;
}

export interface EventTrackParams {
  pixel_code: string;
  event: EventType;
  event_id?: string;
  timestamp?: number;
  context?: EventContext;
  properties?: EventProperties;
  user?: EventUser;
  test_event_code?: string;
}

export interface BatchEventParams {
  pixel_code: string;
  batch: Event[];
  test_event_code?: string;
}

// ============================================
// Catalog Types
// ============================================

export type CatalogType =
  | 'PRODUCT'
  | 'VEHICLE'
  | 'HOTEL'
  | 'FLIGHT'
  | 'DESTINATION'
  | 'HOME_LISTING';

export interface Catalog {
  catalog_id: string;
  catalog_name: string;
  bc_id: string;
  catalog_type: CatalogType;
  product_quantity?: number;
  status: string;
  create_time: string;
  modify_time: string;
}

export interface CatalogCreateParams {
  bc_id: string;
  catalog_name: string;
  catalog_type?: CatalogType;
  vertical_type?: string;
}

export interface ProductSet {
  product_set_id: string;
  product_set_name: string;
  catalog_id: string;
  product_quantity?: number;
  status: string;
  create_time: string;
}

export interface Product {
  sku_id: string;
  title: string;
  description?: string;
  availability: string;
  condition?: string;
  price: number;
  sale_price?: number;
  currency: string;
  image_link: string;
  additional_image_link?: string[];
  link: string;
  mobile_link?: string;
  brand?: string;
  google_product_category?: string;
  product_type?: string;
  item_group_id?: string;
  gender?: string;
  age_group?: string;
  color?: string;
  size?: string;
}

export interface FeedCreateParams {
  bc_id: string;
  catalog_id: string;
  feed_name: string;
  feed_type: 'URL' | 'FILE' | 'API';
  fetch_url?: string;
  file_path?: string;
  schedule_type?: 'DAILY' | 'HOURLY' | 'WEEKLY';
  schedule_hour?: number;
}

// ============================================
// Identity Types
// ============================================

export interface TikTokIdentity {
  identity_id: string;
  identity_type: 'CUSTOMIZED_USER' | 'AUTH_CODE' | 'TT_USER' | 'BC_AUTH_TT';
  identity_name?: string;
  display_name?: string;
  profile_image?: string;
  is_authorized?: boolean;
  authorized_adgroup_count?: number;
  create_time: string;
}

export interface SparkAdPost {
  item_id: string;
  identity_id: string;
  tiktok_item_id: string;
  video_id?: string;
  post_status: string;
  is_authorized: boolean;
  create_time: string;
}

export interface IdentityCreateParams {
  advertiser_id: string;
  identity_type: 'CUSTOMIZED_USER';
  display_name: string;
  profile_image?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: number;
  message: string;
  field?: string;
}

export class TikTokApiError extends Error {
  public readonly code: number;
  public readonly requestId: string;
  public readonly details?: ApiErrorDetail[];

  constructor(message: string, code: number, requestId: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'TikTokApiError';
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}
