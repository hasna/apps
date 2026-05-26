// Google Contacts Connector
// A TypeScript wrapper for the Google People API (Contacts)

export { GoogleContacts } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { GoogleContactsClient, ContactsApi } from './api';

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
  getRedirectUri,
  setRedirectUri,
  saveTokens,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  hasOAuthCredentials,
  hasAccessTokens,
  isTokenExpired,
} from './utils/config';
