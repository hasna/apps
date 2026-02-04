// Reddit Connector
// TypeScript wrapper for Reddit API with OAuth2 authentication

export { Reddit } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { RedditClient, PostsApi, CommentsApi, SubredditsApi, UsersApi, SearchApi } from './api';

// Export config utilities
export {
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  getTokenExpiresAt,
  setTokenExpiresAt,
  getScope,
  setScope,
  getUsername,
  setUsername,
  isTokenExpired,
  saveTokens,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
