// Telnyx Connect
// A TypeScript wrapper for the Telnyx v2 API

export { Telnyx } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  TelnyxClient,
  MessagesApi,
  PhoneNumbersApi,
  AvailableNumbersApi,
  MessagingProfilesApi,
  NumberLookupApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadConfig,
  saveConfig,
  clearConfig,
  isAuthenticated,
} from './utils/config';
