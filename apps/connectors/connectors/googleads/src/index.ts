// Main exports
export { GoogleAds, GoogleAdsClient, CampaignsApi, AdGroupsApi, AdsApi, KeywordsApi, ReportsApi } from './api';

// Types
export type {
  GoogleAdsConfig,
  SearchResponse,
  MutateResponse,
  Campaign,
  CampaignBudget,
  AdGroup,
  Ad,
  Keyword,
  Asset,
  ConversionAction,
  Audience,
  Metrics,
  CampaignStatus,
  AdGroupStatus,
  AdStatus,
  AdGroupCriterionStatus,
  KeywordMatchType,
  GoogleAdsError as GoogleAdsErrorType,
} from './types';

export { GoogleAdsError } from './types';

// Utils
export {
  success,
  error,
  info,
  warn,
  print,
  formatMicros,
  formatNumber,
  formatPercent,
  formatCustomerId,
  parseCustomerId,
} from './utils/output';
