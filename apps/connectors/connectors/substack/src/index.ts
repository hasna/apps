// Substack Connector
// TypeScript wrapper for Substack API (unofficial)

export { Substack } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  SubstackClient,
  PostsApi,
  SubscribersApi,
  CommentsApi,
  StatsApi,
  PublicationApi,
} from './api';

// Export config utilities
export {
  getSubdomain,
  setSubdomain,
  getToken,
  setToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
