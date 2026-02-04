// Gmail API Connector
// A TypeScript wrapper for Gmail with OAuth2 authentication

export { Gmail } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  GmailClient,
  MessagesApi,
  LabelsApi,
  ThreadsApi,
  ProfileApi,
} from './api';

// Export auth utilities
export {
  getAuthUrl,
  startCallbackServer,
  refreshAccessToken,
  getValidAccessToken,
} from './utils/auth';

// Export config utilities
export {
  isAuthenticated,
  loadTokens,
  saveTokens,
  clearConfig,
} from './utils/config';
