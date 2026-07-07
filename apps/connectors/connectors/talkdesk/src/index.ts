// @hasna/connect-talkdesk
// A TypeScript wrapper for the Talkdesk cloud contact center API.

export { Talkdesk, TalkdeskClient, UsersApi, ContactsApi, ReportsApi } from './api';
export { DEFAULT_BASE_URL } from './api/client';
export * from './types';

// Config utilities
export {
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  getAccessToken,
  setAccessToken,
  getBaseUrl,
  setBaseUrl,
  getAuthUrl,
  setAuthUrl,
  clearConfig,
  isAuthenticated,
  resolveConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  type TalkdeskCliConfig,
} from './utils/config';

// Output utilities
export {
  formatOutput,
  success,
  error,
  warn,
  info,
  heading,
  print,
  type OutputFormat,
} from './utils/output';
