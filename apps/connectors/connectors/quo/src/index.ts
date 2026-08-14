// Quo (OpenPhone) API Connector
// A TypeScript wrapper for the Quo/OpenPhone messaging and calling API

export { Quo } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  QuoClient,
  MessagesApi,
  ContactsApi,
  ConversationsApi,
  CallsApi,
  PhoneNumbersApi,
  UsersApi,
  WebhooksApi,
  CustomFieldsApi,
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
