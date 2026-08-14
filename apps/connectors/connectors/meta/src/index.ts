// Meta Marketing API
// TypeScript client for Meta/Facebook Marketing API

export { Meta } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  MetaClient,
  AccountsApi,
  CampaignsApi,
  AdSetsApi,
  AdsApi,
  CreativesApi,
  AudiencesApi,
  InsightsApi,
  PagesApi,
  InstagramApi,
  PixelsApi,
  CatalogsApi,
  BusinessApi,
} from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getDefaultAdAccountId,
  setDefaultAdAccountId,
  getDefaultPixelId,
  setDefaultPixelId,
  getDefaultBusinessId,
  setDefaultBusinessId,
  formatAdAccountId,
  stripAdAccountPrefix,
} from './utils/config';
