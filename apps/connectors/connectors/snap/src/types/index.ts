// Snapchat Marketing API Types
// Comprehensive types for all Snapchat Ads API endpoints

// ============================================
// Configuration
// ============================================

export interface SnapConfig {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type DateString = string; // ISO 8601 format

export type CurrencyAmount = number; // In micro-currency (1/1,000,000)

export interface PaginatedResponse<T> {
  request_status: string;
  request_id: string;
  paging?: {
    next_link?: string;
  };
  [key: string]: T[] | string | object | undefined;
}

export interface ApiResponse<T> {
  request_status: string;
  request_id: string;
  [key: string]: T | T[] | string | undefined;
}

// ============================================
// Organization Types
// ============================================

export type OrganizationType = 'ENTERPRISE' | 'SMALL_BUSINESS';

export interface Organization {
  id: string;
  name: string;
  type: OrganizationType;
  address_line_1?: string;
  locality?: string;
  administrative_district_level_1?: string;
  country?: string;
  postal_code?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  created_at: DateString;
  updated_at: DateString;
}

export interface OrganizationResponse {
  request_status: string;
  request_id: string;
  organizations: { organization: Organization }[];
}

// ============================================
// Ad Account Types
// ============================================

export type AdAccountStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED' | 'PENDING' | 'DELETED';
export type AdAccountType = 'PARTNER' | 'BRAND' | 'DIRECT';
export type BillingType = 'INVOICED' | 'PREPAID' | 'CREDIT_CARD';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | string;

export interface AdAccount {
  id: string;
  name: string;
  type: AdAccountType;
  status: AdAccountStatus;
  organization_id: string;
  currency: Currency;
  timezone: string;
  advertiser?: string;
  advertiser_organization_id?: string;
  billing_type: BillingType;
  billing_center_id?: string;
  agency_representing_client?: boolean;
  client_based_in_country?: string;
  client_paying_invoices?: boolean;
  lifetime_spend_cap_micro?: CurrencyAmount;
  created_at: DateString;
  updated_at: DateString;
}

export interface AdAccountCreateParams {
  name: string;
  organization_id: string;
  type: AdAccountType;
  currency: Currency;
  timezone: string;
  advertiser?: string;
  billing_type?: BillingType;
  billing_center_id?: string;
  lifetime_spend_cap_micro?: CurrencyAmount;
}

export interface AdAccountUpdateParams {
  name?: string;
  status?: AdAccountStatus;
  advertiser?: string;
  lifetime_spend_cap_micro?: CurrencyAmount;
}

export interface AdAccountResponse {
  request_status: string;
  request_id: string;
  adaccounts: { adaccount: AdAccount }[];
}

// ============================================
// Campaign Types
// ============================================

export type CampaignStatus = 'ACTIVE' | 'PAUSED';
export type ObjectiveType =
  | 'AWARENESS'
  | 'CONSIDERATION'
  | 'CONVERSIONS'
  | 'APP_INSTALLS'
  | 'APP_ENGAGEMENT'
  | 'APP_CONVERSIONS'
  | 'VIDEO_VIEWS'
  | 'LEAD_GENERATION'
  | 'WEBSITE_CONVERSIONS'
  | 'CATALOG_SALES'
  | 'ENGAGEMENT'
  | 'REACH';

export interface Campaign {
  id: string;
  name: string;
  ad_account_id: string;
  status: CampaignStatus;
  objective: ObjectiveType;
  start_time?: DateString;
  end_time?: DateString;
  daily_budget_micro?: CurrencyAmount;
  lifetime_spend_cap_micro?: CurrencyAmount;
  buy_model?: 'AUCTION' | 'RESERVED';
  measurement_spec?: {
    ios_app_id?: string;
    android_app_url?: string;
  };
  created_at: DateString;
  updated_at: DateString;
}

export interface CampaignCreateParams {
  name: string;
  ad_account_id: string;
  status?: CampaignStatus;
  objective: ObjectiveType;
  start_time?: DateString;
  end_time?: DateString;
  daily_budget_micro?: CurrencyAmount;
  lifetime_spend_cap_micro?: CurrencyAmount;
}

export interface CampaignUpdateParams {
  name?: string;
  status?: CampaignStatus;
  start_time?: DateString;
  end_time?: DateString;
  daily_budget_micro?: CurrencyAmount;
  lifetime_spend_cap_micro?: CurrencyAmount;
}

export interface CampaignResponse {
  request_status: string;
  request_id: string;
  campaigns: { campaign: Campaign }[];
}

// ============================================
// Ad Squad Types
// ============================================

export type AdSquadStatus = 'ACTIVE' | 'PAUSED';
export type AdSquadType = 'SNAP_ADS' | 'STORY_ADS' | 'LENS' | 'FILTER';
export type BillingEvent = 'IMPRESSION' | 'SWIPE_UP' | 'VIDEO_VIEW' | 'APP_INSTALL' | 'PIXEL';
export type OptimizationGoal =
  | 'IMPRESSIONS'
  | 'SWIPES'
  | 'APP_INSTALLS'
  | 'VIDEO_VIEWS'
  | 'VIDEO_VIEWS_15_SEC'
  | 'USES'
  | 'STORY_OPENS'
  | 'CONVERSIONS'
  | 'PIXEL_PAGE_VIEW'
  | 'PIXEL_ADD_TO_CART'
  | 'PIXEL_PURCHASE'
  | 'PIXEL_SIGNUP'
  | 'PIXEL_SEARCH'
  | 'PIXEL_VIEW_CONTENT'
  | 'PIXEL_ADD_BILLING'
  | 'PIXEL_ADD_TO_WISHLIST'
  | 'PIXEL_INITIATE_CHECKOUT'
  | 'PIXEL_SUBSCRIBE'
  | 'PIXEL_COMPLETE_TUTORIAL'
  | 'PIXEL_INVITE'
  | 'PIXEL_LOGIN'
  | 'PIXEL_SHARE'
  | 'PIXEL_RESERVE'
  | 'PIXEL_ACHIEVEMENT_UNLOCKED'
  | 'PIXEL_SPENT_CREDITS'
  | 'PIXEL_RATE'
  | 'PIXEL_START_TRIAL'
  | 'PIXEL_LIST_VIEW'
  | 'PIXEL_CUSTOM_EVENT_1'
  | 'PIXEL_CUSTOM_EVENT_2'
  | 'PIXEL_CUSTOM_EVENT_3'
  | 'PIXEL_CUSTOM_EVENT_4'
  | 'PIXEL_CUSTOM_EVENT_5';
export type PlacementType = 'SNAP_ADS' | 'CONTENT' | 'USER_STORIES' | 'SPOTLIGHT' | 'CAMERA';

export interface GeoTarget {
  country_code?: string;
  region_id?: string[];
  metro_id?: string[];
  postal_code?: string[];
}

export interface DemographicTarget {
  age_groups?: string[];
  genders?: ('MALE' | 'FEMALE')[];
  languages?: string[];
  advanced_demographics?: {
    income_groups?: string[];
    parental_status?: string[];
    education_status?: string[];
  };
}

export interface DeviceTarget {
  os_type?: ('iOS' | 'ANDROID' | 'WEB')[];
  os_version_min?: string;
  os_version_max?: string;
  connection_types?: ('WIFI' | 'CELL')[];
  carriers?: string[];
  device_makes?: string[];
}

export interface Targeting {
  geos?: GeoTarget[];
  demographics?: DemographicTarget[];
  devices?: DeviceTarget[];
  interests?: string[];
  segments?: string[];
  regulated_content?: boolean;
}

export interface AdSquad {
  id: string;
  name: string;
  campaign_id: string;
  ad_account_id: string;
  status: AdSquadStatus;
  type: AdSquadType;
  billing_event: BillingEvent;
  optimization_goal: OptimizationGoal;
  placement?: PlacementType;
  placement_v2?: {
    config: string;
    platforms?: string[];
  };
  bid_micro?: CurrencyAmount;
  auto_bid?: boolean;
  target_bid?: boolean;
  bid_strategy?: 'LOWEST_COST_WITH_MAX_BID' | 'AUTO_BID' | 'MIN_ROAS' | 'TARGET_COST';
  daily_budget_micro?: CurrencyAmount;
  lifetime_budget_micro?: CurrencyAmount;
  start_time?: DateString;
  end_time?: DateString;
  targeting?: Targeting;
  pixel_id?: string;
  cap_and_exclusion_config?: {
    frequency_cap_count?: number;
    frequency_cap_interval?: number;
    frequency_cap_type?: 'IMPRESSIONS' | 'VIEWS';
  };
  pacing_type?: 'STANDARD' | 'ACCELERATED';
  delivery_constraint?: 'DAILY_BUDGET' | 'LIFETIME_BUDGET';
  reach_and_frequency_status?: 'PENDING' | 'APPROVED' | 'CANCELLED' | 'EXPIRED';
  created_at: DateString;
  updated_at: DateString;
}

export interface AdSquadCreateParams {
  name: string;
  campaign_id: string;
  status?: AdSquadStatus;
  type: AdSquadType;
  billing_event: BillingEvent;
  optimization_goal: OptimizationGoal;
  placement?: PlacementType;
  placement_v2?: {
    config: string;
    platforms?: string[];
  };
  bid_micro?: CurrencyAmount;
  auto_bid?: boolean;
  target_bid?: boolean;
  bid_strategy?: string;
  daily_budget_micro?: CurrencyAmount;
  lifetime_budget_micro?: CurrencyAmount;
  start_time?: DateString;
  end_time?: DateString;
  targeting?: Targeting;
  pixel_id?: string;
  cap_and_exclusion_config?: {
    frequency_cap_count?: number;
    frequency_cap_interval?: number;
    frequency_cap_type?: string;
  };
  pacing_type?: string;
}

export interface AdSquadUpdateParams {
  name?: string;
  status?: AdSquadStatus;
  bid_micro?: CurrencyAmount;
  auto_bid?: boolean;
  daily_budget_micro?: CurrencyAmount;
  lifetime_budget_micro?: CurrencyAmount;
  start_time?: DateString;
  end_time?: DateString;
  targeting?: Targeting;
}

export interface AdSquadResponse {
  request_status: string;
  request_id: string;
  adsquads: { adsquad: AdSquad }[];
}

// ============================================
// Ad Types
// ============================================

export type AdStatus = 'ACTIVE' | 'PAUSED';
export type AdType = 'SNAP_AD' | 'STORY_AD' | 'COLLECTION_AD' | 'APP_INSTALL' | 'DEEP_LINK' | 'LENS' | 'FILTER';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Ad {
  id: string;
  name: string;
  ad_squad_id: string;
  creative_id: string;
  status: AdStatus;
  type: AdType;
  review_status: ReviewStatus;
  review_status_reasons?: string[];
  paying_advertiser_name?: string;
  third_party_paid_impression_tracking_urls?: string[];
  third_party_swipe_tracking_urls?: string[];
  created_at: DateString;
  updated_at: DateString;
}

export interface AdCreateParams {
  name: string;
  ad_squad_id: string;
  creative_id: string;
  status?: AdStatus;
  type?: AdType;
  paying_advertiser_name?: string;
  third_party_paid_impression_tracking_urls?: string[];
  third_party_swipe_tracking_urls?: string[];
}

export interface AdUpdateParams {
  name?: string;
  status?: AdStatus;
  creative_id?: string;
  paying_advertiser_name?: string;
}

export interface AdResponse {
  request_status: string;
  request_id: string;
  ads: { ad: Ad }[];
}

// ============================================
// Creative Types
// ============================================

export type CreativeType =
  | 'SNAP_AD'
  | 'APP_INSTALL'
  | 'LONGFORM_VIDEO'
  | 'WEB_VIEW'
  | 'DEEP_LINK'
  | 'AD_TO_LENS'
  | 'AD_TO_CALL'
  | 'AD_TO_MESSAGE'
  | 'COLLECTION'
  | 'COMPOSITE'
  | 'PREVIEW'
  | 'LENS'
  | 'FILTER'
  | 'LEAD_GEN';
export type CallToAction =
  | 'BLANK'
  | 'BOOK_NOW'
  | 'BUY_TICKETS'
  | 'CONTACT_US'
  | 'DOWNLOAD'
  | 'GET_DIRECTIONS'
  | 'GET_NOW'
  | 'INSTALL_NOW'
  | 'LEARN_MORE'
  | 'LISTEN_NOW'
  | 'MORE'
  | 'ORDER_NOW'
  | 'PLAY_GAME'
  | 'PLAY_NOW'
  | 'READ_MORE'
  | 'SEE_MORE'
  | 'SHOP_NOW'
  | 'SHOW_TIMES'
  | 'SIGN_UP'
  | 'SUBSCRIBE'
  | 'TRY_NOW'
  | 'OPEN_APP'
  | 'USE_APP'
  | 'VIEW_MORE'
  | 'VIEW_NOW'
  | 'VISIT_SITE'
  | 'WATCH_NOW'
  | 'APPLY_NOW'
  | 'BOOK'
  | 'BUY'
  | 'DONATE'
  | 'GET_OFFER'
  | 'GET_QUOTE'
  | 'REGISTER'
  | 'RESERVE'
  | 'SHARE'
  | 'START_NOW'
  | 'VOTE';

export interface TopSnapMedia {
  media_id: string;
  media_type?: 'VIDEO' | 'IMAGE';
}

export interface Creative {
  id: string;
  name: string;
  ad_account_id: string;
  type: CreativeType;
  headline?: string;
  brand_name?: string;
  top_snap_media_id?: string;
  top_snap_crop_position?: string;
  longform_video_properties?: {
    video_media_id: string;
  };
  web_view_properties?: {
    url: string;
    allow_snap_javascript_sdk?: boolean;
    deep_link_urls?: string[];
    block_preload?: boolean;
    use_immersive_mode?: boolean;
  };
  deep_link_properties?: {
    ios_app_id?: string;
    android_app_url?: string;
    deep_link_uri?: string;
    app_name?: string;
    icon_media_id?: string;
    fallback_type?: 'APP_STORE' | 'WEB' | 'NO_FALLBACK';
  };
  app_install_properties?: {
    ios_app_id?: string;
    android_app_url?: string;
    app_name?: string;
    icon_media_id?: string;
  };
  collection_properties?: {
    default_fallback_interaction_type?: string;
    items?: CollectionItem[];
  };
  ad_to_lens_properties?: {
    lens_media_id: string;
  };
  preview_properties?: {
    preview_media_id: string;
    logo_media_id?: string;
  };
  call_to_action?: CallToAction;
  shareable?: boolean;
  render_type?: string;
  ad_product?: string;
  forced_view_eligibility?: string;
  preview_creative_id?: string;
  playback_type?: 'LOOPING' | 'AUTO_ADVANCING';
  created_at: DateString;
  updated_at: DateString;
}

export interface CollectionItem {
  creative_id?: string;
  headline?: string;
  media_id?: string;
  web_view_properties?: {
    url: string;
  };
  deep_link_properties?: {
    deep_link_uri: string;
    ios_app_id?: string;
    android_app_url?: string;
  };
}

export interface CreativeCreateParams {
  name: string;
  ad_account_id: string;
  type: CreativeType;
  headline?: string;
  brand_name?: string;
  top_snap_media_id?: string;
  top_snap_crop_position?: string;
  longform_video_properties?: {
    video_media_id: string;
  };
  web_view_properties?: {
    url: string;
    allow_snap_javascript_sdk?: boolean;
    deep_link_urls?: string[];
  };
  deep_link_properties?: {
    ios_app_id?: string;
    android_app_url?: string;
    deep_link_uri?: string;
    app_name?: string;
    icon_media_id?: string;
  };
  app_install_properties?: {
    ios_app_id?: string;
    android_app_url?: string;
    app_name?: string;
    icon_media_id?: string;
  };
  ad_to_lens_properties?: {
    lens_media_id: string;
  };
  preview_properties?: {
    preview_media_id: string;
    logo_media_id?: string;
  };
  call_to_action?: CallToAction;
  shareable?: boolean;
}

export interface CreativeUpdateParams {
  name?: string;
  headline?: string;
  brand_name?: string;
  call_to_action?: CallToAction;
}

export interface CreativeResponse {
  request_status: string;
  request_id: string;
  creatives: { creative: Creative }[];
}

// ============================================
// Media Types
// ============================================

export type MediaType = 'VIDEO' | 'IMAGE' | 'LENS' | 'LENS_PACKAGE' | 'RAW_IMAGE' | 'GIF';
export type MediaStatus = 'PENDING_UPLOAD' | 'UPLOADING' | 'PENDING_TRANSCODE' | 'READY' | 'FAILED';

export interface Media {
  id: string;
  name?: string;
  ad_account_id: string;
  type: MediaType;
  media_status: MediaStatus;
  file_name?: string;
  download_link?: string;
  duration_in_seconds?: number;
  hash?: string;
  height?: number;
  width?: number;
  video_metadata?: {
    duration_in_seconds: number;
    frame_rate: number;
    width: number;
    height: number;
  };
  image_metadata?: {
    width: number;
    height: number;
  };
  created_at: DateString;
  updated_at: DateString;
}

export interface MediaCreateParams {
  name?: string;
  type: MediaType;
  ad_account_id: string;
}

export interface ChunkedUploadParams {
  file_name: string;
  file_size: number;
  number_of_parts: number;
}

export interface UploadPart {
  part_number: number;
  etag: string;
}

export interface ChunkedUploadCompleteParams {
  upload_id: string;
  parts: UploadPart[];
}

export interface MediaResponse {
  request_status: string;
  request_id: string;
  media: { media: Media }[];
}

// ============================================
// Audience/Segment Types
// ============================================

export type SegmentStatus = 'ACTIVE' | 'PENDING' | 'PAUSED' | 'PROCESSING' | 'READY';
export type SegmentSourceType =
  | 'FIRST_PARTY'
  | 'SAM'
  | 'ENGAGEMENT'
  | 'PIXEL'
  | 'LOOKALIKE'
  | 'SAVED_AUDIENCE'
  | 'MOBILE_AD_ID'
  | 'EMAIL'
  | 'PHONE';
export type RetentionInDays = 1 | 3 | 5 | 7 | 10 | 14 | 21 | 28 | 30 | 60 | 90 | 120 | 180 | 365 | 9999;

export interface Segment {
  id: string;
  name: string;
  ad_account_id: string;
  organization_id?: string;
  status: SegmentStatus;
  source_type: SegmentSourceType;
  description?: string;
  targetable_status?: 'TOO_FEW_USERS' | 'READY' | 'NOT_READY';
  upload_status?: 'PENDING' | 'COMPLETE' | 'FAILED';
  approximate_count?: number;
  retention_in_days?: RetentionInDays;
  visible_to?: string[];
  created_at: DateString;
  updated_at: DateString;
}

export interface SegmentCreateParams {
  name: string;
  ad_account_id: string;
  source_type: SegmentSourceType;
  description?: string;
  retention_in_days?: RetentionInDays;
}

export interface SegmentUpdateParams {
  name?: string;
  description?: string;
  retention_in_days?: RetentionInDays;
}

export interface SAMUploadParams {
  schema: ('EMAIL_SHA256' | 'PHONE_SHA256' | 'MOBILE_AD_ID')[];
  data: string[][];
}

export interface LookalikeCreateParams {
  name: string;
  ad_account_id: string;
  seed_segment_id: string;
  country: string;
  type: 'BALANCE' | 'REACH' | 'SIMILARITY';
}

export interface SegmentResponse {
  request_status: string;
  request_id: string;
  segments: { segment: Segment }[];
}

// ============================================
// Targeting Types
// ============================================

export interface TargetingDimension {
  id: string;
  name: string;
  path: string[];
  parent_id?: string;
  type: string;
  description?: string;
}

export interface TargetingSpec {
  geos?: GeoTarget[];
  demographics?: DemographicTarget[];
  devices?: DeviceTarget[];
  interests?: string[];
  locations?: {
    circles?: {
      latitude: number;
      longitude: number;
      radius: number;
    }[];
  };
  segments?: string[];
  enable_targeting_expansion?: boolean;
  regulated_content?: boolean;
}

export interface TargetingResponse {
  request_status: string;
  request_id: string;
  targeting: TargetingDimension[];
}

// ============================================
// Stats Types
// ============================================

export type Granularity = 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'TOTAL';
export type StatsBreakdown =
  | 'NONE'
  | 'ad_id'
  | 'ad_squad_id'
  | 'campaign_id'
  | 'creative_id'
  | 'gender'
  | 'age'
  | 'country'
  | 'region'
  | 'dma'
  | 'os_type'
  | 'device_make'
  | 'interest_category';

export interface StatsParams {
  granularity?: Granularity;
  breakdown?: StatsBreakdown;
  start_time: DateString;
  end_time: DateString;
  fields?: string[];
  swipe_up_attribution_window?: '1_DAY' | '7_DAY' | '28_DAY';
  view_attribution_window?: '1_HOUR' | '3_HOUR' | '6_HOUR' | '1_DAY' | '7_DAY' | '28_DAY';
  conversion_source_types?: string[];
}

export interface Stats {
  id: string;
  type: string;
  granularity: Granularity;
  start_time: DateString;
  end_time: DateString;
  stats: StatsMetrics;
  timeseries?: TimeseriesStats[];
  breakdown_stats?: BreakdownStats;
}

export interface StatsMetrics {
  impressions?: number;
  swipes?: number;
  spend?: CurrencyAmount;
  video_views?: number;
  video_views_time_based?: number;
  video_views_15s?: number;
  screen_time_millis?: number;
  quartile_1?: number;
  quartile_2?: number;
  quartile_3?: number;
  view_completion?: number;
  shares?: number;
  saves?: number;
  conversion_purchases?: number;
  conversion_purchases_value?: CurrencyAmount;
  conversion_sign_ups?: number;
  conversion_add_carts?: number;
  conversion_page_views?: number;
  conversion_app_installs?: number;
  conversion_app_opens?: number;
  swipe_up_percent?: number;
  ecpm?: number;
  ecpc?: number;
  ecpv?: number;
  frequency?: number;
  uniques?: number;
  total_reach?: number;
}

export interface TimeseriesStats {
  start_time: DateString;
  end_time: DateString;
  stats: StatsMetrics;
}

export interface BreakdownStats {
  [key: string]: {
    dimension_value: string;
    stats: StatsMetrics;
  }[];
}

export interface StatsResponse {
  request_status: string;
  request_id: string;
  total_stats?: Stats[];
  timeseries_stats?: Stats[];
}

// ============================================
// Pixel Types
// ============================================

export type PixelStatus = 'ACTIVE' | 'PAUSED';

export interface Pixel {
  id: string;
  name: string;
  ad_account_id: string;
  status: PixelStatus;
  effective_status?: string;
  pixel_javascript?: string;
  visible_to?: string[];
  created_at: DateString;
  updated_at: DateString;
}

export interface PixelCreateParams {
  name: string;
  ad_account_id: string;
}

export interface PixelUpdateParams {
  name?: string;
  status?: PixelStatus;
}

export interface PixelResponse {
  request_status: string;
  request_id: string;
  pixels: { pixel: Pixel }[];
}

// ============================================
// Conversions API Types (CAPI v3)
// ============================================

export type ConversionEventType =
  | 'PAGE_VIEW'
  | 'VIEW_CONTENT'
  | 'ADD_CART'
  | 'ADD_TO_WISHLIST'
  | 'SIGN_UP'
  | 'PURCHASE'
  | 'SAVE'
  | 'START_CHECKOUT'
  | 'ADD_BILLING'
  | 'SEARCH'
  | 'SUBSCRIBE'
  | 'AD_CLICK'
  | 'AD_VIEW'
  | 'COMPLETE_TUTORIAL'
  | 'LEVEL_COMPLETE'
  | 'INVITE'
  | 'LOGIN'
  | 'SHARE'
  | 'RESERVE'
  | 'ACHIEVEMENT_UNLOCKED'
  | 'SPENT_CREDITS'
  | 'RATE'
  | 'START_TRIAL'
  | 'LIST_VIEW'
  | 'APP_OPEN'
  | 'APP_INSTALL'
  | 'CUSTOM_EVENT_1'
  | 'CUSTOM_EVENT_2'
  | 'CUSTOM_EVENT_3'
  | 'CUSTOM_EVENT_4'
  | 'CUSTOM_EVENT_5';

export interface ConversionEvent {
  pixel_id: string;
  event_type: ConversionEventType;
  event_conversion_type: 'WEB' | 'MOBILE_APP' | 'OFFLINE';
  timestamp: number; // Unix milliseconds
  event_tag?: string;
  uuid_c1?: string; // Hashed cookie ID
  hashed_email?: string;
  hashed_phone_number?: string;
  hashed_ip_address?: string;
  user_agent?: string;
  hashed_mobile_ad_id?: string;
  hashed_idfv?: string;
  page_url?: string;
  app_id?: string;
  number_items?: number;
  price?: number;
  currency?: string;
  transaction_id?: string;
  level?: string;
  client_dedup_id?: string;
  search_string?: string;
  sign_up_method?: string;
  item_ids?: string[];
  item_category?: string;
  description?: string;
  brands?: string[];
  click_id?: string; // ScSc cookie value
  integration?: string;
}

export interface ConversionBatchRequest {
  data: ConversionEvent[];
  test_event_code?: string;
}

export interface ConversionResponse {
  request_status: string;
  request_id: string;
  status: string;
  events_received?: number;
  events_processed?: number;
  debug_message?: string;
}

// ============================================
// Catalog Types
// ============================================

export type CatalogStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';
export type CatalogEventType = 'VIEW_CONTENT' | 'ADD_CART' | 'PURCHASE';
export type FeedStatus = 'ACTIVE' | 'PAUSED' | 'INVALID' | 'PROCESSING';

export interface Catalog {
  id: string;
  name: string;
  ad_account_id: string;
  organization_id?: string;
  status: CatalogStatus;
  event_sources?: CatalogEventSource[];
  default_currency?: Currency;
  default_country?: string;
  product_count?: number;
  created_at: DateString;
  updated_at: DateString;
}

export interface CatalogEventSource {
  id: string;
  type: 'PIXEL' | 'APP';
  event_pixel_id?: string;
  app_id?: string;
}

export interface CatalogCreateParams {
  name: string;
  ad_account_id: string;
  organization_id?: string;
  event_sources?: {
    type: 'PIXEL' | 'APP';
    event_pixel_id?: string;
    app_id?: string;
  }[];
}

export interface CatalogUpdateParams {
  name?: string;
  status?: CatalogStatus;
}

export interface ProductFeed {
  id: string;
  name: string;
  catalog_id: string;
  status: FeedStatus;
  schedule?: {
    url: string;
    interval: 'DAILY' | 'HOURLY';
    hour?: number;
    minute?: number;
    timezone?: string;
  };
  default_currency?: Currency;
  default_country?: string;
  created_at: DateString;
  updated_at: DateString;
}

export interface ProductFeedCreateParams {
  name: string;
  catalog_id: string;
  schedule?: {
    url: string;
    interval: 'DAILY' | 'HOURLY';
    hour?: number;
    minute?: number;
    timezone?: string;
  };
  default_currency?: Currency;
  default_country?: string;
}

export interface ProductItem {
  id: string;
  catalog_id: string;
  retailer_id: string;
  title: string;
  description?: string;
  link?: string;
  image_link?: string;
  additional_image_links?: string[];
  availability?: 'in stock' | 'out of stock' | 'preorder' | 'available for order';
  price?: string;
  sale_price?: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  condition?: 'new' | 'refurbished' | 'used';
  product_type?: string;
  google_product_category?: string;
  custom_labels?: string[];
  created_at: DateString;
  updated_at: DateString;
}

export interface ProductSet {
  id: string;
  name: string;
  catalog_id: string;
  filter?: {
    field: string;
    operator: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'NOT_CONTAINS' | 'GREATER_THAN' | 'LESS_THAN';
    value: string;
  }[];
  created_at: DateString;
  updated_at: DateString;
}

export interface CatalogResponse {
  request_status: string;
  request_id: string;
  catalogs: { catalog: Catalog }[];
}

export interface ProductFeedResponse {
  request_status: string;
  request_id: string;
  product_feeds: { product_feed: ProductFeed }[];
}

export interface ProductItemResponse {
  request_status: string;
  request_id: string;
  products: { product: ProductItem }[];
}

export interface ProductSetResponse {
  request_status: string;
  request_id: string;
  product_sets: { product_set: ProductSet }[];
}

// ============================================
// Lead Gen Types
// ============================================

export type LeadFormStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type LeadFormFieldType =
  | 'FULL_NAME'
  | 'FIRST_NAME'
  | 'LAST_NAME'
  | 'EMAIL'
  | 'PHONE_NUMBER'
  | 'STREET_ADDRESS'
  | 'CITY'
  | 'STATE'
  | 'ZIP_CODE'
  | 'COUNTRY'
  | 'DATE_OF_BIRTH'
  | 'GENDER'
  | 'COMPANY_NAME'
  | 'JOB_TITLE'
  | 'WORK_EMAIL'
  | 'WORK_PHONE_NUMBER'
  | 'CUSTOM';

export interface LeadFormField {
  type: LeadFormFieldType;
  label?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

export interface LeadForm {
  id: string;
  name: string;
  ad_account_id: string;
  organization_id?: string;
  status: LeadFormStatus;
  headline?: string;
  description?: string;
  privacy_policy_url: string;
  fields: LeadFormField[];
  thank_you_headline?: string;
  thank_you_description?: string;
  thank_you_call_to_action?: CallToAction;
  thank_you_url?: string;
  leads_webhook_url?: string;
  leads_webhook_secret?: string;
  created_at: DateString;
  updated_at: DateString;
}

export interface LeadFormCreateParams {
  name: string;
  ad_account_id: string;
  organization_id?: string;
  headline?: string;
  description?: string;
  privacy_policy_url: string;
  fields: LeadFormField[];
  thank_you_headline?: string;
  thank_you_description?: string;
  thank_you_call_to_action?: CallToAction;
  thank_you_url?: string;
  leads_webhook_url?: string;
}

export interface LeadFormUpdateParams {
  name?: string;
  status?: LeadFormStatus;
  headline?: string;
  description?: string;
  thank_you_headline?: string;
  thank_you_description?: string;
}

export interface Lead {
  id: string;
  lead_form_id: string;
  ad_id?: string;
  ad_squad_id?: string;
  campaign_id?: string;
  created_at: DateString;
  responses: {
    field_type: LeadFormFieldType;
    label?: string;
    response: string;
  }[];
}

export interface LeadFormResponse {
  request_status: string;
  request_id: string;
  lead_forms: { lead_form: LeadForm }[];
}

export interface LeadResponse {
  request_status: string;
  request_id: string;
  leads: { lead: Lead }[];
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  reason: string;
  message: string;
  error_code?: string;
  property?: string;
}

export class SnapApiError extends Error {
  public readonly statusCode: number;
  public readonly requestId?: string;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, requestId?: string, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'SnapApiError';
    this.statusCode = statusCode;
    this.requestId = requestId;
    this.errors = errors;
  }
}
