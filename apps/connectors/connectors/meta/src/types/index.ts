// Meta Marketing API Types
// Facebook/Instagram Ads API types

// ============================================
// Configuration
// ============================================

export interface MetaConfig {
  accessToken: string;
  baseUrl?: string;
  apiVersion?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
  summary?: {
    total_count?: number;
  };
}

// ISO 8601 date string
export type DateString = string;

// Currency amount (typically in account currency)
export type CurrencyAmount = string;

// ============================================
// Ad Account Types
// ============================================

export type AdAccountStatus =
  | 1 // ACTIVE
  | 2 // DISABLED
  | 3 // UNSETTLED
  | 7 // PENDING_RISK_REVIEW
  | 8 // PENDING_SETTLEMENT
  | 9 // IN_GRACE_PERIOD
  | 100 // PENDING_CLOSURE
  | 101 // CLOSED
  | 201; // ANY_ACTIVE

export type DisableReason =
  | 0 // NONE
  | 1 // ADS_INTEGRITY_POLICY
  | 2 // ADS_IP_REVIEW
  | 3 // RISK_PAYMENT
  | 4 // GRAY_ACCOUNT_SHUT_DOWN
  | 5 // ADS_AFC_REVIEW
  | 6 // BUSINESS_INTEGRITY_RAR
  | 7 // PERMANENT_CLOSE
  | 8; // UNUSED_RESELLER_ACCOUNT

export interface AdAccount {
  id: string;
  account_id: string;
  account_status: AdAccountStatus;
  age: number;
  amount_spent: CurrencyAmount;
  balance: CurrencyAmount;
  business?: {
    id: string;
    name: string;
  };
  business_city?: string;
  business_country_code?: string;
  business_name?: string;
  business_state?: string;
  business_street?: string;
  business_zip?: string;
  currency: string;
  disable_reason?: DisableReason;
  end_advertiser?: string;
  end_advertiser_name?: string;
  funding_source?: string;
  funding_source_details?: FundingSourceDetails;
  has_page_authorized_adaccount?: boolean;
  min_campaign_group_spend_cap?: CurrencyAmount;
  min_daily_budget?: number;
  name: string;
  owner?: string;
  spend_cap?: CurrencyAmount;
  timezone_id: number;
  timezone_name: string;
  timezone_offset_hours_utc: number;
  created_time?: DateString;
}

export interface FundingSourceDetails {
  id: string;
  display_string?: string;
  type?: number;
}

export interface AdAccountListParams {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
}

export interface AdAccountUpdateParams {
  name?: string;
  spend_cap?: CurrencyAmount;
  end_advertiser?: string;
  media_agency?: string;
  partner?: string;
}

// ============================================
// Campaign Types
// ============================================

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
export type CampaignEffectiveStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'DELETED'
  | 'PENDING_REVIEW'
  | 'DISAPPROVED'
  | 'PREAPPROVED'
  | 'PENDING_BILLING_INFO'
  | 'CAMPAIGN_PAUSED'
  | 'ARCHIVED'
  | 'ADSET_PAUSED'
  | 'IN_PROCESS'
  | 'WITH_ISSUES';

export type CampaignObjective =
  | 'APP_INSTALLS'
  | 'BRAND_AWARENESS'
  | 'CONVERSIONS'
  | 'EVENT_RESPONSES'
  | 'LEAD_GENERATION'
  | 'LINK_CLICKS'
  | 'LOCAL_AWARENESS'
  | 'MESSAGES'
  | 'OFFER_CLAIMS'
  | 'OUTCOME_APP_PROMOTION'
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_SALES'
  | 'OUTCOME_TRAFFIC'
  | 'PAGE_LIKES'
  | 'POST_ENGAGEMENT'
  | 'PRODUCT_CATALOG_SALES'
  | 'REACH'
  | 'STORE_VISITS'
  | 'VIDEO_VIEWS';

export type BidStrategy =
  | 'LOWEST_COST_WITHOUT_CAP'
  | 'LOWEST_COST_WITH_BID_CAP'
  | 'COST_CAP'
  | 'LOWEST_COST_WITH_MIN_ROAS';

export type SpecialAdCategory = 'NONE' | 'EMPLOYMENT' | 'HOUSING' | 'CREDIT' | 'ISSUES_ELECTIONS_POLITICS';

export interface Campaign {
  id: string;
  account_id: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  effective_status: CampaignEffectiveStatus;
  bid_strategy?: BidStrategy;
  budget_remaining?: CurrencyAmount;
  buying_type?: string;
  daily_budget?: CurrencyAmount;
  lifetime_budget?: CurrencyAmount;
  spend_cap?: CurrencyAmount;
  special_ad_categories?: SpecialAdCategory[];
  special_ad_category?: SpecialAdCategory;
  start_time?: DateString;
  stop_time?: DateString;
  created_time?: DateString;
  updated_time?: DateString;
}

export interface CampaignCreateParams {
  name: string;
  objective: CampaignObjective;
  status?: CampaignStatus;
  special_ad_categories?: SpecialAdCategory[];
  bid_strategy?: BidStrategy;
  daily_budget?: CurrencyAmount;
  lifetime_budget?: CurrencyAmount;
  spend_cap?: CurrencyAmount;
  start_time?: DateString;
  stop_time?: DateString;
}

export interface CampaignUpdateParams {
  name?: string;
  status?: CampaignStatus;
  bid_strategy?: BidStrategy;
  daily_budget?: CurrencyAmount;
  lifetime_budget?: CurrencyAmount;
  spend_cap?: CurrencyAmount;
  start_time?: DateString;
  stop_time?: DateString;
}

export interface CampaignListParams {
  fields?: string[];
  effective_status?: CampaignEffectiveStatus[];
  date_preset?: DatePreset;
  limit?: number;
  after?: string;
  before?: string;
}

// ============================================
// Ad Set Types
// ============================================

export type AdSetStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
export type AdSetEffectiveStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'DELETED'
  | 'PENDING_REVIEW'
  | 'DISAPPROVED'
  | 'PREAPPROVED'
  | 'PENDING_BILLING_INFO'
  | 'CAMPAIGN_PAUSED'
  | 'ARCHIVED'
  | 'ADSET_PAUSED'
  | 'IN_PROCESS'
  | 'WITH_ISSUES';

export type OptimizationGoal =
  | 'NONE'
  | 'APP_INSTALLS'
  | 'AD_RECALL_LIFT'
  | 'ENGAGED_USERS'
  | 'EVENT_RESPONSES'
  | 'IMPRESSIONS'
  | 'LEAD_GENERATION'
  | 'QUALITY_LEAD'
  | 'LINK_CLICKS'
  | 'OFFSITE_CONVERSIONS'
  | 'PAGE_LIKES'
  | 'POST_ENGAGEMENT'
  | 'QUALITY_CALL'
  | 'REACH'
  | 'LANDING_PAGE_VIEWS'
  | 'VISIT_INSTAGRAM_PROFILE'
  | 'VALUE'
  | 'THRUPLAY'
  | 'DERIVED_EVENTS'
  | 'APP_INSTALLS_AND_OFFSITE_CONVERSIONS'
  | 'CONVERSATIONS'
  | 'IN_APP_VALUE'
  | 'MESSAGING_PURCHASE_CONVERSION'
  | 'SUBSCRIBERS'
  | 'REMINDERS_SET'
  | 'MEANINGFUL_CALL_ATTEMPT'
  | 'PROFILE_VISIT'
  | 'MESSAGING_APPOINTMENT_CONVERSION';

export type BillingEvent = 'APP_INSTALLS' | 'CLICKS' | 'IMPRESSIONS' | 'LINK_CLICKS' | 'NONE' | 'OFFER_CLAIMS' | 'PAGE_LIKES' | 'POST_ENGAGEMENT' | 'THRUPLAY' | 'PURCHASE' | 'LISTING_INTERACTION';

export interface Targeting {
  age_min?: number;
  age_max?: number;
  genders?: number[];
  geo_locations?: {
    countries?: string[];
    regions?: { key: string }[];
    cities?: { key: string; radius?: number; distance_unit?: string }[];
    zips?: { key: string }[];
    location_types?: string[];
  };
  excluded_geo_locations?: {
    countries?: string[];
    regions?: { key: string }[];
    cities?: { key: string }[];
    zips?: { key: string }[];
  };
  locales?: number[];
  interests?: { id: string; name?: string }[];
  behaviors?: { id: string; name?: string }[];
  custom_audiences?: { id: string; name?: string }[];
  excluded_custom_audiences?: { id: string; name?: string }[];
  connections?: { id: string }[];
  excluded_connections?: { id: string }[];
  friends_of_connections?: { id: string }[];
  flexible_spec?: FlexibleSpec[];
  exclusions?: FlexibleSpec;
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  messenger_positions?: string[];
  audience_network_positions?: string[];
  device_platforms?: string[];
  targeting_optimization?: string;
}

export interface FlexibleSpec {
  interests?: { id: string; name?: string }[];
  behaviors?: { id: string; name?: string }[];
  demographics?: { id: string; name?: string }[];
  life_events?: { id: string; name?: string }[];
  family_statuses?: { id: string; name?: string }[];
  industries?: { id: string; name?: string }[];
  income?: { id: string; name?: string }[];
  work_employers?: { id: string; name?: string }[];
  work_positions?: { id: string; name?: string }[];
  education_schools?: { id: string; name?: string }[];
  education_majors?: { id: string; name?: string }[];
  relationship_statuses?: number[];
}

export interface AdSet {
  id: string;
  account_id: string;
  campaign_id: string;
  name: string;
  status: AdSetStatus;
  effective_status: AdSetEffectiveStatus;
  optimization_goal?: OptimizationGoal;
  billing_event?: BillingEvent;
  bid_amount?: number;
  bid_strategy?: BidStrategy;
  daily_budget?: CurrencyAmount;
  lifetime_budget?: CurrencyAmount;
  budget_remaining?: CurrencyAmount;
  targeting?: Targeting;
  start_time?: DateString;
  end_time?: DateString;
  created_time?: DateString;
  updated_time?: DateString;
  promoted_object?: PromotedObject;
  destination_type?: string;
}

export interface PromotedObject {
  pixel_id?: string;
  custom_event_type?: string;
  page_id?: string;
  application_id?: string;
  object_store_url?: string;
  product_set_id?: string;
  offer_id?: string;
  event_id?: string;
  offline_conversion_data_set_id?: string;
}

export interface AdSetCreateParams {
  name: string;
  campaign_id: string;
  status?: AdSetStatus;
  optimization_goal: OptimizationGoal;
  billing_event: BillingEvent;
  bid_amount?: number;
  bid_strategy?: BidStrategy;
  daily_budget?: CurrencyAmount;
  lifetime_budget?: CurrencyAmount;
  targeting: Targeting;
  start_time?: DateString;
  end_time?: DateString;
  promoted_object?: PromotedObject;
  destination_type?: string;
}

export interface AdSetUpdateParams {
  name?: string;
  status?: AdSetStatus;
  optimization_goal?: OptimizationGoal;
  billing_event?: BillingEvent;
  bid_amount?: number;
  bid_strategy?: BidStrategy;
  daily_budget?: CurrencyAmount;
  lifetime_budget?: CurrencyAmount;
  targeting?: Targeting;
  start_time?: DateString;
  end_time?: DateString;
}

export interface AdSetListParams {
  fields?: string[];
  effective_status?: AdSetEffectiveStatus[];
  date_preset?: DatePreset;
  limit?: number;
  after?: string;
  before?: string;
}

// ============================================
// Ad Types
// ============================================

export type AdStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
export type AdEffectiveStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'DELETED'
  | 'PENDING_REVIEW'
  | 'DISAPPROVED'
  | 'PREAPPROVED'
  | 'PENDING_BILLING_INFO'
  | 'CAMPAIGN_PAUSED'
  | 'ARCHIVED'
  | 'ADSET_PAUSED'
  | 'IN_PROCESS'
  | 'WITH_ISSUES';

export interface Ad {
  id: string;
  account_id: string;
  campaign_id: string;
  adset_id: string;
  name: string;
  status: AdStatus;
  effective_status: AdEffectiveStatus;
  creative?: {
    id: string;
    name?: string;
  };
  tracking_specs?: TrackingSpec[];
  conversion_specs?: ConversionSpec[];
  created_time?: DateString;
  updated_time?: DateString;
  preview_shareable_link?: string;
}

export interface TrackingSpec {
  action_type?: string[];
  fb_pixel?: string[];
  application?: string[];
  page?: string[];
  post?: string[];
  offsite_pixel?: string[];
  offer?: string[];
  product_set?: string[];
}

export interface ConversionSpec {
  action_type?: string[];
  pixel?: string[];
  page?: string[];
  post?: string[];
  application?: string[];
  offsite_pixel?: string[];
  event?: string[];
  event_creator?: string[];
  offer?: string[];
}

export interface AdCreateParams {
  name: string;
  adset_id: string;
  creative: { creative_id: string } | AdCreativeSpec;
  status?: AdStatus;
  tracking_specs?: TrackingSpec[];
  conversion_specs?: ConversionSpec[];
}

export interface AdUpdateParams {
  name?: string;
  status?: AdStatus;
  creative?: { creative_id: string };
  tracking_specs?: TrackingSpec[];
}

export interface AdListParams {
  fields?: string[];
  effective_status?: AdEffectiveStatus[];
  date_preset?: DatePreset;
  limit?: number;
  after?: string;
  before?: string;
}

// ============================================
// Ad Creative Types
// ============================================

export interface AdCreative {
  id: string;
  name?: string;
  account_id: string;
  actor_id?: string;
  body?: string;
  call_to_action_type?: CallToActionType;
  effective_instagram_media_id?: string;
  effective_instagram_story_id?: string;
  effective_object_story_id?: string;
  image_hash?: string;
  image_url?: string;
  instagram_actor_id?: string;
  instagram_permalink_url?: string;
  link_og_id?: string;
  link_url?: string;
  object_id?: string;
  object_story_id?: string;
  object_story_spec?: ObjectStorySpec;
  object_type?: string;
  object_url?: string;
  platform_customizations?: Record<string, unknown>;
  product_set_id?: string;
  status?: string;
  template_url?: string;
  template_url_spec?: Record<string, unknown>;
  thumbnail_url?: string;
  title?: string;
  url_tags?: string;
  video_id?: string;
  created_time?: DateString;
}

export type CallToActionType =
  | 'ADD_TO_CART'
  | 'APPLY_NOW'
  | 'BOOK_TRAVEL'
  | 'BUY'
  | 'BUY_NOW'
  | 'BUY_TICKETS'
  | 'CALL'
  | 'CALL_ME'
  | 'CONTACT'
  | 'CONTACT_US'
  | 'DONATE'
  | 'DONATE_NOW'
  | 'DOWNLOAD'
  | 'EVENT_RSVP'
  | 'FIND_A_GROUP'
  | 'FIND_YOUR_GROUPS'
  | 'FOLLOW_NEWS_STORYLINE'
  | 'FOLLOW_PAGE'
  | 'FOLLOW_USER'
  | 'GET_DIRECTIONS'
  | 'GET_OFFER'
  | 'GET_OFFER_VIEW'
  | 'GET_QUOTE'
  | 'GET_SHOWTIMES'
  | 'INSTALL_APP'
  | 'INSTALL_MOBILE_APP'
  | 'LEARN_MORE'
  | 'LIKE_PAGE'
  | 'LISTEN_MUSIC'
  | 'LISTEN_NOW'
  | 'MESSAGE_PAGE'
  | 'MOBILE_DOWNLOAD'
  | 'MOMENTS'
  | 'NO_BUTTON'
  | 'OPEN_LINK'
  | 'ORDER_NOW'
  | 'PAY_TO_ACCESS'
  | 'PLAY_GAME'
  | 'PLAY_GAME_ON_FACEBOOK'
  | 'PURCHASE_GIFT_CARDS'
  | 'RECORD_NOW'
  | 'REFER_FRIENDS'
  | 'REQUEST_TIME'
  | 'SAY_THANKS'
  | 'SEE_MORE'
  | 'SELL_NOW'
  | 'SEND_A_GIFT'
  | 'SHARE'
  | 'SHOP_NOW'
  | 'SIGN_UP'
  | 'SOTTO_SUBSCRIBE'
  | 'START_ORDER'
  | 'SUBSCRIBE'
  | 'SWIPE_UP_PRODUCT'
  | 'SWIPE_UP_SHOP'
  | 'UPDATE_APP'
  | 'USE_APP'
  | 'USE_MOBILE_APP'
  | 'VIDEO_ANNOTATION'
  | 'VIDEO_CALL'
  | 'VISIT_PAGES_FEED'
  | 'WATCH_MORE'
  | 'WATCH_VIDEO'
  | 'WHATSAPP_MESSAGE'
  | 'WOODHENGE_SUPPORT';

export interface ObjectStorySpec {
  page_id: string;
  link_data?: LinkData;
  photo_data?: PhotoData;
  video_data?: VideoData;
  template_data?: TemplateData;
  instagram_actor_id?: string;
}

export interface LinkData {
  link: string;
  message?: string;
  name?: string;
  description?: string;
  caption?: string;
  image_hash?: string;
  picture?: string;
  call_to_action?: {
    type: CallToActionType;
    value?: {
      link?: string;
      app_link?: string;
      lead_gen_form_id?: string;
    };
  };
  child_attachments?: ChildAttachment[];
  multi_share_optimized?: boolean;
  multi_share_end_card?: boolean;
}

export interface PhotoData {
  image_hash?: string;
  url?: string;
  caption?: string;
}

export interface VideoData {
  video_id?: string;
  image_hash?: string;
  image_url?: string;
  title?: string;
  message?: string;
  link_description?: string;
  call_to_action?: {
    type: CallToActionType;
    value?: {
      link?: string;
    };
  };
}

export interface TemplateData {
  description?: string;
  link?: string;
  message?: string;
  name?: string;
  picture?: string;
  call_to_action?: {
    type: CallToActionType;
    value?: {
      link?: string;
    };
  };
}

export interface ChildAttachment {
  link: string;
  name?: string;
  description?: string;
  image_hash?: string;
  picture?: string;
  video_id?: string;
  call_to_action?: {
    type: CallToActionType;
    value?: {
      link?: string;
    };
  };
}

export interface AdCreativeSpec {
  name?: string;
  object_story_spec?: ObjectStorySpec;
  object_story_id?: string;
  title?: string;
  body?: string;
  image_hash?: string;
  image_url?: string;
  video_id?: string;
  link_url?: string;
  call_to_action_type?: CallToActionType;
  url_tags?: string;
}

export interface AdCreativeCreateParams {
  name?: string;
  object_story_spec?: ObjectStorySpec;
  object_story_id?: string;
  title?: string;
  body?: string;
  image_hash?: string;
  image_url?: string;
  video_id?: string;
  link_url?: string;
  call_to_action_type?: CallToActionType;
  url_tags?: string;
}

export interface AdCreativeListParams {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
}

// ============================================
// Audience Types
// ============================================

export type CustomAudienceSubtype =
  | 'CUSTOM'
  | 'WEBSITE'
  | 'APP'
  | 'OFFLINE_CONVERSION'
  | 'CLAIM'
  | 'PARTNER'
  | 'MANAGED'
  | 'VIDEO'
  | 'LOOKALIKE'
  | 'ENGAGEMENT'
  | 'BAG_OF_ACCOUNTS'
  | 'STUDY_RULE_AUDIENCE'
  | 'FOX'
  | 'MEASUREMENT'
  | 'REGULATED_CATEGORIES_AUDIENCE';

export interface CustomAudience {
  id: string;
  account_id: string;
  name: string;
  description?: string;
  subtype: CustomAudienceSubtype;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
  customer_file_source?: string;
  data_source?: {
    type?: string;
    sub_type?: string;
  };
  delivery_status?: {
    code: number;
    description: string;
  };
  is_value_based?: boolean;
  lookalike_audience_ids?: string[];
  lookalike_spec?: LookalikeSpec;
  operation_status?: {
    code: number;
    description: string;
  };
  permission_for_actions?: {
    can_edit?: boolean;
    can_see_insight?: boolean;
    can_share?: boolean;
    subtype_supports_lookalike?: boolean;
    supports_recipient_lookalike?: boolean;
  };
  pixel_id?: string;
  retention_days?: number;
  rule?: string;
  rule_aggregation?: string;
  sharing_status?: {
    id: string;
    name: string;
  };
  time_content_updated?: number;
  time_created?: number;
  time_updated?: number;
}

export interface LookalikeSpec {
  country?: string;
  is_financial_service?: boolean;
  origin?: { id: string; name?: string; type?: string }[];
  origin_event_name?: string;
  origin_event_source_name?: string;
  origin_event_source_type?: string;
  product_set_id?: string;
  ratio?: number;
  starting_ratio?: number;
  target_countries?: string[];
  type?: string;
}

export interface CustomAudienceCreateParams {
  name: string;
  description?: string;
  subtype?: CustomAudienceSubtype;
  customer_file_source?: 'USER_PROVIDED_ONLY' | 'PARTNER_PROVIDED_ONLY' | 'BOTH_USER_AND_PARTNER_PROVIDED';
  lookalike_spec?: {
    origin_audience_id: string;
    starting_ratio?: number;
    ratio: number;
    country?: string;
    location_spec?: {
      geo_locations: {
        countries?: string[];
        regions?: { key: string }[];
        cities?: { key: string }[];
      };
    };
  };
  rule?: string;
  prefill?: boolean;
  pixel_id?: string;
  retention_days?: number;
}

export interface CustomAudienceUpdateParams {
  name?: string;
  description?: string;
  opt_out_link?: string;
}

export interface CustomAudienceAddUsersParams {
  schema: string[] | 'EMAIL_SHA256' | 'PHONE_SHA256' | 'MOBILE_ADVERTISER_ID' | 'EXTERN_ID';
  data: string[][];
  app_ids?: string[];
  is_raw?: boolean;
}

export interface CustomAudienceListParams {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
}

export interface SavedAudience {
  id: string;
  account_id: string;
  name: string;
  description?: string;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
  delete_time?: number;
  permission_for_actions?: {
    can_edit?: boolean;
  };
  run_status?: string;
  sentence_lines?: string[];
  targeting?: Targeting;
  time_created?: number;
  time_updated?: number;
}

// ============================================
// Insights Types
// ============================================

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'maximum'
  | 'data_maximum'
  | 'last_3d'
  | 'last_7d'
  | 'last_14d'
  | 'last_28d'
  | 'last_30d'
  | 'last_90d'
  | 'last_week_mon_sun'
  | 'last_week_sun_sat'
  | 'last_quarter'
  | 'last_year'
  | 'this_week_mon_today'
  | 'this_week_sun_today'
  | 'this_year';

export type InsightsBreakdown =
  | 'ad_format_asset'
  | 'age'
  | 'app_id'
  | 'body_asset'
  | 'call_to_action_asset'
  | 'coarse_conversion_value'
  | 'country'
  | 'description_asset'
  | 'device_platform'
  | 'dma'
  | 'fidelity_type'
  | 'frequency_value'
  | 'gender'
  | 'hourly_stats_aggregated_by_advertiser_time_zone'
  | 'hourly_stats_aggregated_by_audience_time_zone'
  | 'hsid'
  | 'image_asset'
  | 'impression_device'
  | 'is_conversion_id_modeled'
  | 'link_url_asset'
  | 'marketing_messages_btn_name'
  | 'mdsa_landing_destination'
  | 'media_asset_url'
  | 'media_creator'
  | 'media_destination_url'
  | 'media_format'
  | 'media_origin_url'
  | 'media_text_content'
  | 'mmm'
  | 'place_page_id'
  | 'platform_position'
  | 'postback_sequence_index'
  | 'product_id'
  | 'publisher_platform'
  | 'redownload'
  | 'region'
  | 'skan_campaign_id'
  | 'skan_conversion_id'
  | 'skan_version'
  | 'standard_event_content_type'
  | 'title_asset'
  | 'video_asset';

export type InsightsLevel = 'account' | 'campaign' | 'adset' | 'ad';

export type ActionBreakdown =
  | 'action_canvas_component_name'
  | 'action_carousel_card_id'
  | 'action_carousel_card_name'
  | 'action_destination'
  | 'action_device'
  | 'action_reaction'
  | 'action_target_id'
  | 'action_type'
  | 'action_video_sound'
  | 'action_video_type';

export interface InsightsParams {
  date_preset?: DatePreset;
  time_range?: {
    since: string;
    until: string;
  };
  time_increment?: number | 'monthly' | 'all_days';
  breakdowns?: InsightsBreakdown[];
  action_breakdowns?: ActionBreakdown[];
  level?: InsightsLevel;
  filtering?: InsightsFilter[];
  fields?: string[];
  sort?: string[];
  limit?: number;
  after?: string;
  use_account_attribution_setting?: boolean;
}

export interface InsightsFilter {
  field: string;
  operator: 'EQUAL' | 'NOT_EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'IN_RANGE' | 'NOT_IN_RANGE' | 'CONTAIN' | 'NOT_CONTAIN' | 'IN' | 'NOT_IN' | 'STARTS_WITH' | 'ENDS_WITH' | 'ANY' | 'ALL' | 'AFTER' | 'BEFORE' | 'ON_OR_AFTER' | 'ON_OR_BEFORE' | 'NONE' | 'TOP';
  value: string | number | string[] | number[];
}

export interface Insights {
  account_id?: string;
  account_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start: string;
  date_stop: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  reach?: string;
  frequency?: string;
  cpc?: string;
  cpm?: string;
  cpp?: string;
  ctr?: string;
  unique_clicks?: string;
  unique_ctr?: string;
  cost_per_unique_click?: string;
  actions?: Action[];
  conversions?: Action[];
  cost_per_action_type?: Action[];
  cost_per_conversion?: Action[];
  video_avg_time_watched_actions?: Action[];
  video_p25_watched_actions?: Action[];
  video_p50_watched_actions?: Action[];
  video_p75_watched_actions?: Action[];
  video_p100_watched_actions?: Action[];
  website_ctr?: Action[];
  website_purchase_roas?: Action[];
  purchase_roas?: Action[];
  mobile_app_purchase_roas?: Action[];
  // Breakdown fields
  age?: string;
  gender?: string;
  country?: string;
  region?: string;
  publisher_platform?: string;
  platform_position?: string;
  impression_device?: string;
  device_platform?: string;
}

export interface Action {
  action_type: string;
  value: string;
  '1d_click'?: string;
  '1d_view'?: string;
  '7d_click'?: string;
  '7d_view'?: string;
  '28d_click'?: string;
  '28d_view'?: string;
}

// ============================================
// Facebook Page Types
// ============================================

export interface Page {
  id: string;
  name: string;
  about?: string;
  access_token?: string;
  bio?: string;
  can_checkin?: boolean;
  can_post?: boolean;
  category?: string;
  category_list?: { id: string; name: string }[];
  checkins?: number;
  contact_address?: PageAddress;
  cover?: PageCover;
  current_location?: string;
  description?: string;
  description_html?: string;
  display_subtext?: string;
  emails?: string[];
  engagement?: {
    count?: number;
    social_sentence?: string;
  };
  fan_count?: number;
  followers_count?: number;
  founded?: string;
  general_info?: string;
  global_brand_page_name?: string;
  hours?: Record<string, string>;
  is_always_open?: boolean;
  is_community_page?: boolean;
  is_owned?: boolean;
  is_published?: boolean;
  is_unclaimed?: boolean;
  is_verified?: boolean;
  is_webhooks_subscribed?: boolean;
  link?: string;
  location?: PageLocation;
  members?: string;
  mission?: string;
  new_like_count?: number;
  overall_star_rating?: number;
  phone?: string;
  picture?: {
    data: {
      height: number;
      is_silhouette: boolean;
      url: string;
      width: number;
    };
  };
  place_type?: string;
  price_range?: string;
  rating_count?: number;
  single_line_address?: string;
  talking_about_count?: number;
  username?: string;
  verification_status?: string;
  website?: string;
  were_here_count?: number;
}

export interface PageAddress {
  city?: string;
  city_id?: string;
  country?: string;
  postal_code?: string;
  region?: string;
  street1?: string;
  street2?: string;
}

export interface PageCover {
  cover_id?: string;
  offset_x?: number;
  offset_y?: number;
  source?: string;
  id?: string;
}

export interface PageLocation {
  city?: string;
  city_id?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  located_in?: string;
  longitude?: number;
  name?: string;
  region?: string;
  region_id?: string;
  state?: string;
  street?: string;
  zip?: string;
}

export interface PageListParams {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
}

// ============================================
// Instagram Types
// ============================================

export interface InstagramAccount {
  id: string;
  ig_id?: number;
  name?: string;
  username?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  website?: string;
  is_private?: boolean;
  is_published?: boolean;
}

export interface InstagramMedia {
  id: string;
  ig_id?: string;
  caption?: string;
  comments_count?: number;
  is_comment_enabled?: boolean;
  like_count?: number;
  media_product_type?: string;
  media_type?: 'CAROUSEL_ALBUM' | 'IMAGE' | 'VIDEO';
  media_url?: string;
  owner?: { id: string };
  permalink?: string;
  shortcode?: string;
  thumbnail_url?: string;
  timestamp?: DateString;
  username?: string;
}

export interface InstagramMediaListParams {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
}

// ============================================
// Pixel Types
// ============================================

export interface Pixel {
  id: string;
  name: string;
  code?: string;
  creation_time?: DateString;
  creator?: { id: string; name?: string };
  data_use_setting?: string;
  enable_automatic_matching?: boolean;
  first_party_cookie_status?: string;
  is_created_by_business?: boolean;
  is_crm?: boolean;
  is_mta_use?: boolean;
  is_unavailable?: boolean;
  last_fired_time?: DateString;
  owner_ad_account?: { id: string; name?: string };
  owner_business?: { id: string; name?: string };
}

export interface PixelListParams {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
}

export interface ConversionsApiEvent {
  event_name: string;
  event_time: number;
  event_id?: string;
  event_source_url?: string;
  opt_out?: boolean;
  action_source: 'email' | 'website' | 'app' | 'phone_call' | 'chat' | 'physical_store' | 'system_generated' | 'business_messaging' | 'other';
  user_data: ConversionsApiUserData;
  custom_data?: ConversionsApiCustomData;
  data_processing_options?: string[];
  data_processing_options_country?: number;
  data_processing_options_state?: number;
}

export interface ConversionsApiUserData {
  em?: string | string[];
  ph?: string | string[];
  ge?: string | string[];
  db?: string | string[];
  ln?: string | string[];
  fn?: string | string[];
  ct?: string | string[];
  st?: string | string[];
  zp?: string | string[];
  country?: string | string[];
  external_id?: string | string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbp?: string;
  subscription_id?: string;
  fb_login_id?: string;
  lead_id?: string;
  dobd?: string;
  dobm?: string;
  doby?: string;
  madid?: string;
  anon_id?: string;
  app_user_id?: string;
  ctwa_clid?: string;
  page_id?: string;
  page_scoped_user_id?: string;
}

export interface ConversionsApiCustomData {
  value?: number;
  currency?: string;
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
  contents?: { id: string; quantity?: number; item_price?: number; delivery_category?: string }[];
  content_type?: 'product' | 'product_group';
  order_id?: string;
  predicted_ltv?: number;
  num_items?: number;
  search_string?: string;
  status?: 'completed' | 'updated' | 'cancelled' | 'refund_requested' | 'refunded' | 'disputed';
  item_number?: string;
  delivery_category?: 'in_store' | 'curbside' | 'home_delivery';
  custom_properties?: Record<string, string | number | boolean>;
}

export interface ConversionsApiResponse {
  events_received: number;
  messages?: string[];
  fbtrace_id?: string;
}

// ============================================
// Product Catalog Types
// ============================================

export interface ProductCatalog {
  id: string;
  name: string;
  business?: { id: string; name?: string };
  commerce_merchant_settings?: { id: string };
  da_display_settings?: { id: string };
  default_image_url?: string;
  fallback_image_url?: string[];
  feed_count?: number;
  is_catalog_segment?: boolean;
  product_count?: number;
  store_catalog_settings?: { id: string };
  vertical?: string;
}

export interface ProductCatalogCreateParams {
  name: string;
  vertical?: 'commerce' | 'da' | 'hotels' | 'flights' | 'destinations' | 'home_listings' | 'vehicles' | 'offline_commerce';
}

export interface ProductCatalogListParams {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
}

export interface ProductFeed {
  id: string;
  name: string;
  country?: string;
  created_time?: DateString;
  default_currency?: string;
  deletion_enabled?: boolean;
  delimiter?: 'AUTODETECT' | 'BAR' | 'COMMA' | 'TAB' | 'TILDE' | 'SEMICOLON';
  encoding?: string;
  file_name?: string;
  latest_upload?: {
    id: string;
    end_time?: DateString;
    error_count?: number;
    error_report?: string;
    num_deleted_items?: number;
    num_detected_items?: number;
    num_invalid_items?: number;
    num_persisted_items?: number;
    start_time?: DateString;
    status?: string;
    url?: string;
    warning_count?: number;
  };
  product_count?: number;
  schedule?: FeedSchedule;
}

export interface FeedSchedule {
  day_of_month?: number;
  day_of_week?: 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
  hour?: number;
  interval?: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval_count?: number;
  minute?: number;
  timezone?: string;
  url?: string;
  username?: string;
  password?: string;
}

export interface ProductFeedCreateParams {
  name: string;
  schedule?: FeedSchedule;
  file_name?: string;
  encoding?: string;
  delimiter?: 'AUTODETECT' | 'BAR' | 'COMMA' | 'TAB' | 'TILDE' | 'SEMICOLON';
  quoted_fields_mode?: 'AUTODETECT' | 'ON' | 'OFF';
}

export interface ProductItem {
  id: string;
  name: string;
  availability?: 'in stock' | 'out of stock' | 'preorder' | 'available for order' | 'discontinued' | 'pending';
  brand?: string;
  category?: string;
  condition?: 'new' | 'refurbished' | 'used';
  currency?: string;
  custom_data?: Record<string, string>;
  custom_label_0?: string;
  custom_label_1?: string;
  custom_label_2?: string;
  custom_label_3?: string;
  custom_label_4?: string;
  description?: string;
  gender?: 'female' | 'male' | 'unisex';
  gtin?: string;
  image_url?: string;
  manufacturer_part_number?: string;
  material?: string;
  pattern?: string;
  price?: string;
  product_type?: string;
  retailer_id?: string;
  retailer_product_group_id?: string;
  sale_price?: string;
  sale_price_end_date?: DateString;
  sale_price_start_date?: DateString;
  short_description?: string;
  size?: string;
  url?: string;
  visibility?: 'staging' | 'published';
}

export interface ProductSet {
  id: string;
  name: string;
  auto_creation_url?: string;
  filter?: string;
  product_catalog?: { id: string; name?: string };
  product_count?: number;
}

// ============================================
// Business Manager Types
// ============================================

export interface Business {
  id: string;
  name: string;
  created_by?: { id: string; name?: string };
  created_time?: DateString;
  link?: string;
  primary_page?: { id: string; name?: string };
  profile_picture_uri?: string;
  timezone_id?: number;
  two_factor_type?: string;
  updated_by?: { id: string; name?: string };
  updated_time?: DateString;
  verification_status?: string;
  vertical?: string;
}

export interface BusinessUser {
  id: string;
  name: string;
  business?: { id: string; name?: string };
  email?: string;
  first_name?: string;
  last_name?: string;
  pending_email?: string;
  role?: string;
  title?: string;
  two_fac_status?: string;
}

export interface BusinessAssetGroup {
  id: string;
  name: string;
}

export interface BusinessListParams {
  fields?: string[];
  limit?: number;
  after?: string;
  before?: string;
}

// ============================================
// Ad Image Types
// ============================================

export interface AdImage {
  id: string;
  hash: string;
  name?: string;
  account_id: string;
  created_time?: DateString;
  creatives?: string[];
  height?: number;
  original_height?: number;
  original_width?: number;
  permalink_url?: string;
  status?: string;
  updated_time?: DateString;
  url?: string;
  url_128?: string;
  width?: number;
}

export interface AdImageUploadParams {
  bytes?: string; // Base64 encoded image
  filename?: string;
  copy_from?: {
    source_account_id: string;
    hash: string;
  };
}

// ============================================
// Ad Video Types
// ============================================

export interface AdVideo {
  id: string;
  title?: string;
  description?: string;
  embed_html?: string;
  embeddable?: boolean;
  format?: { embed_html?: string; filter?: string; height?: number; picture?: string; width?: number }[];
  icon?: string;
  length?: number;
  permalink_url?: string;
  picture?: string;
  source?: string;
  status?: { video_status?: string };
  thumbnails?: { data: { id: string; height: number; is_preferred: boolean; scale: number; uri: string; width: number }[] };
  updated_time?: DateString;
  created_time?: DateString;
}

export interface AdVideoCreateParams {
  file_url?: string;
  source?: string; // File path for multipart upload
  title?: string;
  description?: string;
  thumb?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

export class MetaApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: number;
  public readonly errorSubcode?: number;
  public readonly errorType?: string;
  public readonly fbtraceId?: string;

  constructor(message: string, statusCode: number, details?: Partial<ApiErrorDetail>) {
    super(message);
    this.name = 'MetaApiError';
    this.statusCode = statusCode;
    this.errorCode = details?.code;
    this.errorSubcode = details?.error_subcode;
    this.errorType = details?.type;
    this.fbtraceId = details?.fbtrace_id;
  }
}
