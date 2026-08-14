// X (Twitter) API v2 Connector
// A TypeScript wrapper for the X (Twitter) API v2

export { X, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { XClient, TweetsApi, UsersApi, MediaApi, OAuth1Client } from './api';

// Export OAuth utilities
export {
  generatePKCE,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
  startCallbackServer,
  getAuthenticatedUser,
  OAUTH2_SCOPES,
  DEFAULT_SCOPES,
  type OAuth2Config,
  type OAuth2Tokens,
  type PKCEChallenge,
  type OAuth2Scope,
} from './api/oauth';

export {
  buildOAuth1Header,
  getRequestToken,
  buildOAuth1AuthorizationUrl,
  getAccessToken as exchangeOAuth1Verifier,
  oauth1Request,
  type OAuth1Config,
  type OAuth1Tokens,
  type OAuth1RequestToken,
} from './api/oauth1';

// Export config utilities
export {
  // Profile management
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  profileExists,
  // App credentials
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getBearerToken,
  setBearerToken,
  // OAuth 2.0 client credentials
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  // OAuth 2.0 user tokens
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  getTokenExpiresAt,
  setTokenExpiresAt,
  getTokenScopes,
  setTokenScopes,
  isTokenExpired,
  // OAuth 1.0a tokens
  getOAuth1AccessToken,
  setOAuth1AccessToken,
  getOAuth1AccessTokenSecret,
  setOAuth1AccessTokenSecret,
  // User info
  getUserId,
  setUserId,
  getUsername,
  setUsername,
  // Batch operations
  saveOAuth2Tokens,
  saveOAuth1Tokens,
  clearUserTokens,
  // Auth status helpers
  hasUserAuth,
  hasOAuth2Auth,
  hasOAuth1Auth,
  // Utility
  clearConfig,
  getConfigDir,
} from './utils/config';
