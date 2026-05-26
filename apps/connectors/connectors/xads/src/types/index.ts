// Twitter/X Ads API Types

// ============ Ad Account ============
export interface AdAccount {
  id: string;
  name: string;
  timezone: string;
  timezone_switch_at: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  approval_status: 'ACCEPTED' | 'PENDING' | 'REJECTED' | 'UNDER_REVIEW';
  salt: string;
  business_id: string | null;
  business_name: string | null;
  industry_type: string | null;
}

export interface AdAccountResponse {
  data: AdAccount[];
  request: RequestInfo;
}

// ============ Funding Instrument ============
export interface FundingInstrument {
  id: string;
  account_id: string;
  type: 'CREDIT_CARD' | 'INSERTION_ORDER' | 'CREDIT_LINE';
  currency: string;
  credit_limit_local_micro: number;
  credit_remaining_local_micro: number;
  funded_amount_local_micro: number;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  able_to_fund: boolean;
  cancelled: boolean;
  description: string | null;
}

// ============ Campaign ============
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'DRAFT';
export type EntityStatus = 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'DELETED';
export type ServingStatus =
  | 'ACTIVE'
  | 'CAMPAIGN_PAUSED'
  | 'NOT_ACTIVE'
  | 'PENDING_START'
  | 'ENDED'
  | 'ACCOUNT_PAUSED'
  | 'EXHAUSTED_BUDGET';

export interface Campaign {
  id: string;
  account_id: string;
  name: string;
  funding_instrument_id: string;
  daily_budget_amount_local_micro: number | null;
  total_budget_amount_local_micro: number | null;
  start_time: string | null;
  end_time: string | null;
  entity_status: EntityStatus;
  standard_delivery: boolean;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  servable: boolean;
  reasons_not_servable: string[];
  purchase_order_number: string | null;
}

export interface CreateCampaignParams {
  name: string;
  funding_instrument_id: string;
  daily_budget_amount_local_micro?: number;
  total_budget_amount_local_micro?: number;
  start_time?: string;
  end_time?: string;
  entity_status?: EntityStatus;
  standard_delivery?: boolean;
  purchase_order_number?: string;
}

export interface UpdateCampaignParams {
  name?: string;
  daily_budget_amount_local_micro?: number;
  total_budget_amount_local_micro?: number;
  start_time?: string;
  end_time?: string;
  entity_status?: EntityStatus;
  standard_delivery?: boolean;
  purchase_order_number?: string;
}

// ============ Line Item (Ad Group) ============
export type Objective =
  | 'APP_ENGAGEMENTS'
  | 'APP_INSTALLS'
  | 'AWARENESS'
  | 'ENGAGEMENTS'
  | 'FOLLOWERS'
  | 'PREROLL_VIEWS'
  | 'REACH'
  | 'VIDEO_VIEWS'
  | 'WEBSITE_CLICKS'
  | 'WEBSITE_CONVERSIONS';

export type Placement =
  | 'ALL_ON_TWITTER'
  | 'PUBLISHER_NETWORK'
  | 'TAP_BANNER'
  | 'TAP_FULL'
  | 'TAP_FULL_LANDSCAPE'
  | 'TAP_NATIVE'
  | 'TWITTER_PROFILE'
  | 'TWITTER_SEARCH'
  | 'TWITTER_TIMELINE';

export type BidStrategy = 'AUTO' | 'MAX' | 'TARGET';
export type ChargeBy = 'APP_CLICK' | 'APP_INSTALL' | 'ENGAGEMENT' | 'FOLLOW' | 'IMPRESSION' | 'LINK_CLICK' | 'VIDEO_VIEW';
export type OptimizationType = 'DEFAULT' | 'WEBSITE_CONVERSIONS';

export interface LineItem {
  id: string;
  account_id: string;
  campaign_id: string;
  name: string;
  objective: Objective;
  placements: Placement[];
  bid_amount_local_micro: number | null;
  bid_strategy: BidStrategy;
  charge_by: ChargeBy;
  optimization: OptimizationType;
  target_cpa_local_micro: number | null;
  total_budget_amount_local_micro: number | null;
  start_time: string | null;
  end_time: string | null;
  entity_status: EntityStatus;
  automatically_select_bid: boolean;
  advertiser_domain: string | null;
  advertiser_user_id: string | null;
  categories: string[];
  creative_source: string;
  goal: string | null;
  primary_web_event_tag: string | null;
  product_type: string;
  tracking_tags: string[];
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface CreateLineItemParams {
  campaign_id: string;
  name: string;
  objective: Objective;
  placements: Placement[];
  bid_amount_local_micro?: number;
  bid_strategy?: BidStrategy;
  charge_by?: ChargeBy;
  optimization?: OptimizationType;
  target_cpa_local_micro?: number;
  total_budget_amount_local_micro?: number;
  start_time?: string;
  end_time?: string;
  entity_status?: EntityStatus;
  automatically_select_bid?: boolean;
  advertiser_domain?: string;
  categories?: string[];
  primary_web_event_tag?: string;
}

export interface UpdateLineItemParams {
  name?: string;
  bid_amount_local_micro?: number;
  bid_strategy?: BidStrategy;
  target_cpa_local_micro?: number;
  total_budget_amount_local_micro?: number;
  start_time?: string;
  end_time?: string;
  entity_status?: EntityStatus;
  automatically_select_bid?: boolean;
  advertiser_domain?: string;
  primary_web_event_tag?: string;
}

// ============ Promoted Tweet ============
export interface PromotedTweet {
  id: string;
  line_item_id: string;
  tweet_id: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  entity_status: EntityStatus;
  approval_status: 'ACCEPTED' | 'PENDING' | 'REJECTED';
}

export interface CreatePromotedTweetParams {
  line_item_id: string;
  tweet_ids: string[];
}

// ============ Targeting Criteria ============
export type TargetingType =
  | 'AGE'
  | 'APP_STORE_CATEGORY'
  | 'APP_STORE_CATEGORY_LOOKALIKE'
  | 'BEHAVIOR'
  | 'BEHAVIOR_EXPANDED'
  | 'BROAD_KEYWORD'
  | 'CAMPAIGN_ENGAGEMENT'
  | 'CAMPAIGN_ENGAGEMENT_LOOKALIKE'
  | 'CONVERSATION'
  | 'DEVICE'
  | 'ENGAGEMENT_TYPE'
  | 'EVENT'
  | 'EXACT_KEYWORD'
  | 'FOLLOWER_LOOK_ALIKE'
  | 'FOLLOWERS_OF_USER'
  | 'GENDER'
  | 'INTEREST'
  | 'LANGUAGE'
  | 'LIVE_TV_EVENT'
  | 'LOCATION'
  | 'MOVIES_AND_TV_SHOWS'
  | 'NEGATIVE_BEHAVIOR'
  | 'NEGATIVE_EXACT_KEYWORD'
  | 'NEGATIVE_PHRASE_KEYWORD'
  | 'NEGATIVE_UNORDERED_KEYWORD'
  | 'NETWORK_ACTIVATION_DURATION'
  | 'NETWORK_OPERATOR'
  | 'PHRASE_KEYWORD'
  | 'PLATFORM'
  | 'PLATFORM_VERSION'
  | 'SIMILAR_TO_FOLLOWERS_OF_USER'
  | 'TAILORED_AUDIENCE'
  | 'TAILORED_AUDIENCE_EXPANDED'
  | 'TAILORED_AUDIENCE_LOOKALIKE'
  | 'TV_CHANNEL'
  | 'TV_GENRE'
  | 'TV_SHOW'
  | 'UNORDERED_KEYWORD'
  | 'WIFI_ONLY';

export interface TargetingCriteria {
  id: string;
  line_item_id: string;
  targeting_type: TargetingType;
  targeting_value: string;
  tailored_audience_expansion: boolean;
  tailored_audience_type: string | null;
  name: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface CreateTargetingParams {
  line_item_id: string;
  targeting_type: TargetingType;
  targeting_value: string;
  tailored_audience_expansion?: boolean;
}

// ============ Media Creative ============
export interface MediaCreative {
  id: string;
  account_id: string;
  line_item_id: string;
  landing_url: string;
  media_key: string;
  media_service_url: string | null;
  approval_status: 'ACCEPTED' | 'PENDING' | 'REJECTED';
  entity_status: EntityStatus;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface CreateMediaCreativeParams {
  line_item_id: string;
  media_key: string;
  landing_url: string;
}

// ============ Tailored Audience (Custom Audience) ============
export type AudienceType =
  | 'CRM'
  | 'EVENT'
  | 'FLEXIBLE'
  | 'MOBILE'
  | 'WEB';

export interface TailoredAudience {
  id: string;
  account_id: string;
  name: string;
  audience_size: number | null;
  audience_type: AudienceType;
  targetable: boolean;
  targetable_types: string[];
  reasons_not_targetable: string[];
  list_type: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  owner_account_id: string;
  partner_source: string | null;
  is_owner: boolean;
  permission_level: string;
}

export interface CreateTailoredAudienceParams {
  name: string;
  list_type: 'EMAIL' | 'DEVICE_ID' | 'TWITTER_ID' | 'HANDLE' | 'PHONE_NUMBER';
}

// ============ Analytics ============
export type Granularity = 'DAY' | 'HOUR' | 'TOTAL';
export type MetricGroup =
  | 'BILLING'
  | 'ENGAGEMENT'
  | 'LIFE_TIME_VALUE_MOBILE_CONVERSION'
  | 'MEDIA'
  | 'MOBILE_CONVERSION'
  | 'VIDEO'
  | 'WEB_CONVERSION';

export interface AnalyticsParams {
  start_time: string;
  end_time: string;
  granularity?: Granularity;
  metric_groups?: MetricGroup[];
  placement?: Placement;
  entity_ids: string[];
}

export interface AnalyticsMetrics {
  impressions: number[];
  clicks: number[];
  engagements: number[];
  retweets: number[];
  replies: number[];
  likes: number[];
  follows: number[];
  app_clicks: number[];
  url_clicks: number[];
  qualified_impressions: number[];
  billed_engagements: number[];
  billed_charge_local_micro: number[];
  video_total_views: number[];
  video_views_25: number[];
  video_views_50: number[];
  video_views_75: number[];
  video_views_100: number[];
  video_cta_clicks: number[];
  video_content_starts: number[];
  video_mrc_views: number[];
  video_3s100pct_views: number[];
  card_engagements: number[];
  poll_card_vote: number[];
  carousel_swipes: number[];
}

export interface AnalyticsData {
  id: string;
  id_data: AnalyticsMetrics[];
}

export interface AnalyticsResponse {
  data: AnalyticsData[];
  data_type: string;
  time_series_length: number;
  request: RequestInfo;
}

// ============ Reach Estimate ============
export interface ReachEstimateParams {
  objective: Objective;
  bid_amount_local_micro?: number;
  currency?: string;
  campaign_daily_budget_amount_local_micro?: number;
  similar_to_followers_of_users?: string[];
  locations?: string[];
  interests?: string[];
  gender?: 'FEMALE' | 'MALE';
  platforms?: string[];
  tailored_audiences?: string[];
  age_buckets?: string[];
  languages?: string[];
}

export interface ReachEstimate {
  count: {
    min: number;
    max: number;
  };
  infinite_bid_count: {
    min: number;
    max: number;
  };
  engagements?: {
    min: number;
    max: number;
  };
  estimated_daily_spend_local_micro?: {
    min: number;
    max: number;
  };
  impressions?: {
    min: number;
    max: number;
  };
}

// ============ Scheduled Promoted Tweet ============
export interface ScheduledPromotedTweet {
  id: string;
  line_item_id: string;
  scheduled_tweet_id: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

export interface CreateScheduledPromotedTweetParams {
  line_item_id: string;
  scheduled_tweet_id: string;
}

// ============ Tweet Preview ============
export interface TweetPreview {
  tweet_id: string;
  preview: string;
  platform: string;
  placement: string;
}

// ============ Request/Response ============
export interface RequestInfo {
  params: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data: T;
  request: RequestInfo;
}

export interface ListResponse<T> {
  data: T[];
  request: RequestInfo;
  next_cursor?: string;
  total_count?: number;
}

export interface PaginationParams {
  cursor?: string;
  count?: number;
  sort_by?: string[];
  with_deleted?: boolean;
  with_total_count?: boolean;
}

// ============ Config ============
export interface XAdsConfig {
  consumerKey?: string;
  consumerSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  accountId?: string;
}
