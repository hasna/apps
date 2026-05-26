// Twilio Connect
// A TypeScript wrapper for the Twilio API

export { Twilio } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  TwilioClient,
  MessagesApi,
  CallsApi,
  NumbersApi,
  VerifyApi,
  ConversationsApi,
  VideoApi,
  LookupApi,
  AccountsApi,
} from './api';

// Export config utilities
export {
  getAccountSid,
  setAccountSid,
  getAuthToken,
  setAuthToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadConfig,
  saveConfig,
  clearConfig,
} from './utils/config';
