// Resend API Connector
// A TypeScript wrapper for the Resend Email API

export { Resend } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ResendClient,
  EmailsApi,
  TemplatesApi,
  DomainsApi,
  ApiKeysApi,
  AudiencesApi,
  ContactsApi,
  WebhooksApi,
  BroadcastsApi,
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
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
