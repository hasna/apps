// TikTok Marketing API
// TypeScript client for TikTok's Marketing API

export { TikTok } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  TikTokClient,
  AdvertisersApi,
  CampaignsApi,
  AdGroupsApi,
  AdsApi,
  CreativesApi,
  AudiencesApi,
  TargetingApi,
  ReportsApi,
  BusinessApi,
  PixelsApi,
  EventsApi,
  CatalogsApi,
  IdentityApi,
} from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getDefaultAdvertiserId,
  setDefaultAdvertiserId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
