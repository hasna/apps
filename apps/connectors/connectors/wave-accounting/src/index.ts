// Wave Accounting Connector
// TypeScript wrapper for Wave's public GraphQL API

export { WaveAccounting, WaveGraphQLClient } from './api';
export * from './types';

export {
  getAccessToken,
  setAccessToken,
  getBusinessId,
  setBusinessId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getOAuthConfig,
  setOAuthConfig,
  loadOAuthTokens,
  saveOAuthTokens,
  clearOAuthTokens,
} from './utils/config';

export {
  getAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getValidAccessToken,
  isAuthenticated,
  getRedirectUri,
  getDefaultScopes,
} from './utils/auth';
