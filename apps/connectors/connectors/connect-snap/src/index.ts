// Snapchat Marketing API
// TypeScript client for Snapchat's Ads API

export { Snap } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  SnapClient,
  exchangeCodeForTokens,
  generateAuthUrl,
  OrganizationsApi,
  AccountsApi,
  CampaignsApi,
  AdSquadsApi,
  AdsApi,
  CreativesApi,
  MediaApi,
  AudiencesApi,
  TargetingApi,
  StatsApi,
  PixelsApi,
  ConversionsApi,
  CatalogsApi,
  LeadsApi,
} from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  setTokens,
  isTokenExpired,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getDefaultOrganizationId,
  setDefaultOrganizationId,
  getDefaultAdAccountId,
  setDefaultAdAccountId,
} from './utils/config';
