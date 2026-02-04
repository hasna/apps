// Google Drive API Connector
// A TypeScript wrapper for Google Drive with OAuth2 authentication

export { Drive } from './api/index.ts';
export * from './types/index.ts';

// Re-export individual API classes for advanced usage
export {
  DriveClient,
  FilesApi,
  FoldersApi,
  TrashApi,
  StorageApi,
} from './api/index.ts';

// Export auth utilities
export {
  getAuthUrl,
  startCallbackServer,
  refreshAccessToken,
  getValidAccessToken,
} from './utils/auth.ts';

// Export config utilities
export {
  isAuthenticated,
  loadTokens,
  saveTokens,
  clearConfig,
} from './utils/config.ts';
