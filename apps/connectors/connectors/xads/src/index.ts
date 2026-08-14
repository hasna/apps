// X Ads Connector
// TypeScript wrapper for the Twitter/X Ads API

export { XAds } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  XAdsClient,
  AccountsApi,
  CampaignsApi,
  LineItemsApi,
  PromotedTweetsApi,
  TargetingApi,
  AudiencesApi,
  AnalyticsApi,
  MediaApi,
} from './api';

// Export config utilities
export {
  getConsumerKey,
  getConsumerSecret,
  getAccessToken,
  getAccessTokenSecret,
  getAccountId,
  setConsumerKey,
  setConsumerSecret,
  setAccessToken,
  setAccessTokenSecret,
  setAccountId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  hasOAuthCredentials,
} from './utils/config';
