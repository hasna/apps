// Google Photos API Connector
// A TypeScript wrapper for Google Photos with OAuth2 authentication

export { GooglePhotos } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  PhotosClient,
  AlbumsApi,
  MediaApi,
  UploadApi,
} from './api';

// Export auth utilities
export {
  getAuthUrl,
  startCallbackServer,
  refreshAccessToken,
  getValidAccessToken,
  getUserInfo,
} from './utils/auth';

// Export config utilities
export {
  isAuthenticated,
  loadTokens,
  saveTokens,
  clearConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
} from './utils/config';
