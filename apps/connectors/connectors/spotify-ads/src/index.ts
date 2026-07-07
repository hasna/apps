export { SpotifyAds } from './api';
export * from './types';
export {
  SpotifyAdsClient,
  DEFAULT_BASE_URL,
  BusinessesApi,
  AdAccountsApi,
  CampaignsApi,
  AdSetsApi,
  AdsApi,
} from './api';

export {
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  getClientId,
  getClientSecret,
  setCredentials,
  loadTokens,
  saveTokens,
  clearTokens,
  isAuthenticated,
  getAdAccountId,
  setAdAccountId,
  getBusinessId,
  setBusinessId,
  getBaseUrl,
  getAccessToken,
  clearConfig,
  getConfigDir,
  getBaseConfigDir,
  setProfileOverride,
} from './utils/config';

export {
  getAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  startCallbackServer,
  getValidAccessToken,
  getRedirectUri,
  getRedirectPort,
  type AuthResult,
} from './utils/auth';

export { success, error, info, warn, print, type OutputFormat } from './utils/output';
