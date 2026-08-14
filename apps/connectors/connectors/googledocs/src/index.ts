// Google Docs API Connector
// A TypeScript wrapper for Google Docs API v1

export { GoogleDocs } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { GoogleDocsClient, DocumentsApi, ContentApi, StylesApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
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
} from './utils/config';
